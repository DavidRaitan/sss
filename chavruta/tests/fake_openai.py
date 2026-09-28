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
    if re.search(r"from now on|turn off your voice|always bring|leave out", low):
        changes = []
        if "hebrew" in low:
            changes.append({"name": "language", "value": "he"})
        if "english" in low:
            changes.append({"name": "language", "value": "en"})
        if "turn off your voice" in low:
            changes.append({"name": "speak", "value": False})
        if "leave out the meiri" in low:
            changes.append({"name": "favor", "value": {"name": "Meiri", "value": -1}})
        return {"kind": "settings", "claim": False, "names": [], "navigate": None, "language": "en",
                "reply": None, "settings": changes}
    if re.search(r"remind me|last time|last \w+ pages|what did we learn|refresh", low):
        return {"kind": "review", "claim": False, "names": [], "navigate": None, "language": "en", "reply": None}
    if re.search(r"test me|quiz me|ask me questions", low):
        return {"kind": "quiz", "claim": False, "names": [], "navigate": None, "language": "en", "reply": None}
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
    if system.startswith("Summarize one amud"):
        return "%s: the gemara asks when the evening Shema may be read, and brings the three views." \
            % last.split("\n", 1)[0]
    # Only what was fetched for this turn: earlier fetches ride along for a few turns.
    now = last.split("[fetched from the library just now", 1)[1] if "[fetched from the library just now" in last else ""
    recaps = re.findall(r"\[\[(\w+ \d+[ab])\]\] Recap", now)
    if recaps:
        return " ".join("On %s [[%s]] the gemara asks about the evening Shema." % (r.split()[-1], r)
                        for r in recaps) + " Want to go back into one?"
    if "Want a few quick questions" in last or re.search(r"\btest me\b|quiz", last, re.I):
        return "First question: why does the Mishnah open with the evening Shema?"
    rashi = re.search(r"\[\[(Rashi on [^\]]+)\]\]", system)
    ref = rashi.group(1) if rashi else "Berakhot 2a:1"
    if "UNGROUNDED" in last and not any("[from the app" in m["content"] for m in messages):
        return "The Rashba says the opposite, and so does Rashi."
    site = re.search(r"\[\[((?:Halacha Yomit|Wikisource): [^\]]+)\]\]", now)
    tur = re.search(r"\[\[(Tur, [^\]]+)\]\]", now)
    if tur:
        return ("The Tur [[%s]] rules like Rabban Gamliel -- «והלכה כר\"ג» -- even לכתחלה, until dawn." % tur.group(1)
                + (" Halacha Yomit [[%s]] brings Rav Ovadia's ruling the same way." % site.group(1)
                   if site and site.group(1).startswith("Halacha") else ""))
    if site:
        return "Halacha Yomit [[%s]] brings Rav Ovadia's ruling: one who did not read before midnight reads until dawn." \
            % site.group(1) if site.group(1).startswith("Halacha") else \
            "The Sha'ar HaTziyun [[%s]] brings the sources." % site.group(1)
    fetched = re.search(r"\[\[(Tur, [^\]]+)\]\]", last)
    if "fetched from the library just now" in last and fetched:
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
        if path == "/control/latency":
            STATE["latency"] = float(json.loads(raw)["seconds"])
            return self.reply({"ok": True})
        if path.endswith("/responses"):
            # Web search limited to the trusted sites: the pages it found.
            body = json.loads(raw)
            STATE["log"].append({"path": "search", "input": body.get("input"),
                                 "domains": [d for t in body.get("tools") or []
                                             for d in (t.get("filters") or {}).get("allowed_domains") or []]})
            domains = [d for t in body.get("tools") or [] for d in (t.get("filters") or {}).get("allowed_domains") or []]
            url = "https://www.dafyomi.co.il/shabbos/points/sh-ps-002.htm" if "dafyomi.co.il" in domains \
                else "https://halachayomit.co.il/he/ReadHalacha.aspx?HalachaID=4521"
            return self.reply({
                "id": "resp_1", "object": "response", "created_at": 0, "status": "completed",
                "model": body.get("model"), "parallel_tool_calls": True, "tool_choice": "auto", "tools": [],
                "output": [
                    {"type": "web_search_call", "id": "ws_1", "status": "completed",
                     "action": {"type": "search", "query": body.get("input"),
                                "sources": [{"type": "url", "url": url}]}},
                    {"type": "message", "id": "msg_1", "role": "assistant", "status": "completed",
                     "content": [{"type": "output_text", "text": "Found it.", "annotations": [
                         {"type": "url_citation", "url": url, "title": "זמן קריאת שמע של ערבית",
                          "start_index": 0, "end_index": 5}]}]}]})
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
            STATE["log"][-1]["stream"] = bool(body.get("stream"))
            if body.get("stream"):
                # Server-sent events, a few words a chunk, as the real API streams.
                self.send_response(200)
                self.send_header("Content-Type", "text/event-stream")
                self.end_headers()
                words = re.findall(r"\S+\s*", content)
                for i in range(0, len(words), 3):
                    chunk = {"id": "x", "object": "chat.completion.chunk", "created": 0, "model": body.get("model"),
                             "choices": [{"index": 0, "delta": {"content": "".join(words[i:i + 3])},
                                          "finish_reason": None}]}
                    self.wfile.write(("data: %s\n\n" % json.dumps(chunk, ensure_ascii=False)).encode("utf-8"))
                    self.wfile.flush()
                    time.sleep(0.02)
                done = {"id": "x", "object": "chat.completion.chunk", "created": 0, "model": body.get("model"),
                        "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]}
                self.wfile.write(("data: %s\n\ndata: [DONE]\n\n" % json.dumps(done)).encode("utf-8"))
                self.wfile.flush()
                return
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
            # About as long as the words would take to say, so pausing can be tested.
            data = wav(seconds=min(6.0, max(0.4, len(body.get("input", "")) / 45.0)))
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
