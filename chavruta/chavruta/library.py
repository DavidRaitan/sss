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
        else:
            found.extend(result)
    return found, missed, round(time.time() - started, 1)


def cached(job):
    """Whether a job would be answered without going out -- then nothing is announced."""
    with _LOCK:
        if job[0] == "zmanim":
            return job[1] in _ZMANIM
        return (job[1] in _TEXTS) if job[0] == "text" else (job[1] in _LINKS)


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
