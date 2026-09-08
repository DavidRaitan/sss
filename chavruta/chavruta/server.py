# -*- coding: utf-8 -*-
"""The local app: type a daf, read it, and talk to it.

One process, standard library only apart from the model SDK. Packs are built
from Sefaria the first time a page is opened and cached on disk, so the second
visit to a daf is instant and free.
"""

import io
import json
import os
import posixpath
import threading
import traceback
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import sefaria
from .llm import LLM, ModelError
from .pack import Pack
from .partner import Partner

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
PACKS = os.path.join(ROOT, "packs")

TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript",
         ".css": "text/css", ".json": "application/json; charset=utf-8"}

# Conversations, per browser tab. In memory: a session is one sitting.
SESSIONS = {}
LOCK = threading.Lock()


def pack_path(ref):
    return os.path.join(PACKS, ref.lower().replace(" ", "_").replace(":", "_") + ".json")


def load_pack(ref, rebuild=False):
    """From disk if we have the real thing, from Sefaria otherwise.

    A fixture on disk is never good enough to serve. It exists so the app runs
    with no network, and left to satisfy a request it silently shows three
    hand-typed lines in place of the daf -- which is the exact failure this
    product cannot have. So a fixture is treated as absent, and only comes back
    if Sefaria genuinely cannot be reached.
    """
    path = pack_path(ref)
    stale = None
    if os.path.exists(path) and not rebuild:
        pack = Pack.load(path)
        if not pack.is_fixture:
            return pack
        stale = pack

    masechta = ref.rsplit(" ", 1)[0]
    # Everything on the daf in one request -- what enters the prompt is decided
    # later, per turn, by retrieve.py.
    wanted = sefaria.wanted_for(masechta, wide=True)
    try:
        data = sefaria.build(ref, wanted)
    except SystemExit:
        if stale is not None:
            return stale
        raise
    os.makedirs(PACKS, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    return Pack(data)


class Handler(BaseHTTPRequestHandler):
    server_version = "chavruta"

    def log_message(self, fmt, *args):
        if "/api/" in (args[0] if args else ""):
            print("  %s" % (fmt % args))

    # -- plumbing --------------------------------------------------------------

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path):
        if not os.path.isfile(path):
            return self.send_json({"error": "not found"}, 404)
        with open(path, "rb") as handle:
            body = handle.read()
        self.send_response(200)
        self.send_header("Content-Type",
                         TYPES.get(os.path.splitext(path)[1], "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    # -- routes ----------------------------------------------------------------

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(url.query)
        if url.path in ("/", "/index.html"):
            return self.send_file(os.path.join(WEB, "index.html"))
        if url.path == "/api/health":
            return self.send_json(self.health())
        if url.path == "/api/find":
            # Sefaria resolves partial and Hebrew names to real refs, so typing
            # "berachot 2" or "ברכות ב" lands on the daf without knowing how
            # Sefaria spells it.
            q = (query.get("q") or [""])[0].strip()
            if len(q) < 2:
                return self.send_json({"matches": []})
            found = sefaria.get("name/%s" % q, soft=True, limit=8) or {}
            matches = [c for c in (found.get("completions") or []) if c][:8]
            return self.send_json({"matches": matches, "is_ref": bool(found.get("is_ref"))})
        if url.path == "/api/daf":
            ref = (query.get("ref") or [""])[0].strip()
            if not ref:
                return self.send_json({"error": "no ref"}, 400)
            try:
                pack = load_pack(ref, rebuild=bool(query.get("rebuild")))
            except SystemExit as exc:
                return self.send_json({"error": str(exc)}, 502)
            except Exception as exc:
                return self.send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, 500)
            return self.send_json(pack.data)
        # Static files, confined to web/.
        rel = posixpath.normpath(url.path).lstrip("/")
        target = os.path.normpath(os.path.join(WEB, rel.replace("web/", "", 1)))
        if not target.startswith(WEB):
            return self.send_json({"error": "no"}, 403)
        return self.send_file(target)

    def do_POST(self):
        route = urllib.parse.urlparse(self.path).path
        if route == "/api/transcribe":
            return self.transcribe()
        if route != "/api/say":
            return self.send_json({"error": "not found"}, 404)
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            return self.send_json({"error": "bad json"}, 400)

        ref = (body.get("ref") or "").strip()
        said = (body.get("said") or "").strip()
        line = int(body.get("line") or 1)
        level = body.get("level") or "standard"
        session = body.get("session") or "default"
        if not ref or not said:
            return self.send_json({"error": "need ref and said"}, 400)

        try:
            pack = load_pack(ref)
            with LOCK:
                history = SESSIONS.get(session, [])
            partner = Partner(pack, LLM(), level=level)
            text, verdict, history, trace = partner.ask(line, history, said)
            with LOCK:
                # A sitting is bounded; keep it from growing without limit.
                SESSIONS[session] = history[-40:]
            return self.send_json({
                "text": text, "grounded": verdict.ok,
                "problem": None if verdict.ok else verdict.complaint(),
                "trace": trace,
            })
        except ModelError as exc:
            return self.send_json({"error": str(exc)}, 502)
        except Exception as exc:
            traceback.print_exc()
            return self.send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, 500)

    def transcribe(self):
        """Audio in, text out, for speech the browser cannot handle.

        The browser's own recogniser is free and instant but takes one language
        at a time, which is the wrong shape for someone who says a sentence in
        English with the Aramaic still in it. This path costs money and handles
        that, so the two sit side by side and the learner picks.
        """
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return self.send_json({"error": "no audio"}, 400)
        audio = self.rfile.read(length)
        try:
            from .llm import LLM
            client = LLM().client
            buffer = io.BytesIO(audio)
            buffer.name = "speech.webm"  # the SDK infers the format from this
            result = client.audio.transcriptions.create(
                model=os.environ.get("CHAVRUTA_MODEL_STT", "gpt-transcribe"),
                file=buffer,
                # Naming what it is about to hear is the cheapest accuracy win
                # available: without it, Aramaic inside an English sentence
                # comes back as approximate English words.
                prompt=("Someone studying Talmud aloud. Speech mixes English with "
                        "Hebrew and Aramaic mid-sentence, and includes terms like "
                        "gemara, sugya, machlokes, Rashi, Tosafot, mishna."),
            )
            return self.send_json({"text": (result.text or "").strip()})
        except Exception as exc:
            return self.send_json({"error": "%s: %s" % (type(exc).__name__, exc)}, 502)

    def health(self):
        llm = LLM()
        state = {"provider": llm.provider, "heavy": llm.heavy, "cheap": llm.cheap,
                 "key": bool(os.environ.get("OPENAI_API_KEY")
                             or os.environ.get("ANTHROPIC_API_KEY")),
                 "packs": sorted(f[:-5].replace("_", " ")
                                 for f in os.listdir(PACKS)) if os.path.isdir(PACKS) else []}
        return state


def serve(port=8765, open_browser=True):
    os.makedirs(PACKS, exist_ok=True)
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = "http://127.0.0.1:%d/" % port
    print("chavruta -> %s   (ctrl-c to stop)" % url)
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
