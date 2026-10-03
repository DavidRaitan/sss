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
SCANS = []   # what was asked of the HebrewBooks stand-in


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
        if url.path.startswith("/hy/"):
            # Stands in for a Halacha Yomit page: menus around one halacha.
            page = ("<html><head><title>זמן קריאת שמע של ערבית | הלכה יומית</title><script>var x=1;</script></head>"
                    "<body><nav><a>דף הבית</a><a>הלכות</a></nav><div class='menu'>תפריט</div>"
                    "<div class='halacha'><p>מי שלא קרא קריאת שמע של ערבית עד חצות הלילה, יקרא עד עלות השחר, "
                    "וכן פסק מרן רבינו עובדיה יוסף זצוק\"ל, שהעיקר כדעת רבן גמליאל.</p>"
                    "<p>ומכל מקום לכתחילה יש להקדים ולקרוא קודם חצות, כדי להרחיק את האדם מן העבירה.</p></div>"
                    "<footer>כל הזכויות שמורות להלכה יומית</footer></body></html>")
            body = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path == "/hb/log":
            return self.reply({"scans": SCANS})
        if url.path == "/hb/shas.aspx":
            # Stands in for HebrewBooks: an amud of the Vilna Shas as a PDF (one stand-in page for every amud).
            SCANS.append({k: v[0] for k, v in q.items()})
            with open(os.path.join(HERE, "scan_sample.pdf"), "rb") as handle:
                body = handle.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/pdf")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path.startswith("/daf/"):
            # Stands in for a D.A.F. point-by-point outline page (English).
            page = ("<html><head><title>POINT BY POINT OUTLINE - %s</title></head><body>"
                    "<div class='nav'>Home | Daf Yomi | Outlines</div>"
                    "<p>1) THE TIME FOR THE EVENING SHEMA: The Mishnah gives three opinions for the latest time -- "
                    "R. Eliezer until the end of the first watch, the Chachamim until midnight, R. Gamliel until dawn.</p>"
                    "<p>2) WHY THE MISHNAH BEGINS WITH THE NIGHT: The Tana relies on the verse \"when you lie down and "
                    "when you rise\", and follows the order of creation.</p></body></html>") % url.path.rsplit("/", 1)[-1]
            body = page.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            return self.wfile.write(body)
        if url.path == "/w/api.php":
            # Stands in for Hebrew Wikisource's MediaWiki API.
            if q.get("action") == ["query"]:
                return self.reply({"query": {"search": [{"title": "שער הציון/רלה", "snippet": "..."}]}})
            return self.reply({"parse": {"title": q.get("page", [""])[0], "text":
                "<div><p>(א) עד חצות – כדי להרחיק אדם מן העבירה, ובדיעבד עד עמוד השחר, כמבואר בגמרא ובפוסקים.</p></div>"}})
        if url.path == "/api/calendars":
            # Same shape as Sefaria's; today's daf pinned to a recorded page.
            return self.reply({"date": "2026-09-28", "timezone": q.get("timezone", ["UTC"])[0], "calendar_items": [
                {"title": {"en": "Parashat Hashavua", "he": "פרשת השבוע"}, "ref": "Deuteronomy 32:1-52"},
                {"title": {"en": "Daf Yomi", "he": "דף יומי"}, "ref": "Berakhot 2",
                 "displayValue": {"en": "Berakhot 2", "he": "ברכות ב׳"}}]})
        if url.path == "/zmanim":
            # Stands in for hebcal.com's zmanim, same shape.
            day = q.get("date", ["2026-09-28"])[0]
            return self.reply({"date": day, "location": {"title": "Jerusalem"}, "times": {
                "sunset": day + "T18:21:00+03:00", "tzeit7083deg": day + "T18:44:00+03:00",
                "tzeit85deg": day + "T18:50:00+03:00", "tzeit72min": day + "T19:33:00+03:00",
                "chatzotNight": day + "T23:51:00+03:00", "alotHaShachar": day + "T05:04:00+03:00",
                "sunrise": day + "T06:30:00+03:00"}})
        # Who they were: trimmed from real responses recorded 2026-09-28.
        path = urllib.parse.unquote(url.path)
        if path.startswith("/api/v2/index/"):
            title = path[len("/api/v2/index/"):].replace("_", " ")
            if title in INDEXES:
                return self.reply(INDEXES[title])
        if path.startswith("/api/v2/topics/"):
            slug = path[len("/api/v2/topics/"):]
            if slug in TOPICS:
                return self.reply(TOPICS[slug])
        if path.startswith("/api/name/"):
            query = urllib.parse.unquote(path[len("/api/name/"):]).lower()
            return self.reply(NAMES.get(query, {"completion_objects": []}))
        return self.reply({"error": "not recorded: %s" % url.path}, 404)


INDEXES = {
    "Rashba on Berakhot": {"title": "Rashba on Berakhot", "authors": [{"en": "Shlomo ibn Adret (Rashba)", "slug": "rashba1"}],
                           "enDesc": "Commentary on the Talmud written by the Rashba, Rabbi Shlomo ben Avraham ibn Aderet "
                                     "(1235–1310). Rashba was a student of Ramban and follows his methodology.",
                           "compDateString": {"en": " (c.1270  – c.1310 CE)"}, "compPlace": "Barcelona, Spain"},
    "Meiri on Berakhot": {"title": "Meiri on Berakhot", "authors": [{"en": "Menachem Meiri", "slug": "menachem-meiri"}]},
}
TOPICS = {
    "menachem-meiri": {"slug": "menachem-meiri", "primaryTitle": {"en": "Menachem Meiri", "he": "המאירי"},
                       "properties": {"birthYear": {"value": 1249}, "deathYear": {"value": 1315},
                                      "birthPlace": {"value": "Perpignan, France"}, "era": {"value": "RI"}},
                       "description": {"en": "Menachem ben Solomon Meiri was one of Provence's most important scholars."}},
    "rashba1": {"slug": "rashba1", "primaryTitle": {"en": "Shlomo ibn Adret (Rashba)", "he": "רשב\"א"},
                "properties": {"birthYear": {"value": 1235}, "deathYear": {"value": 1310},
                               "birthPlace": {"value": "Barcelona, Spain"}, "era": {"value": "RI"}}},
    "rabban-gamliel": {"slug": "rabban-gamliel", "primaryTitle": {"en": "Rabban Gamliel of Yavneh (II)", "he": "רבן גמליאל דיבנה"},
                       "properties": {"generation": {"value": "T3"}},
                       "description": {"en": "Rabban Gamliel (II) was a tannaitic sage in the first and second centuries CE."},
                       "links": {"learned-from": {"links": [{"topic": "rabban-yochanan-b-zakkai"}]},
                                 "taught": {"links": [{"topic": "rabbi-yehudah-b-ilai"}]}},
                       # as with_refs=1 answers: the passages Sefaria ties to him
                       "refs": {"about": {"refs": [{"ref": "Mishnah Rosh Hashanah 2:8-9"},
                                                   {"ref": "Berakhot 2a:4-5"}]}}},
    "rashba": {"slug": "rashba", "primaryTitle": {"en": "Rashba", "he": ""}},   # an empty stub
    "rabban-gamliel-hazaken-(i)": {"slug": "rabban-gamliel-hazaken-(i)",
                                   "primaryTitle": {"en": "Rabban Gamliel haZaken (I)", "he": "רבן גמליאל הזקן"},
                                   "properties": {"generation": {"value": "T1"}},
                                   "description": {"en": "Rabban Gamliel the Elder led the Sanhedrin in the first century CE."}},
    "rabbi-eliezer-b-hyrcanus": {"slug": "rabbi-eliezer-b-hyrcanus",
                                 "primaryTitle": {"en": "Rabbi Eliezer b. Hyrcanus", "he": "רבי אליעזר בן הורקנוס"},
                                 "properties": {"generation": {"value": "T3"}}},
}
# As Sefaria answers: an ambiguous name lists everyone who has it; an exact one
# also names its match at the top level.
NAMES = {"rabban gamliel": {"completion_objects": [
             {"title": "Rabban Gamliel haZaken (I)", "type": "PersonTopic", "key": "rabban-gamliel-hazaken-(i)"},
             {"title": "Rabban Gamliel of Yavneh (II)", "type": "PersonTopic", "key": "rabban-gamliel"},
             {"title": "Rabban Shimon ben Gamliel (II)", "type": "PersonTopic", "key": "rabban-shimon-b-gamliel-(ii)"}]},
         "rabbi eliezer": {"type": "PersonTopic", "key": "rabbi-eliezer-b-hyrcanus", "completion_objects": [
             {"title": "Rabbi Eliezer b. Hyrcanus", "type": "PersonTopic", "key": "rabbi-eliezer-b-hyrcanus"},
             {"title": "Rabbi Eliezer b. Yose", "type": "PersonTopic", "key": "rabbi-elazar-b-yose"}]}}


def start(port=0):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:%d/api" % server.server_address[1]


if __name__ == "__main__":
    server, url = start(int(os.environ.get("PORT", "8930")))
    print(url, flush=True)
    threading.Event().wait()
