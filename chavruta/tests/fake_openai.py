# -*- coding: utf-8 -*-
"""A stand-in OpenAI for end-to-end tests: chat, transcription, speech, models.

It behaves the way the parts of the real API this app leans on behave, and it
is strict where strictness catches bugs: it refuses reasoning_effort "none" on
the cheap model, so the app's fallback ladder gets exercised; it can be told to
answer without a citation first, so the grounding gate's retry gets exercised.

Tests steer it through /control: the next transcript, and a log of requests.
"""

import cgi
import io
import json
import re
import struct
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

STATE = {"transcripts": [], "log": [], "latency": 0.0}


def wav(seconds=0.4, rate=16000):
    """A short, valid, quiet WAV -- enough for a browser to play and finish."""
    n = int(seconds * rate)
    data = b"".join(struct.pack("<h", int(300 * ((i // 40) % 2 * 2 - 1))) for i in range(n))
    return (b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " +
            struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) +
            b"data" + struct.pack("<I", len(data)) + data)


def router(said):
    low = said.lower()
    nav = re.search(r"(?:daf|דף)\s*(\d+)\s*([ab])?", low)
    if nav or re.search(r"\bgo to (?:daf|page)\b", low):
        return {"kind": "navigate", "claim": False, "names": [],
                "navigate": {"daf": int(nav.group(1)) if nav else 3,
                             "amud": (nav.group(2) if nav and nav.group(2) else "a")},
                "language": "en"}
    if re.search(r"can you hear|hear me read|go ahead", low):
        return {"kind": "ping", "claim": False, "names": [], "navigate": None, "language": "en",
                "reply": "Yes, I hear you." if "can you" in low else "Go ahead."}
    names = [n for n in ("Rashba", "Ritva", "Meiri", "Rif", "Rashi", "Tosafot", "Tur",
                         "Shulchan Aruch", "Rama") if n.lower() in low]
    if re.search(r"read it (right|correctly)", low):
        kind = "check_reading"
    elif re.search(r"halacha|codified|\btur\b|shulchan", low):
        kind = "halacha"
    else:
        kind = "conflict" if "elsewhere" in low else "meaning"
    return {"kind": kind, "claim": "saying" in low, "names": names, "navigate": None,
            "language": "he" if re.search(r"[א-ת]{3}", said) else "en", "reply": None}


def partner(system, messages):
    last = messages[-1]["content"]
    rashi = re.search(r"\[\[(Rashi on [^\]]+)\]\]", system)
    ref = rashi.group(1) if rashi else "Berakhot 2a:1"
    if "UNGROUNDED" in last and not any("[from the app" in m["content"] for m in messages):
        return "The Rashba says the opposite, and so does Rashi."
    fetched = re.search(r"\[\[(Tur, [^\]]+)\]\]", last)
    if "fetched from Sefaria just now" in last and fetched:
        return ("The Tur [[%s]] rules like Rabban Gamliel -- «והלכה כר\"ג» -- even "
                "לכתחלה, until dawn." % fetched.group(1))
    swap = re.search(r"said «([^»]+)» where the page has «([^»]+)»", last)
    if swap:
        return "%s? I have «%s» here -- and that changes when the time starts." % swap.groups()
    if "[from the app" in last:
        return "Rashi [[%s]] reads «עד סוף האשמורה הראשונה» as a third of the night." % ref
    he = bool(re.search(r"Answer in Hebrew", last)) or \
        bool(re.search(r"[א-ת]{4}", last.split("\n")[-1]))
    if he:
        return ("זה לא מסתדר. תסתכל על «עד סוף האשמורה הראשונה» — רש״י [[%s]] "
                "מסביר שזה שליש הלילה, ולכן חכמים שאומרים «עד חצות» חולקים עליו." % ref)
    return ("That can't be right. Look at «עד סוף האשמורה הראשונה» — Rashi [[%s]] reads it "
            "as a third of the night, so the Rabbis at «עד חצות» are disagreeing with him." % ref)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def error(self, message, status=400, param=None):
        return self.reply({"error": {"message": message, "type": "invalid_request_error",
                                     "param": param, "code": None}}, status)

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        if path.endswith("/models"):
            ids = ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-transcribe", "gpt-4o-mini-tts"]
            return self.reply({"object": "list", "data": [{"id": i, "object": "model", "created": 0,
                                                           "owned_by": "openai"} for i in ids]})
        if path == "/control/log":
            return self.reply(STATE["log"])
        return self.error("not found", 404)

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length)
        if path == "/control/transcript":
            STATE["transcripts"].append(json.loads(raw)["text"])
            return self.reply({"queued": len(STATE["transcripts"])})
        if path == "/control/reset":
            STATE.update(transcripts=[], log=[])
            return self.reply({"ok": True})
        time.sleep(STATE["latency"])

        if path.endswith("/chat/completions"):
            body = json.loads(raw)
            STATE["log"].append({"path": "chat", "model": body.get("model"),
                                 "effort": body.get("reasoning_effort"),
                                 "json": bool(body.get("response_format")),
                                 "last": body["messages"][-1]["content"][-300:]})
            if body.get("model") == "gpt-5.6-luna" and body.get("reasoning_effort") == "none":
                return self.error("Unsupported value: 'reasoning_effort' does not support 'none' "
                                  "with this model.", param="reasoning_effort")
            system = body["messages"][0]["content"]
            if body.get("response_format"):
                said = body["messages"][-1]["content"]
                content = json.dumps(router(said), ensure_ascii=False)
            else:
                content = partner(system, body["messages"][1:])
            return self.reply({"id": "x", "object": "chat.completion", "created": 0,
                               "model": body.get("model"),
                               "choices": [{"index": 0, "finish_reason": "stop",
                                            "message": {"role": "assistant", "content": content}}],
                               "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})

        if path.endswith("/audio/transcriptions"):
            env = {"REQUEST_METHOD": "POST", "CONTENT_TYPE": self.headers["Content-Type"],
                   "CONTENT_LENGTH": str(length)}
            form = cgi.FieldStorage(fp=io.BytesIO(raw), environ=env)
            audio = form["file"].file.read() if "file" in form else b""
            STATE["log"].append({"path": "transcribe", "model": form.getvalue("model"),
                                 "bytes": len(audio), "prompt": (form.getvalue("prompt") or "")[:900]})
            text = STATE["transcripts"].pop(0) if STATE["transcripts"] else \
                "so he's saying you read shema whenever you go to sleep"
            return self.reply({"text": text})

        if path.endswith("/audio/speech"):
            body = json.loads(raw)
            STATE["log"].append({"path": "speech", "model": body.get("model"),
                                 "voice": body.get("voice"), "input": body.get("input")})
            data = wav()
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        return self.error("not found", 404)


def start(port=0):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:%d/v1" % server.server_address[1]
