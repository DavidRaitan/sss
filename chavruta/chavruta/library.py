# -*- coding: utf-8 -*-
"""Past the page: going to get a source while the learner waits.

The pack holds what Sefaria links to the amud, and for most of the conversation
that is enough. But a chavruta asked "was this codified in the Tur?" does not
say "I don't have the Tur here". They reach for it. The page already names where
to go -- the ein mishpat points at the Rambam, the Tur and the Shulchan Arukh;
the Rif's links lead to Rabbeinu Yonah; the Shulchan Arukh's lead to the
Mishnah Berurah -- so going there is a few requests, made in parallel, and
cached for the rest of the sitting.

Everything fetched comes back as a plain entry with its exact ref, so the
grounding gate treats it like anything else in the pack: citable because it was
actually read, and only then.
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait

from . import sefaria

_TEXTS, _LINKS = {}, {}
_LOCK = threading.Lock()
POOL = ThreadPoolExecutor(max_workers=6)
# How long a turn may wait on Sefaria in total. Past this the partner answers
# from what did arrive and says what did not.
DEADLINE = 14.0


def _key(name):
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


def name_of(ref):
    """What people call the book a ref is in: "Tur, Orach Chayim 235" -> "Tur"."""
    if ref.startswith("Mishneh Torah"):
        return "Rambam"
    if ref.startswith("Shulchan Arukh"):
        return "Shulchan Arukh"
    if ref.startswith("Sefer Mitzvot Gadol"):
        return "Semag"
    title = ref.split(" on ")[0] if " on " in ref else ref.split(",")[0]
    return title.rsplit(" ", 1)[0] if title[-1:].isdigit() else title


def text(ref):
    """The Hebrew of any ref as plain text, or None if Sefaria has none."""
    with _LOCK:
        if ref in _TEXTS:
            return _TEXTS[ref]
        # A cited night's times open in the panel like any other source.
        for entry in _ZMANIM.values():
            if entry and entry["ref"] == ref:
                return entry
    data = sefaria.get("v3/texts/%s" % ref, soft=True, version="source")
    entry = None
    for version in (data or {}).get("versions", []):
        if version.get("languageFamilyName") == "hebrew" or version.get("actualLanguage") == "he":
            he = sefaria.plain(version.get("text"))
            if he:
                entry = {"ref": data.get("ref") or ref, "he": he, "he_ref": data.get("heRef"),
                         "dibur": None, "fetched": True}
                break
    with _LOCK:
        _TEXTS[ref] = entry
    return entry


def links(ref):
    """Everything Sefaria links to a ref, with the text of each."""
    with _LOCK:
        if ref in _LINKS:
            return _LINKS[ref]
    found = sefaria.get("links/%s" % ref, soft=True, with_text=1) or []
    found = found if isinstance(found, list) else []
    with _LOCK:
        _LINKS[ref] = found
    return found


def follow(ref, want):
    """The comments of one work hanging off a ref: [(name, entry)], in order.

    `want` is matched against the work's own name ("Mishnah Berurah",
    "Rabbeinu Yonah"). Only comments on this exact ref: a seif of the Shulchan
    Arukh links to Mishnah Berurah notes on three other simanim too, which
    merely quote it ("Quoting Commentary").
    """
    out = []
    for link in links(ref):
        name = sefaria.commentator(link)
        if _key(name) != _key(want) or link.get("category") != "Commentary":
            continue
        anchor = link.get("anchorRef") or ""
        if anchor and anchor != ref:
            continue
        body = sefaria.plain(link.get("he"))
        if body:
            out.append((name, {"ref": link.get("ref"), "he": body, "dibur": None, "fetched": True}))
    out.sort(key=lambda pair: _order(pair[1]["ref"]))
    return out


def _order(ref):
    tail = ref.rsplit(" ", 1)[-1]
    return [int(p) if p.isdigit() else 0 for p in tail.replace("-", ":").split(":")]


def gather(jobs):
    """Run fetch jobs side by side. Each job is ("text", ref) or ("follow", ref, name).

    Returns (found, missed): found is [(name, entry)] in job order; missed is the
    jobs that came back empty or ran out of time.
    """
    started = time.time()
    futures = []
    for job in jobs:
        if job[0] == "text":
            futures.append((job, POOL.submit(text, job[1])))
        elif job[0] == "zmanim":
            futures.append((job, POOL.submit(zmanim, job[1])))
        elif job[0] == "person":
            futures.append((job, POOL.submit(person, job[1], job[2])))
        else:
            futures.append((job, POOL.submit(follow, job[1], job[2])))
    wait([f for _, f in futures], timeout=DEADLINE)
    found, missed = [], []
    for job, future in futures:
        if not future.done():
            missed.append(job)
            continue
        try:
            result = future.result()
        except Exception:
            result = None
        if not result:
            missed.append(job)
        elif job[0] == "text":
            found.append((name_of(result["ref"]), result))
        elif job[0] == "zmanim":
            found.append(("Zmanim", result))
        elif job[0] == "person":
            found.append(("About " + job[1], result))
        else:
            found.extend(result)
    return found, missed, round(time.time() - started, 1)


def cached(job):
    """Whether a job would be answered without going out -- then nothing is announced."""
    with _LOCK:
        if job[0] == "zmanim":
            return job[1] in _ZMANIM
        if job[0] == "person":
            return (job[1], job[2]) in _PEOPLE
        return (job[1] in _TEXTS) if job[0] == "text" else (job[1] in _LINKS)


# -- who they were ---------------------------------------------------------------

# "When did he live? Who came first -- was he the Rashba's student?" Sefaria
# keeps this for its authors and for the sages of the Mishnah and Gemara:
# years and places, the generation of a tanna or amora, a short biography, and
# who taught whom. A commentary's index names its author (and often says whose
# student he was); the name search finds a sage who wrote no book. Wikipedia's
# summary is used only when Sefaria has no description at all.
_PEOPLE = {}
WIKI_API = os.environ.get("CHAVRUTA_WIKI_API", "https://en.wikipedia.org/api/rest_v1/page/summary/")
GENERATION = {"T": "tanna (sage of the Mishnah era)", "A": "amora (sage of the Gemara era)",
              "Z": "zug (one of the pairs before the tannaim)", "P": "prophet", "M": "member of the Great Assembly"}
ERA = {"GN": "Geonim", "RI": "Rishonim", "AH": "Acharonim", "CO": "contemporary", "T": "Tannaim", "A": "Amoraim"}


def _human(slug):
    """'rabbi-yehudah-b-ilai' -> 'Rabbi Yehudah b Ilai' (for teachers and students)."""
    words = slug.replace("-(", " (").replace("-", " ").split()
    return " ".join("ben" if w == "b" else w if w.startswith("(") else w[:1].upper() + w[1:] for w in words)


def _topic(slug):
    data = sefaria.get("v2/topics/%s" % slug, soft=True, with_links=1, group_related=1) or {}
    if not data.get("slug"):
        return None
    props = {k: (v or {}).get("value") for k, v in (data.get("properties") or {}).items()}
    lines = ["%s (%s)" % ((data.get("primaryTitle") or {}).get("en") or slug,
                          (data.get("primaryTitle") or {}).get("he") or "")]
    born, died = props.get("birthYear"), props.get("deathYear")
    if born or died:
        lines.append("lived %s–%s%s" % (born or "?", died or "?",
                                        ", " + props["birthPlace"] if props.get("birthPlace") else ""))
    gen = props.get("generation")
    if gen and gen[:1] in GENERATION:
        lines.append("%s, generation %s" % (GENERATION[gen[:1]], gen[1:]))
    if props.get("era") in ERA:
        lines.append("era: %s" % ERA[props["era"]])
    about = (data.get("description") or {}).get("en") or props.get("enBio")
    links = data.get("links") or {}
    teachers = [_human(l["topic"]) for l in (links.get("learned-from") or {}).get("links", [])][:5]
    students = [_human(l["topic"]) for l in (links.get("taught") or {}).get("links", [])][:6]
    if teachers:
        lines.append("teachers: " + ", ".join(teachers))
    if students:
        lines.append("students: " + ", ".join(students))
    if not about and props.get("enWikiLink"):
        about = _wiki(props["enWikiLink"].rsplit("/", 1)[-1])
    if about:
        lines.append(re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", about).replace("*", ""))
    return "; ".join(lines)


def _wiki(title):
    try:
        request = urllib.request.Request(WIKI_API + urllib.parse.quote(title), headers={"User-Agent": "chavruta/0.3"})
        with urllib.request.urlopen(request, timeout=6) as response:
            return (json.load(response).get("extract") or "")[:700]
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return ""


def person(name, book=None):
    """Who someone was, as a citable entry. `book` is the index title of their
    commentary on this page ("Meiri on Berakhot"), when there is one."""
    key = (name, book)
    with _LOCK:
        if key in _PEOPLE:
            return _PEOPLE[key]
    parts, slugs = [], []
    if book:
        index = sefaria.get("v2/index/%s" % book, soft=True) or {}
        slugs = [a.get("slug") for a in index.get("authors") or [] if a.get("slug")]
        when = (index.get("compDateString") or {}).get("en")
        if index.get("enDesc") or when:
            parts.append("%s%s: %s" % (book, " written" + when if when else "",
                                       index.get("enDesc") or ""))
    if not slugs:
        found = sefaria.get("name/%s" % name, soft=True, limit=5) or {}
        slugs = [o["key"] for o in found.get("completion_objects") or []
                 if o.get("type") in ("AuthorTopic", "PersonTopic") and o.get("key")][:1]
    for slug in slugs[:2]:
        about = _topic(slug)
        if about:
            parts.append(about)
    entry = None
    if parts:
        entry = {"ref": "About %s (Sefaria)" % name, "he": "\n".join(parts), "dibur": None, "fetched": True}
    with _LOCK:
        _PEOPLE[key] = entry
    return entry


# -- the clock: real times for a real night --------------------------------------

# "Give me numbers -- when is the last time, in summer and in winter?" is a
# question about tonight in a real place. Hebcal publishes the zmanim for any
# date and place, free; Jerusalem unless set otherwise.
ZMANIM_API = os.environ.get("CHAVRUTA_ZMANIM_API", "https://www.hebcal.com/zmanim")
PLACE = os.environ.get("CHAVRUTA_GEONAMEID", "281184")          # Jerusalem
PLACE_NAME = os.environ.get("CHAVRUTA_PLACE", "Jerusalem")
_ZMANIM = {}
# The night that begins on the evening of the date: its start from that day's
# times, its dawn from the next morning's.
EVENING = [("sunset", "sunset (shkiah)"), ("tzeit7083deg", "nightfall, three stars (tzeit, 7.08°)"),
           ("tzeit85deg", "nightfall, stricter (tzeit, 8.5°)"),
           ("tzeit72min", "nightfall per Rabbeinu Tam (72 min)"), ("chatzotNight", "midnight (chatzot halayla)")]
MORNING = [("alotHaShachar", "dawn (alot hashachar)"), ("sunrise", "sunrise (netz)")]


def _hebcal(date):
    url = "%s?%s" % (ZMANIM_API, urllib.parse.urlencode({"cfg": "json", "geonameid": PLACE, "date": date}))
    request = urllib.request.Request(url, headers={"User-Agent": "chavruta/0.3"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response).get("times") or {}


def _clock(value):
    # "2026-09-28T18:21:00+03:00" -> "2026-09-28 18:21": the day is kept, since
    # midnight and dawn belong to the next one.
    return value[:10] + " " + value[11:16] if len(value) >= 16 else value


def zmanim(date):
    """The times of the night beginning on the evening of `date` (YYYY-MM-DD), at PLACE."""
    with _LOCK:
        if date in _ZMANIM:
            return _ZMANIM[date]
    entry = None
    try:
        import datetime
        evening = _hebcal(date)
        following = (datetime.date.fromisoformat(date) + datetime.timedelta(days=1)).isoformat()
        morning = _hebcal(following)
        lines = ["%s: %s" % (label, _clock(evening[key])) for key, label in EVENING if evening.get(key)]
        lines += ["%s: %s" % (label, _clock(morning[key])) for key, label in MORNING if morning.get(key)]
        if lines:
            entry = {"ref": "Zmanim for %s, night of %s (hebcal.com)" % (PLACE_NAME, date),
                     "he": "; ".join(lines) + ".", "dibur": None, "fetched": True}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError, KeyError):
        entry = None
    with _LOCK:
        _ZMANIM[date] = entry
    return entry
