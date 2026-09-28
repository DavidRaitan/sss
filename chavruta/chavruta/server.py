# -*- coding: utf-8 -*-
"""The local app: turn to a page, read it aloud, talk about it.

    GET  /api/masechtot          what can be opened
    GET  /api/daf?ref=           an amud's pack (built from Sefaria, then cached)
    POST /api/hear?ref=&line=    audio in; what was said, and whether it was reading
    POST /api/heard              the same for words the browser already recognised
    POST /api/say                a turn of conversation (streamed: a "let me pull
                                 that up" line first when it goes to Sefaria)
    GET  /api/text?ref=          any text on Sefaria, for the sources panel
    POST /api/speak              a reply as audio, never the gemara
    POST /api/voice              the same, prepared; then GET /api/voice/<id>
                                 streams it, so playback starts at once
    GET  /api/health             what works, and what to fix if it does not

One process, standard library apart from the model SDK. Packs are cached on
disk and the neighbouring amudim are built in the background, so turning the
page is instant.
"""

import errno
import hashlib
import io
import json
import logging
import os
import posixpath
import re
import threading
import time
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import align, library, retrieve, sefaria, smalltalk
from .commentators import MASECHTOT
from .llm import LLM, VOICE_DIRECTION, ModelError, speakable
from .masechta_index import Index
from .pack import Pack
from .partner import Partner, unit_nudge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PACKS = os.environ.get("CHAVRUTA_PACKS") or os.path.join(ROOT, "packs")
LOG_PATH = os.path.join(ROOT, "chavruta.log")
SESSIONS_DIR = os.path.join(ROOT, "sessions")
VOICE_DIR = os.path.join(PACKS, "_voice")
VOICES = {}   # id -> text waiting to be spoken
SPOKEN = []   # the words of what it said last, to know its own voice when it hears it
ECHO = 0.6    # this much of what was "heard" being its own last words means it heard itself


def voice_key(llm, text):
    """Kept audio is keyed by everything that shapes the voice, so a change of
    voice or direction never mixes old clips with new ones."""
    raw = "%s|%s|%s|%s" % (llm.tts, llm.voice, VOICE_DIRECTION, text)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:20]


def word_list(text):
    """Words of either language, reduced so a transcript and a script compare."""
    plain = align.NIKUD.sub("", text.lower()).translate(align.FINALS)
    return [w for w in re.findall(r"[a-z]+|[א-ת]+", plain) if len(w) > 1]


def echo_of_itself(said):
    """Whether what was heard is the partner's own voice, picked up by the mic.

    With speakers instead of earbuds the microphone hears the answer, and in
    use it transcribed its own answer as the learner's turn and argued with
    it ("Not 'Ruma'"). English words count as well as Hebrew here.
    """
    mine = word_list(said)
    if len(mine) < 3:
        return False
    for spoken in SPOKEN:
        if spoken and sum(1 for w in mine if w in spoken) >= ECHO * len(mine):
            return True
    return False


def record(kind, **fields):
    """One line per turn in sessions/<date>.jsonl -- the whole story of a sitting,
    so it can be read back afterwards and the partner improved from real use."""
    try:
        os.makedirs(SESSIONS_DIR, exist_ok=True)
        fields.update(kind=kind, at=time.strftime("%Y-%m-%d %H:%M:%S"))
        with open(os.path.join(SESSIONS_DIR, time.strftime("%Y-%m-%d") + ".jsonl"), "a", encoding="utf-8") as f:
            f.write(json.dumps(fields, ensure_ascii=False) + "\n")
    except Exception as exc:
        log.info("could not record turn: %s", exc)

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
         ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
         ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon"}

log = logging.getLogger("chavruta")

SESSIONS = {}
SESSION_LOCK = threading.Lock()
BUILDING = {}
BUILD_LOCK = threading.Lock()
PAGES = {}   # ref -> align.Page, which is worth keeping between turns
INDEXES = {}


def index_for(masechta):
    """The whole-tractate index, if `./run.sh prefetch` has built it."""
    if masechta not in INDEXES or INDEXES[masechta] is None:
        INDEXES[masechta] = Index.load(PACKS, masechta)
    return INDEXES[masechta]


# -- packs ---------------------------------------------------------------------

def pack_path(ref):
    return os.path.join(PACKS, ref.lower().replace(" ", "_").replace(":", "_") + ".json")


def allowed(ref):
    """Only masechtot we have judged the routing for. See commentators.py."""
    return any(ref.startswith(m["name"] + " ") for m in MASECHTOT) and \
        ref in set(sefaria.amudim(ref.rsplit(" ", 1)[0]))


def load_pack(ref, rebuild=False):
    """From disk if we have the real thing; from Sefaria if we do not.

    A fixture on disk never satisfies a request: it only comes back when
    Sefaria genuinely cannot be reached, and says so on screen.
    """
    path = pack_path(ref)
    stale = None
    if os.path.exists(path) and not rebuild:
        pack = Pack.load(path)
        current = pack.data.get("pack_version", 0) >= sefaria.PACK_VERSION
        if current and not pack.is_fixture:
            return pack
        stale = pack  # served only if Sefaria cannot be reached

    with BUILD_LOCK:
        gate = BUILDING.setdefault(ref, threading.Lock())
    with gate:
        if os.path.exists(path) and not rebuild and stale is None:
            return Pack.load(path)  # someone else built it while we waited
        if stale is not None and os.path.exists(path):
            fresh = Pack.load(path)
            if fresh.data.get("pack_version", 0) >= sefaria.PACK_VERSION:
                return fresh
        try:
            data = sefaria.build(ref)
        except sefaria.SefariaError:
            if stale is not None:
                return stale
            raise
        os.makedirs(PACKS, exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as handle:
            json.dump(data, handle, ensure_ascii=False)
        os.replace(tmp, path)
        PAGES.pop(ref, None)
        return Pack(data)


def prefetch(*refs):
    """Build the neighbours quietly, so the next turn of the page is instant."""
    def work():
        for ref in refs:
            if ref and allowed(ref) and not os.path.exists(pack_path(ref)):
                try:
                    load_pack(ref)
                except Exception as exc:
                    log.info("prefetch %s: %s", ref, exc)
    threading.Thread(target=work, daemon=True).start()


def page_of(pack):
    if pack.ref not in PAGES:
        PAGES[pack.ref] = align.Page(pack.data)
    return PAGES[pack.ref]


def session(sid):
    with SESSION_LOCK:
        return SESSIONS.setdefault(sid or "default", {
            "history": [], "ref": None, "line": 1, "nudged": set(), "language": "auto",
            "recent": [], "spoke": None})


def fresh_page(state, ref):
    if state.get("ref") != ref:
        state.update(history=[], ref=ref, nudged=set(), recent=[], spoke=None)


def worth_asking(heard):
    """Whether a reading differed from the page in a way a chavruta would ask about.

    A swapped word, always. Words that are not on the page, when there are
    enough of them to be something they said. Never a skipped word on its own:
    in use "you skipped «אתם»" was the recogniser dropping it, and said as a
    fact it is exactly the correction the learner asked never to get.
    """
    slips = heard.get("slips") or {}
    if slips.get("swapped") or slips.get("after"):
        return True
    return len(slips.get("added", [])) >= 2


def hint_for(pack, line):
    """The words they are about to read, to prime the recogniser."""
    lines = [s["he_plain"] for s in pack.segments if line - 1 <= s["n"] <= line + 3]
    return " ".join(lines)[:600]


KEYWORDS = ["גמרא", "משנה", "סוגיא", "מחלוקת", "רש\"י", "תוספות", "הרמב\"ם", "רשב\"א",
            "ריטב\"א", "רי\"ף", "מאירי", "Rashi", "Tosafot", "gemara", "sugya",
            "machlokes", "mishna", "tanna", "amora", "halacha"]


# -- handler ---------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "chavruta"

    def log_message(self, fmt, *args):
        pass

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_bytes(self, body, mime):
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def fail(self, status, message, exc=None):
        """A short message for the screen; the whole story goes to the log,
        and a line to the sitting's record, so a failure shows in the export."""
        if exc is not None:
            log.error("%s %s: %s\n%s", self.command, self.path, exc, traceback.format_exc())
            record("error", path=self.path.split("?")[0], status=status, error=str(exc)[:400])
        return self.send_json({"error": message}, status)

    def body_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return {}

    # -- GET -------------------------------------------------------------------

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        arg = lambda k, d="": (q.get(k) or [d])[0].strip()

        if url.path == "/api/health":
            return self.send_json(health())
        if url.path.startswith("/api/voice/"):
            return self.voice(url.path.rsplit("/", 1)[-1])
        if url.path == "/api/text":
            ref = arg("ref")
            if not ref or len(ref) > 200:
                return self.fail(400, "need_ref")
            entry = library.text(ref)
            if not entry:
                return self.fail(404, "not_on_sefaria")
            return self.send_json(entry)
        if url.path == "/api/masechtot":
            return self.send_json({"masechtot": MASECHTOT})
        if url.path == "/api/daf":
            ref = arg("ref")
            if not allowed(ref):
                return self.fail(400, "not_available")
            try:
                pack = load_pack(ref, rebuild=bool(arg("rebuild")))
            except sefaria.SefariaError as exc:
                return self.fail(502, "sefaria_unreachable", exc)
            except Exception as exc:
                return self.fail(500, "pack_failed", exc)
            prefetch(pack.data.get("next"), pack.data.get("prev"))
            return self.send_json(pack.data)

        rel = posixpath.normpath(urllib.parse.unquote(url.path)).lstrip("/") or "index.html"
        target = os.path.normpath(os.path.join(WEB, rel))
        if not target.startswith(WEB) or not os.path.isfile(target):
            target = os.path.join(WEB, "index.html") if "." not in rel else None
        if not target:
            return self.fail(404, "not_found")
        with open(target, "rb") as handle:
            body = handle.read()
        self.send_bytes(body, TYPES.get(os.path.splitext(target)[1], "application/octet-stream"))

    # -- POST ------------------------------------------------------------------

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/api/hear":
                return self.hear()
            if route == "/api/heard":
                return self.heard()
            if route == "/api/say":
                return self.say()
            if route == "/api/speak":
                return self.speak()
            if route == "/api/voice":
                return self.prepare_voice()
        except ModelError as exc:
            return self.fail(502, "model: %s" % exc, exc)
        except sefaria.SefariaError as exc:
            return self.fail(502, "sefaria_unreachable", exc)
        except Exception as exc:
            return self.fail(500, "internal", exc)
        return self.fail(404, "not_found")

    def hear(self):
        """Audio in. What was said, and whether it was reading or talking.

        Reading gets followed silently -- the highlight moves and nothing is
        said -- except once per line, when the reader reaches the hinge of a
        machlokes. Talking is handed back so the client can show the words
        at once and then ask for an answer.
        """
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        ref = (q.get("ref") or [""])[0]
        line = int((q.get("line") or ["1"])[0] or 1)
        sid = (q.get("session") or [""])[0]
        language = (q.get("language") or ["auto"])[0]
        length = int(self.headers.get("Content-Length") or 0)
        if not length or not allowed(ref):
            return self.fail(400, "no_audio")
        audio = self.rfile.read(length)
        mime = self.headers.get("Content-Type", "audio/webm")

        pack = load_pack(ref)
        try:
            said = LLM().hear(audio, hint=hint_for(pack, line), keywords=KEYWORDS, mime=mime)
        except ModelError as exc:
            # A scrap of sound too short or broken to decode is nothing said,
            # not a failure to put in front of the learner.
            if re.search(r"corrupt|unsupported|too short|invalid_value", str(exc), re.I):
                log.info("hear: dropped unreadable audio (%d bytes): %s", length, str(exc)[:120])
                return self.send_json({"said": "", "mode": "silence"})
            raise
        checks = (q.get("checks") or ["1"])[0] != "0"
        overlap = (q.get("overlap") or ["0"])[0] == "1"
        return self.after_hearing(pack, ref, line, sid, language, said, checks, overlap)

    def heard(self):
        """The same, for words the browser already recognised itself."""
        body = self.body_json()
        ref = (body.get("ref") or "").strip()
        if not allowed(ref):
            return self.fail(400, "not_available")
        return self.after_hearing(load_pack(ref), ref, int(body.get("line") or 1),
                                  body.get("session"), body.get("language") or "auto",
                                  (body.get("said") or "").strip(), body.get("checks", True) is not False)

    def after_hearing(self, pack, ref, line, sid, language, said, checks=True, overlap=False):
        if not said:
            return self.send_json({"said": "", "mode": "silence"})
        # Only what was picked up while it was talking can be its own voice;
        # anything else that sounds like its last answer is the learner
        # repeating it, which is theirs to do.
        if overlap and echo_of_itself(said):
            record("echo", session=sid, ref=ref, said=said)
            return self.send_json({"said": said, "mode": "echo"})
        heard = align.listen(page_of(pack), said)
        record("heard", session=sid, ref=ref, line=line, said=said, heard=heard)
        state = session(sid)
        fresh_page(state, ref)
        if heard.get("line"):
            state["line"] = heard["line"]
        state["heard"] = heard
        reply = {"said": said, "mode": heard["mode"], "heard": heard,
                 "line": state["line"] or line}

        # "Hey", "can you hear me?", "go ahead": answered from the words alone,
        # with no model, before anything else happens.
        quick = smalltalk.reply(said, language) if heard["mode"] == "talking" else None
        if quick:
            kind, text = quick
            state["history"] = (state["history"] + [{"role": "user", "content": said},
                                                    {"role": "assistant", "content": text}])[-24:]
            record("answer", session=sid, ref=ref, line=line, said=said, text=text, grounded=True,
                   trace={"kind": "small talk: " + kind, "quick": True, "seconds": 0})
            reply["quick"] = text
            return self.send_json(reply)

        if heard["mode"] == "reading":
            # Followed silently -- and remembered, so "did I read that right?"
            # is answered from what was actually heard.
            state["recent"] = (state["recent"] + [{"said": said, "heard": heard}])[-4:]
            if checks and worth_asking(heard):
                # A different word, not a different accent: the partner asks.
                reply["respond"] = True
                return self.send_json(reply)
            lang = language if language in ("he", "en") else \
                ("he" if heard.get("hebrew", 0) > 0.5 else "en")
            found = unit_nudge(pack, heard, lang, state["nudged"])
            if found:
                text, nudge_ref, n = found
                state["nudged"].add((ref, n))
                state["spoke"] = text
                reply["nudge"], reply["nudge_ref"] = text, nudge_ref
        return self.send_json(reply)

    def say(self):
        body = self.body_json()
        ref, said = (body.get("ref") or "").strip(), (body.get("said") or "").strip()
        if not allowed(ref) or not said:
            return self.fail(400, "need_ref_and_words")
        state = session(body.get("session"))
        fresh_page(state, ref)
        line = int(body.get("line") or state.get("line") or 1)
        state["line"] = line
        pack = load_pack(ref)
        llm = LLM()
        heard = body.get("heard") or state.get("heard")

        if body.get("about_reading") and heard:
            # A question about one word, not about where they stopped: the
            # next utterance usually carries on the same sentence.
            heard = dict(heard, stopped_mid_clause=False)
        if body.get("about_reading"):
            # They were reading and a word came out different: nothing to route.
            route = {"kind": "check_reading", "claim": False, "names": [], "navigate": None,
                     "language": "he" if (heard or {}).get("hebrew", 0) > 0.5 else None, "reply": None}
            recent = state["recent"][:-1]  # the last one is this reading itself
        else:
            route = retrieve.classify(llm, said)
            recent = state["recent"]
        nav = route.get("navigate")
        if route["kind"] == "navigate" and nav:
            masechta = pack.data.get("masechta", "Berakhot")
            target = "%s %d%s" % (masechta, nav["daf"], nav["amud"])
            if allowed(target):
                record("navigate", session=body.get("session"), ref=ref, said=said, to=target)
                return self.send_json({"mode": "navigate", "ref": target})

        # Streamed as lines of JSON when the client can take it: a first line
        # to say while Sefaria is asked ("let me pull up the Tur"), then the
        # answer. Silence while fetching sounded like a partner who gave up.
        stream = bool(body.get("stream"))
        if stream:
            self.send_response(200)
            self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()

        def emit(payload):
            self.wfile.write((json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8"))
            self.wfile.flush()

        interim = []

        def announce(text):
            interim.append(text)
            if stream:
                emit({"mode": "interim", "text": text})

        partner = Partner(pack, llm, depth=body.get("depth") or "daf",
                          language=body.get("language") or "en",
                          index=index_for(pack.data.get("masechta", "")))
        started = time.time()
        try:
            text, verdict, state["history"], trace = partner.ask(
                line, state["history"], said, heard=heard, route=route,
                recent=recent, spoke=state.get("spoke"), announce=announce)
        except Exception as exc:
            if not stream:
                raise
            log.error("say: %s\n%s", exc, traceback.format_exc())
            emit({"error": "model: %s" % exc if isinstance(exc, ModelError) else "internal"})
            return
        trace["seconds"] = round(time.time() - started, 1)
        trace["interim"] = interim[0] if interim else None
        record("answer", session=body.get("session"), ref=ref, line=line, said=said,
               depth=body.get("depth"), language=body.get("language"), text=text,
               grounded=verdict.ok, trace=trace, models=[llm.heavy, llm.cheap])
        state.update(heard=None, recent=[], spoke=None)
        payload = {"mode": "answer", "text": text, "grounded": verdict.ok,
                   "problem": None if verdict.ok else verdict.complaint(), "trace": trace}
        if stream:
            return emit(payload)
        return self.send_json(payload)

    def spoken_text(self, body):
        text = speakable((body.get("text") or "").strip())
        ref = (body.get("ref") or "").strip()
        if ref and allowed(ref):
            # The net under the «» marks: whatever the model did, no long
            # stretch of the page itself reaches the voice.
            text = align.unspeak(text, page_of(load_pack(ref)))
        return text

    def prepare_voice(self):
        text = self.spoken_text(self.body_json())
        if not text.strip(" …"):
            return self.fail(400, "nothing_to_say")
        llm = LLM()
        key = voice_key(llm, text)
        VOICES[key] = text
        while len(VOICES) > 64:            # kept for a retry, but not forever
            VOICES.pop(next(iter(VOICES)))
        # What it says, so that hearing it back through the speakers is
        # recognised as its own voice and not taken for the learner's.
        SPOKEN.append(set(word_list(text)))
        del SPOKEN[:-6]
        return self.send_json({"id": key})

    def voice(self, key):
        """Stream a prepared reply's audio, and keep it: the same words are never
        paid for or waited on twice ("Go ahead." comes back instantly)."""
        path = os.path.join(VOICE_DIR, key + ".mp3")
        if os.path.exists(path):
            with open(path, "rb") as handle:
                return self.send_bytes(handle.read(), "audio/mpeg")
        text = VOICES.get(key)
        if not text:
            return self.fail(404, "no_such_voice")
        stream = LLM().speak_stream(text)
        try:
            first = next(stream)
        except StopIteration:
            return self.fail(502, "model: no audio")
        except ModelError as exc:
            return self.fail(502, "model: %s" % exc, exc)
        mime = "audio/wav" if first[:4] == b"RIFF" else "audio/mpeg"
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        kept = [first]
        try:
            self.wfile.write(first)
            for chunk in stream:
                kept.append(chunk)
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return  # they talked over it; the rest is not needed
        except ModelError as exc:
            log.error("voice: %s", exc)
            return
        if mime == "audio/mpeg":
            os.makedirs(VOICE_DIR, exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "wb") as handle:
                handle.write(b"".join(kept))
            os.replace(tmp, path)

    def speak(self):
        text = self.spoken_text(self.body_json())
        if not text.strip(" …"):
            return self.fail(400, "nothing_to_say")
        audio, mime = LLM().speak(text)
        return self.send_bytes(audio, mime)


# -- health ----------------------------------------------------------------------

_SEFARIA = {"at": 0, "ok": None}


def health():
    llm = LLM()
    key = bool(os.environ.get("OPENAI_API_KEY") if llm.provider == "openai"
               else os.environ.get("ANTHROPIC_API_KEY"))
    if time.time() - _SEFARIA["at"] > 120:
        _SEFARIA["ok"] = bool(sefaria.get("v3/texts/Berakhot 2a:1", soft=True, version="source"))
        _SEFARIA["at"] = time.time()
    cached = sorted(f[:-5] for f in os.listdir(PACKS) if f.endswith(".json")) if os.path.isdir(PACKS) else []
    return {"provider": llm.provider, "heavy": llm.heavy, "cheap": llm.cheap,
            "key": key, "sefaria": _SEFARIA["ok"], "can_hear": llm.can_hear and key,
            "can_speak": llm.can_speak and key, "cached": len(cached),
            "index": any(c.startswith("_index_") for c in cached)}


def prewarm():
    """Make the audio for the small-talk replies once, so they are instant."""
    llm = LLM()
    if not (llm.can_speak and os.environ.get("OPENAI_API_KEY")):
        return
    os.makedirs(VOICE_DIR, exist_ok=True)
    for text in smalltalk.FIXED:
        key = voice_key(llm, text)
        path = os.path.join(VOICE_DIR, key + ".mp3")
        if os.path.exists(path):
            continue
        try:
            audio, mime = llm.speak(text)
            if mime == "audio/mpeg":
                with open(path, "wb") as handle:
                    handle.write(audio)
        except Exception as exc:
            log.info("prewarm %r: %s", text, exc)
            return


def serve(port=8765, open_browser=True, host="127.0.0.1"):
    os.makedirs(PACKS, exist_ok=True)
    logging.basicConfig(filename=LOG_PATH, level=logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s")
    # An earlier copy left running holds the port. Say so plainly and use the
    # next free one, rather than dying with a traceback.
    httpd = None
    for candidate in range(port, port + 10):
        try:
            httpd = ThreadingHTTPServer((host, candidate), Handler)
            break
        except OSError as exc:
            if exc.errno not in (errno.EADDRINUSE, 48, 98):
                raise
            if candidate == port:
                print("port %d is taken -- probably an earlier chavruta still running.\n"
                      "  to close it:  lsof -ti :%d | xargs kill\n"
                      "  meanwhile, using the next free port." % (port, port))
    if httpd is None:
        raise SystemExit("no free port between %d and %d" % (port, port + 9))
    port = httpd.server_address[1]
    threading.Thread(target=prewarm, daemon=True).start()
    url = "http://127.0.0.1:%d/" % port
    print("chavruta -> %s   (ctrl-c to stop; problems are written to chavruta.log)" % url)
    if open_browser:
        try:
            import webbrowser
            threading.Timer(0.7, lambda: webbrowser.open(url)).start()
        except Exception:
            pass
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye")
