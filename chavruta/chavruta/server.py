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

import datetime
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

from . import align, commentators, daily, library, notes, retrieve, review, sefaria, smalltalk
from .commentators import MASECHTOT
from .llm import LLM, VOICE_DIRECTION, ModelError, speakable
from .masechta_index import Index
from .pack import Pack
from .partner import READ_TO_ME, Partner, offer_choice, unit_nudge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PACKS = os.environ.get("CHAVRUTA_PACKS") or os.path.join(ROOT, "packs")
LOG_PATH = os.path.join(ROOT, "chavruta.log")
SESSIONS_DIR = os.environ.get("CHAVRUTA_SESSIONS") or os.path.join(ROOT, "sessions")
VOICE_DIR = os.path.join(PACKS, "_voice")
VOICES = {}   # id -> text waiting to be spoken
SPOKEN = []   # the words of what it said last, to know its own voice when it hears it
ECHO = 0.6    # this much of what was "heard" being its own last words means it heard itself


# The voices offered in settings (chosen by the learner from OpenAI's set):
# Cedar, the default, and Verse. Anything else falls back to the default.
VOICE_NAMES = ("cedar", "verse")


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
    """A real amud of a tractate we can open (commentators.MASECHTOT)."""
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
            "recent": [], "spoke": None, "memory": {}})


PROGRESS = re.compile(r"\bhow much (have i|did i|i've) (learn(ed)?|done|covered|finished)\b|\bmy progress\b|"
                      r"\bhow am i doing\b|\bmy streak\b|כמה למדתי|ההתקדמות שלי|כמה ימים ברצף|איך אני מתקדם", re.I)


def progress_text(p, lang):
    """Progress in a sentence or two."""
    he = lang == "he"
    parts = []
    if p["streak"]:
        parts.append(("%d ימים ברצף שאתה לומד." % p["streak"]) if he else
                     ("%d day%s in a row." % (p["streak"], "" if p["streak"] == 1 else "s")))
    for t in p["tractates"][:3]:
        parts.append(("ב%s: %d מתוך %d עמודים." % (t["he"], t["done"], t["total"])) if he else
                     ("%s: %d of %d amudim." % (t["name"], t["done"], t["total"])))
    dy = p["daf_yomi"]
    if dy.get("ref"):
        parts.append(("הדף היומי (%s): %s." % (dy["he"], "למדת ✓" if dy["done"] else "עוד לא")) if he else
                     ("Today's daf, %s: %s." % (dy["ref"], "done" if dy["done"] else "not yet")))
    return " ".join(parts) or ("עוד לא למדנו יחד." if he else "We haven't learned together yet.")


# "Put the Rashba on the side", "תפתח את המאירי בצד": the reading desk, by voice.
# Only with a word for where -- "open the Rashba" alone is a question about him.
DESK_OPEN = re.compile(
    r"^\W*(?:(?:can you|could you|please|and)\s+)*(?:open|put|add|bring|pin|show)(?: up)?(?: me)? (?P<en>.+?)"
    r" (?:on|to|onto|in|at|next to|beside|alongside|by)(?: the| my)? (?:screen|side|desk|table)\W*$|"
    r"^\W*(?:תפתח|פתח|תשים|שים|תוסיף|הוסף|תעלה|תביא|תצמיד)(?: לי)? (?P<he>.+?)"
    r" (?:על |ב|ל)?ה?(?:מסך|צד|שולחן)\W*$", re.I)
DESK_CLOSE = re.compile(r"\b(close|hide|clear)( the| my)? (desk|side screen|screen on the side|side)\b|"
                        r"(סגור|תסגור|תנקה|נקה|תוריד) את (השולחן|המסך בצד|הצד)", re.I)


def desk_who(words, pack):
    """The commentators on this page named in `words` ("the Rashba and the Meiri")."""
    present = pack.commentators()
    table = {}
    for name in present:
        table[retrieve._key(name)] = name
        he = commentators.WHO.get(name, {}).get("he")
        if he:
            table[retrieve._key(he)] = name
    for alias, target in retrieve.ALIASES.items():
        found = commentators.filed(target, present)
        if found:
            table.setdefault(retrieve._key(alias), found[0])
    out = []
    for piece in re.split(r",|\band\b|\s+ו(?=את\b|ה|[א-ת])|\s+גם\s+", words):
        piece = re.sub(r"^\s*(the|את|also)\s+", "", piece.strip(), flags=re.I)
        key = retrieve._key(piece)
        for k in (key, key[1:] if key[:1] in "הול" else None):
            if k and k in table:
                if table[k] not in out:
                    out.append(table[k])
                break
    return out


def desk_command(said, pack, lang):
    """{"mode": "desk", ...} for "put the Meiri on the side", or None."""
    he = lang == "he" or (lang == "auto" and re.search(r"[א-ת]", said))
    if DESK_CLOSE.search(said):
        return {"mode": "desk", "close": True, "text": "סגרתי את השולחן." if he else "Closed the desk."}
    m = DESK_OPEN.search(said)
    if not m:
        return None
    names = desk_who(m.group("en") or m.group("he") or "", pack)
    if not names:
        return None
    bare = ("Rashi", "Tosafot", "Steinsaltz")
    if he:
        said_names = [("" if n in bare or n.startswith("Rabbeinu") else "ה") + commentators.WHO.get(n, {}).get("he", n)
                      for n in names]
        spoken = " ו".join(said_names) if len(said_names) <= 2 else ", ".join(said_names)
    else:
        spoken = " and ".join(("" if n in bare else "the ") + n for n in names)
    return {"mode": "desk", "add": names,
            "text": ("פתחתי את %s בצד." % spoken) if he else ("Opened %s on the side." % spoken)}


def onto_next_page(pack, said, heard, line):
    """(next amud, its reading) when they have read on from the last lines of
    this amud into the next -- or None. Only a page already built is checked:
    turning must never wait on the network."""
    if line < len(pack.segments) - 2 and (heard.get("line") or 0) < len(pack.segments) - 2:
        return None
    ran_over = heard.get("mode") == "reading" and (heard.get("slips") or {}).get("after")
    if heard.get("mode") == "reading" and not ran_over:
        return None
    nxt = pack.data.get("next")
    if not nxt or not allowed(nxt) or not os.path.exists(pack_path(nxt)):
        return None
    there = align.listen(page_of(load_pack(nxt)), said)
    if there.get("line") and there["line"] <= 3 and there.get("matched", 0) >= 3 and \
            (there["mode"] == "reading" or (ran_over and there["mode"] == "quoting")):
        return nxt, {k: v for k, v in dict(there, mode="reading").items() if k != "slips"}
    return None


def fresh_page(state, ref):
    if state.get("ref") != ref:
        # The page they are leaving gets its recap, quietly, so "did we learn
        # this?" can be answered from every page they studied.
        if state.get("ref"):
            threading.Thread(target=review.recap_quietly, args=(state["ref"],), daemon=True).start()
        # The place they named stays; what was fetched for the last page goes.
        memory = {"place": state.get("memory", {}).get("place")}
        state.update(history=[], ref=ref, nudged=set(), recent=[], spoke=None, memory=memory)


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

class Cancelled(Exception):
    pass


class HeadStart:
    """An answer begun on a guessed route while the router decides.

    It runs on its own partner and its own copy of the sitting's memory, and
    holds every sentence it writes until it is told the guess stood
    (relay), or is dropped (cancel) -- then whatever it wrote is never seen
    and the real answer starts at once, so a wrong guess costs tokens, never
    time. In use the router took one to two and a half seconds before a word
    of the answer was begun."""

    def __init__(self, partner, line, state, said, heard, recent, route, cut):
        import copy
        import queue
        self.out = queue.Queue()
        self.cancelled = threading.Event()
        self.memory = copy.deepcopy(state.setdefault("memory", {}))
        self.args = dict(n=line, history=list(state["history"]), said=said, heard=heard, route=route,
                         recent=recent, spoke=state.get("spoke"), memory=self.memory,
                         cut=dict(cut, kind=route["cut_in"]) if cut and route.get("cut_in") else None)
        self.partner = partner

    def start(self):
        def run():
            def part(text):
                if self.cancelled.is_set():
                    raise Cancelled()
                self.out.put(("part", text))
            try:
                self.out.put(("done", self.partner.ask(on_part=part, **self.args)))
            except Cancelled:
                pass
            except Exception as exc:
                self.out.put(("error", exc))
        threading.Thread(target=run, daemon=True).start()
        return self

    def cancel(self):
        self.cancelled.set()

    def relay(self, emit):
        while True:
            kind, value = self.out.get()
            if kind == "part":
                emit(value)
            elif kind == "done":
                return value
            else:
                raise value


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

    def let_in(self):
        """On the phone link, only with the key: the first visit carries it in
        the address and leaves it as a cookie. The Mac itself needs none."""
        if not PHONE_KEY or self.client_address[0] in ("127.0.0.1", "::1"):
            return True
        cookie = self.headers.get("Cookie") or ""
        if "chavruta_key=%s" % PHONE_KEY in cookie:
            return True
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        if (q.get("k") or [""])[0] == PHONE_KEY and self.command == "GET":
            self.send_response(302)
            self.send_header("Set-Cookie", "chavruta_key=%s; Path=/; Max-Age=31536000; Secure; HttpOnly; SameSite=Strict"
                             % PHONE_KEY)
            self.send_header("Location", urllib.parse.urlparse(self.path).path or "/")
            self.end_headers()
            return False
        self.fail(403, "need_key")
        return False

    def do_GET(self):
        if not self.let_in():
            return
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
        if url.path == "/api/table":
            return self.send_json({"table": commentators.table()})
        if url.path == "/api/progress":
            mine = [m for m in arg("mine").split(",") if m]
            return self.send_json(daily.progress(review.sittings(400), datetime.date.today(), mine))
        if url.path == "/api/notes":
            return self.send_json({"notes": notes.on(ref=arg("ref"))})
        if url.path == "/api/history":
            # What was learned, sitting by sitting -- for "last time you were on ...".
            return self.send_json({"sittings": review.sittings()[:10]})
        if url.path == "/api/today":
            found = daily.daf_yomi()
            return self.send_json(found) if found else self.fail(502, "no_daf_yomi")
        if url.path == "/api/prepare":
            return self.send_json(PREPARER.status(arg("masechta")))
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
        if not self.let_in():
            return
        route = urllib.parse.urlparse(self.path).path
        try:
            if route == "/api/hear":
                return self.hear()
            if route == "/api/heard":
                return self.heard()
            if route == "/api/transcribe":
                return self.transcribe()
            if route == "/api/say":
                return self.say()
            if route == "/api/speak":
                return self.speak()
            if route == "/api/forget":
                return self.forget()
            if route == "/api/voice":
                return self.prepare_voice()
            if route == "/api/prepare":
                masechta = (self.body_json().get("masechta") or "").strip()
                if not PREPARER.start(masechta):
                    return self.fail(400, "no_such_masechta")
                return self.send_json(PREPARER.status(masechta))
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

    def transcribe(self):
        """One piece of a sentence still being spoken, to words -- nothing else.
        The page sends each piece as the speaker pauses, so by the time they
        stop only the last piece is left to hear."""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        ref = (q.get("ref") or [""])[0]
        line = int((q.get("line") or ["1"])[0] or 1)
        length = int(self.headers.get("Content-Length") or 0)
        if not length or not allowed(ref):
            return self.fail(400, "no_audio")
        audio = self.rfile.read(length)
        started = time.time()
        try:
            said = LLM().hear(audio, hint=hint_for(load_pack(ref), line), keywords=KEYWORDS,
                              mime=self.headers.get("Content-Type", "audio/webm"))
        except ModelError as exc:
            if re.search(r"corrupt|unsupported|too short|invalid_value", str(exc), re.I):
                return self.send_json({"said": ""})
            raise
        return self.send_json({"said": said, "ms": int((time.time() - started) * 1000)})

    def heard(self):
        """The same, for words already turned to text -- by the browser, typed,
        or heard piece by piece as they were spoken."""
        body = self.body_json()
        ref = (body.get("ref") or "").strip()
        if not allowed(ref):
            return self.fail(400, "not_available")
        return self.after_hearing(load_pack(ref), ref, int(body.get("line") or 1),
                                  body.get("session"), body.get("language") or "auto",
                                  (body.get("said") or "").strip(), body.get("checks", True) is not False,
                                  bool(body.get("overlap")))

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
        state = session(sid)
        # Read on past the last line: the next amud, turned to without a word.
        onward = onto_next_page(pack, said, heard, max(line or 0, state.get("line") or 0))
        turned = None
        if onward:
            turned, heard = onward
            ref, pack = turned, load_pack(turned)
        record("heard", session=sid, ref=ref, line=line, said=said, heard=heard)
        fresh_page(state, ref)
        if heard.get("line"):
            state["line"] = heard["line"]
        state["heard"] = heard
        reply = {"said": said, "mode": heard["mode"], "heard": heard,
                 "line": state["line"] or line}
        if turned:
            reply["turn"] = turned

        # "Note: ..." / "save this" / "what did I note?" -- the learner's own notes.
        if heard["mode"] == "talking":
            lang = language if language in ("he", "en") else ("he" if heard.get("hebrew", 0) > 0.5 else "en")
            wanted = notes.taken(said)
            if wanted is not None:
                last = next((m["content"] for m in reversed(state["history"]) if m["role"] == "assistant"), "")
                text = wanted or re.sub(r"\s*\[\[[^\]]+\]\]", "", last) or said
                entry = notes.add(ref, state["line"] or line, text, "note" if wanted else "answer")
                reply["note"] = entry
                reply["quick"] = ("רשמתי, בשורה %d." if lang == "he" else "Noted, on line %d.") % entry["line"]
                record("answer", session=sid, ref=ref, line=line, said=said, text=reply["quick"], grounded=True,
                       trace={"kind": "note", "quick": True, "seconds": 0})
                return self.send_json(reply)
            if PROGRESS.search(said) and len(said.split()) <= 14:
                reply["quick"] = progress_text(daily.progress(review.sittings(400), datetime.date.today(),
                                                              [pack.data.get("masechta", "")]), lang)
                record("answer", session=sid, ref=ref, line=line, said=said, text=reply["quick"], grounded=True,
                       trace={"kind": "progress", "quick": True, "seconds": 0})
                return self.send_json(reply)
            if notes.ASK.search(said) and len(said.split()) <= 14:
                masechta = pack.data.get("masechta", "")
                rows = notes.on(masechta=masechta) if notes.WIDE.search(said) else (
                    notes.on(ref=ref) or notes.on(masechta=masechta))
                reply["quick"] = notes.spoken(rows, lang, here=ref)
                record("answer", session=sid, ref=ref, line=line, said=said, text=reply["quick"], grounded=True,
                       trace={"kind": "notes", "quick": True, "seconds": 0})
                return self.send_json(reply)

        # "Hey", "can you hear me?", "go ahead": answered from the words alone,
        # with no model, before anything else happens.
        last = state.get("spoke") or next(
            (m["content"] for m in reversed(state["history"]) if m["role"] == "assistant"), "")
        asked = last.rstrip().endswith("?")
        quick = smalltalk.reply(said, language, asked) if heard["mode"] == "talking" else None
        if offer_choice(state.get("memory", {}).get("offered"), said):
            quick = None    # "let's read it" after "read it together, or the gist?"
        if quick and quick[0] == "filler":
            # "Um", "okay": heard, shown, and let be.
            record("heard_filler", session=sid, ref=ref, said=said)
            reply["ignore"] = True
            return self.send_json(reply)
        if quick and quick[0] == "skip":
            reply["skip"] = True
            return self.send_json(reply)
        if quick and quick[0] in ("faster", "slower"):
            # Speaking speed is the page's to change; it answers in a word.
            record("answer", session=sid, ref=ref, line=line, said=said, text="(speed %s)" % quick[0],
                   grounded=True, trace={"kind": "small talk: " + quick[0], "quick": True, "seconds": 0})
            reply["rate"] = 1 if quick[0] == "faster" else -1
            return self.send_json(reply)
        if quick and quick[0] == "again":
            # "What?" -- the page says its last answer again.
            record("answer", session=sid, ref=ref, line=line, said=said, text="(said again)",
                   grounded=True, trace={"kind": "small talk: again", "quick": True, "seconds": 0})
            reply["again"] = True
            return self.send_json(reply)
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
            elif heard.get("line") == len(pack.segments) and (ref, "end") not in state["nudged"]:
                # The end of the amud: a few questions on it, if they want.
                text = review.QUIZ_OPENING[lang]
                state["nudged"].add((ref, "end"))
                state["spoke"] = text
                reply["nudge"], reply["nudge_ref"] = text, None
        return self.send_json(reply)

    def say(self):
        body = self.body_json()
        ref, said = (body.get("ref") or "").strip(), (body.get("said") or "").strip()
        if not allowed(ref) or not said:
            return self.fail(400, "need_ref_and_words")
        state = session(body.get("session"))
        state.setdefault("discarded", set()).discard(said)      # asked again: it counts again
        fresh_page(state, ref)
        line = int(body.get("line") or state.get("line") or 1)
        state["line"] = line
        pack = load_pack(ref)
        llm = LLM()
        heard = body.get("heard") or state.get("heard")
        head, router_ms = None, None

        desk = None if body.get("about_reading") else desk_command(said, pack, body.get("language") or "en")
        if desk:
            record("answer", session=body.get("session"), ref=ref, line=line, said=said, text=desk["text"],
                   grounded=True, trace={"kind": "desk", "quick": True, "seconds": 0})
            return self.send_json(desk)
        if body.get("about_reading") and heard:
            # A question about one word, not about where they stopped: the
            # next utterance usually carries on the same sentence.
            heard = dict(heard, stopped_mid_clause=False)
        if body.get("about_reading"):
            # They were reading and a word came out different: nothing to route.
            route = {"kind": "check_reading", "claim": False, "names": [], "navigate": None,
                     "language": "he" if (heard or {}).get("hebrew", 0) > 0.5 else None, "reply": None}
            recent = state["recent"][:-1]  # the last one is this reading itself
        elif smalltalk.acknowledges(said) or offer_choice(state.get("memory", {}).get("offered"), said):
            # "Okay" / "yes" to something it offered: a request to go on, and
            # the router, which sees only these words, would call it a ping.
            route = {"kind": "other", "claim": False, "names": [], "navigate": None, "language": None,
                     "reply": None}
            recent = state["recent"]
        else:
            # Spoken over an answer still being said: the router also says
            # what these words are to that answer (an aside, a correction, a
            # new question, or something for later).
            cut = body.get("cut_in") if isinstance(body.get("cut_in"), dict) else None
            recent = state["recent"]
            # A head start: for a plain question about the page, the answer
            # begins on a guess while the router decides (see HeadStart).
            guessed = retrieve.guess(said, pack, line, cut) if body.get("stream") else None
            if guessed:
                head = HeadStart(self.partner_for(body, pack, llm), line, state, said, heard, recent,
                                 guessed, cut).start()
            t_route = time.time()
            route = retrieve.classify(llm, said, cut)
            router_ms = int((time.time() - t_route) * 1000)
            if head and not retrieve.agrees(route, guessed, (body.get("language") or "en") == "auto"):
                head.cancel()
                head = None
        if head and (route.get("cut_in") == "later" or route["kind"] in ("navigate", "settings")):
            head.cancel()
            head = None
        if route.get("cut_in") == "later":
            # "Let's come back to that": kept on the page, and on it goes.
            lang = body.get("language") if body.get("language") in ("he", "en") else route.get("language") or "en"
            text = "בסדר, שמרתי את זה לאחר כך." if lang == "he" else "Sure — I'll keep that for later."
            record("answer", session=body.get("session"), ref=ref, line=line, said=said, text=text,
                   grounded=True, trace={"kind": "later", "quick": True, "seconds": 0})
            return self.send_json({"mode": "later", "keep": said, "text": text})
        nav = route.get("navigate")
        if route["kind"] == "navigate" and nav:
            if nav.get("daf_yomi"):
                target = ((daily.daf_yomi() or {}).get("amudim") or [None])[0]
            else:
                masechta = nav.get("masechta") or pack.data.get("masechta", "Berakhot")
                target = "%s %d%s" % (masechta, nav["daf"], nav["amud"])
            if target and allowed(target):
                record("navigate", session=body.get("session"), ref=ref, said=said, to=target)
                return self.send_json({"mode": "navigate", "ref": target})

        # "Talk faster", "answer in Hebrew", "leave out the Meiri": the page
        # changes its own settings. Turning the voice off is asked first.
        if route["kind"] == "settings" and route.get("settings"):
            changes = route["settings"]
            confirm = any(c["name"] == "speak" and c["value"] is False for c in changes)
            record("answer", session=body.get("session"), ref=ref, line=line, said=said, text="(settings)",
                   grounded=True, trace={"kind": "settings", "changes": changes, "quick": True, "seconds": 0})
            return self.send_json({"mode": "settings", "changes": changes, "confirm": confirm,
                                   "language": route.get("language")})

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
                emit({"mode": "stage", "stage": "sources"})
                emit({"mode": "interim", "text": text})

        partner = self.partner_for(body, pack, llm)
        # "Can you read it for me?" -- the page's words may be spoken in full.
        read_out = bool(READ_TO_ME.search(said)) or \
            offer_choice(state.get("memory", {}).get("offered"), said) == "read"
        if read_out and stream:
            # Reading a comment together: it opens on the desk, to be read along.
            offered = (state.get("memory") or {}).get("offered") or []
            emit({"mode": "read", "desk": [{"name": name, "ref": e["ref"]} for name, e in offered]})
        if route.get("cut_in") and stream:
            emit({"mode": "cut_in", "kind": route["cut_in"]})
        started = time.time()
        if stream:
            emit({"mode": "stage", "stage": "writing"})
        try:
            if head:
                # The router agreed with the guess: the answer already under
                # way is this answer.
                text, verdict, history, trace = head.relay(lambda text: emit({"mode": "part", "text": text}))
                state["memory"] = head.memory
            else:
                text, verdict, history, trace = partner.ask(
                    line, state["history"], said, heard=heard, route=route,
                    recent=recent, spoke=state.get("spoke"), announce=announce,
                    # Each sentence as it is written, to be spoken while the rest is.
                    on_part=(lambda text: emit({"mode": "part", "text": text})) if stream else None,
                    memory=state.setdefault("memory", {}),
                    cut=dict(body["cut_in"], kind=route["cut_in"]) if route.get("cut_in") else None)
            # Taken back while it was being answered: the conversation goes on
            # as if it had not been said.
            if said not in state.setdefault("discarded", set()):
                state["history"] = history
        except (BrokenPipeError, ConnectionResetError):
            # The page asked again, together with what was said next.
            log.info("say: the page stopped waiting for this answer")
            return
        except Exception as exc:
            if not stream:
                raise
            log.error("say: %s\n%s", exc, traceback.format_exc())
            try:
                emit({"error": "model: %s" % exc if isinstance(exc, ModelError) else "internal"})
            except OSError:
                pass
            return
        trace["seconds"] = round(time.time() - started, 1)
        trace["router_ms"] = router_ms
        trace["head_start"] = bool(head)
        if route.get("cut_in"):
            trace["cut_in"] = route["cut_in"]      # what their words were to the answer they cut into
        trace["interim"] = interim[0] if interim else None
        record("answer", session=body.get("session"), ref=ref, line=line, said=said,
               depth=body.get("depth"), language=body.get("language"), text=text,
               grounded=verdict.ok, trace=trace, models=[llm.heavy, llm.cheap])
        state.update(heard=None, recent=[], spoke=None)
        payload = {"mode": "answer", "text": text, "grounded": verdict.ok, "read": read_out,
                   "problem": None if verdict.ok else verdict.complaint(), "trace": trace}
        if stream:
            try:
                emit(payload)
            except OSError:
                pass
            return
        return self.send_json(payload)

    def partner_for(self, body, pack, llm):
        favor = body.get("favor") if isinstance(body.get("favor"), dict) else {}
        return Partner(pack, llm, depth=body.get("depth") or "daf",
                       language=body.get("language") or "en",
                       index=index_for(pack.data.get("masechta", "")),
                       favor=favor, voices=body.get("voices"),
                       sites=body.get("sites") if isinstance(body.get("sites"), list) else None,
                       sites_halacha=body.get("sites_halacha", True))

    def forget(self):
        """ "Never mind" / ✕: what they said is taken back -- out of the
        conversation the partner remembers, as if it had not been said."""
        body = self.body_json()
        said = (body.get("said") or "").strip()
        if not said:
            return self.fail(400, "nothing_to_forget")
        state = session(body.get("session"))
        state.setdefault("discarded", set()).add(said)
        history, removed = state["history"], False
        for i in range(len(history) - 1, -1, -1):
            m = history[i]
            if m["role"] == "user" and m["content"].rsplit("\n", 1)[-1].strip() == said:
                end = i + 2 if i + 1 < len(history) and history[i + 1]["role"] == "assistant" else i + 1
                state["history"] = history[:i] + history[end:]
                removed = True
                break
        record("discarded", session=body.get("session"), said=said)
        return self.send_json({"ok": True, "removed": removed})

    def spoken_text(self, body):
        text = speakable((body.get("text") or "").strip())
        ref = (body.get("ref") or "").strip()
        if ref and allowed(ref) and not body.get("whole"):
            # The net under the «» marks: whatever the model did, no long
            # stretch of the page itself reaches the voice.
            text = align.unspeak(text, page_of(load_pack(ref)))
        return text

    def prepare_voice(self):
        body = self.body_json()
        text = self.spoken_text(body)
        if not text.strip(" …"):
            return self.fail(400, "nothing_to_say")
        llm = LLM()
        if body.get("voice_name") in VOICE_NAMES:
            llm.voice = body["voice_name"]
        key = voice_key(llm, text)
        VOICES[key] = (text, llm.voice)
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
        if key not in VOICES:
            return self.fail(404, "no_such_voice")
        text, name = VOICES[key]
        llm = LLM()
        llm.voice = name
        stream = llm.speak_stream(text)
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


def build_index(masechta):
    """The whole-tractate index, once every page of it is on disk."""
    import importlib.util
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pack", "build_index.py")
    try:
        spec = importlib.util.spec_from_file_location("build_index", path)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.main([masechta])
        INDEXES.pop(masechta, None)
    except Exception as exc:
        log.info("index %s: %s", masechta, exc)


review.LOAD = lambda ref: load_pack(ref)
review.ON_DISK = lambda ref: Pack.load(pack_path(ref)) if os.path.exists(pack_path(ref)) else None

PREPARER = daily.Preparer(build=load_pack, exists=lambda ref: os.path.exists(pack_path(ref)),
                          finish=build_index)


def morning():
    """While the app is open: today's daf and tomorrow's, built before they are
    opened, and again when the date turns over."""
    seen = None
    while True:
        today = datetime.date.today()
        if today != seen:
            refs = []
            for day in (today, today + datetime.timedelta(days=1)):
                found = daily.daf_yomi(day)
                refs += (found or {}).get("amudim", [])
            if refs:
                prefetch(*refs)
                seen = today
        time.sleep(1800)


PHONE_KEY = None


def serve_phone(port):
    """The same app over https on the local network, for the phone, behind a key."""
    import ssl
    from . import phone
    global PHONE_KEY
    PHONE_KEY = phone.key()
    ip = phone.lan_ip()
    cert, private = phone.certificate(ip)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, private)
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    # The handshake happens in each connection's own thread, on its first read,
    # so one slow or stalled device never holds up the others.
    httpd.socket = context.wrap_socket(httpd.socket, server_side=True, do_handshake_on_connect=False)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    link = "https://%s:%d/?k=%s" % (ip, port, PHONE_KEY)
    print("\nOn your phone (same wifi), open this private link -- send it to yourself:\n  %s\n"
          "The first time, the phone warns that the certificate is not trusted: it is this Mac's own.\n"
          "Choose to continue (Safari: Show Details -> visit this website). Keep the link to yourself.\n" % link)
    return link


def serve(port=8765, open_browser=True, host="127.0.0.1", phone=False):
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
    threading.Thread(target=morning, daemon=True).start()
    if phone:
        serve_phone(port + 1)
    url ="http://127.0.0.1:%d/" % port
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
