# -*- coding: utf-8 -*-
"""A stand-in Sefaria that replays real recorded responses.

The recordings in recorded/ were captured from the live API (Berakhot 2a-3b
texts, 2a and 2b links). Anything outside them gets a synthetic response in
the same shape, so paging across the whole masechta can still be exercised.

It is deliberately as strict as the real thing about the one detail that
broke the first version: a version must be named `language|versionTitle`.
"""

import gzip
import json
import os
import re
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "recorded")
LANGS = {"hebrew", "english", "source", "translation"}


def _load(name):
    path = os.path.join(HERE, name)
    if not os.path.exists(path):
        return None
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        return json.load(handle)


def _ref(path, prefix):
    raw = urllib.parse.unquote(path[len(prefix):])
    return re.sub(r"\.(?=\d)", " ", raw).replace("_", " ").strip()


def _neighbours(ref):
    m = re.match(r"^(.*) (\d+)([ab])$", ref)
    book, n, side = m.group(1), int(m.group(2)), m.group(3)
    nxt = "%s %d%s" % (book, n, "b") if side == "a" else "%s %da" % (book, n + 1)
    prv = "%s %db" % (book, n - 1) if side == "a" else "%s %da" % (book, n)
    return (nxt if n < 64 else None), (prv if (n, side) != (2, "a") else None)


def synthetic_text(ref):
    nxt, prv = _neighbours(ref)
    he = ["שׁוּרָה %d שֶׁל %s: אָמַר רַבִּי יוֹחָנָן, מַאי טַעְמָא? דִּכְתִיב קְרָא." % (i, ref)
          for i in range(1, 9)]
    en = ["<b>Line %d of %s:</b> Rabbi Yoḥanan said: What is the reason?" % (i, ref)
          for i in range(1, 9)]
    return {"ref": ref, "next": nxt, "prev": prv, "heRef": ref, "book": "Berakhot",
            "versions": [
                {"versionTitle": "William Davidson Edition - Vocalized Aramaic",
                 "languageFamilyName": "hebrew", "actualLanguage": "he", "text": he},
                {"versionTitle": "William Davidson Edition - English",
                 "languageFamilyName": "english", "actualLanguage": "en", "text": en}]}


def _name(ref):
    return ref.replace(" ", "_").replace(":", "_")


def texts(ref, versions):
    if not ref.startswith("Berakhot "):
        whole = _load("texts_%s.json.gz" % _name(ref))
        # A book other than the gemara: what the partner fetches on demand.
        data = whole or {"ref": ref, "heRef": ref, "versions": [
            {"versionTitle": "synthetic", "languageFamilyName": "hebrew", "actualLanguage": "he",
             "isSource": True, "text": "טקסט של %s לבדיקות." % ref}]}
        return dict(data, versions=[v for v in data["versions"] if v.get("languageFamilyName") == "hebrew"])
    line = None
    if re.search(r":\d+$", ref):             # a single line, as the health check asks
        ref, line = ref.rsplit(":", 1)
    data = _load("texts_%s.json.gz" % _name(ref)) or synthetic_text(ref)
    if line:
        data = dict(data, versions=[dict(v, text=v["text"][int(line) - 1]) for v in data["versions"]])
    wanted = []
    for v in versions:
        lang, _, title = v.partition("|")
        if lang not in LANGS:
            continue  # a bare title is not a version Sefaria recognises
        wanted.append((lang, title))
    out = []
    for version in data["versions"]:
        fam = version.get("languageFamilyName")
        for lang, title in wanted:
            if lang == "source" and fam == "hebrew" or \
               lang == fam and (not title or title == version.get("versionTitle")):
                out.append(version)
                break
    return dict(data, versions=out)


def links(ref):
    data = _load("links_%s.json.gz" % _name(ref))
    if data is not None:
        return data
    if not ref.startswith("Berakhot "):
        return []
    return [{"ref": "Rashi on %s:%d:1" % (ref, i), "anchorRef": "%s:%d" % (ref, i),
             "anchorRefExpanded": ["%s:%d" % (ref, i)], "category": "Commentary",
             "type": "commentary", "collectiveTitle": {"en": "Rashi", "he": "רש\"י"},
             "index_title": "Rashi on Berakhot",
             "he": "שורה %d – פירוש רש\"י על השורה הזאת:" % i, "text": ""} for i in (1, 3)]


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def reply(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        if url.path.startswith("/api/v3/texts/"):
            return self.reply(texts(_ref(url.path, "/api/v3/texts/"), q.get("version", [])))
        if url.path.startswith("/api/links/"):
            return self.reply(links(_ref(url.path, "/api/links/")))
        return self.reply({"error": "not recorded: %s" % url.path}, 404)


def start(port=0):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:%d/api" % server.server_address[1]


if __name__ == "__main__":
    server, url = start(int(os.environ.get("PORT", "8930")))
    print(url, flush=True)
    threading.Event().wait()
