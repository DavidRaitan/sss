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

import threading
import time
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
        else:
            found.extend(result)
    return found, missed, round(time.time() - started, 1)


def cached(job):
    """Whether a job would be answered without going out -- then nothing is announced."""
    with _LOCK:
        return (job[1] in _TEXTS) if job[0] == "text" else (job[1] in _LINKS)
