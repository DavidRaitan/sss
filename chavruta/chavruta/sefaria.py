# -*- coding: utf-8 -*-
"""Sefaria: fetching an amud and building its pack.

Written against recorded responses from the live API (see tests/), because the
first version was written from memory and got two things wrong that together
meant no real page ever loaded: the text endpoint wants `language|versionTitle`,
not a bare title, and a link's anchor is the segment itself -- trimming its last
":n" detached every commentary from every line.

A pack holds everything retrieved about one amud. Nothing in it is generated,
apart from the argument structure read out of each commentary by sugya.py, and
that is extracted from the commentary's own words.
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from . import sugya
from .commentators import WHO

API = os.environ.get("CHAVRUTA_SEFARIA_API", "https://www.sefaria.org/api").rstrip("/")

# The vocalized Davidson text carries nikud and punctuation, and the punctuation
# is Steinsaltz's reading of where each clause stops -- which is the judgement a
# learner gets wrong. Fall back to the unvocalized edition, then to whatever
# Sefaria calls the source, rather than fail to open a page.
VERSIONS = [
    "hebrew|William Davidson Edition - Vocalized Aramaic",
    "hebrew|William Davidson Edition - Aramaic",
    "source",
]

# Commentary links carry their text; for everything else the reference is
# enough. A single cross-reference like "Berakhot 13a-22a" arrives with nine
# dapim of text attached, and none of it belongs in a pack.
KEEP_TEXT = {"Commentary"}

# Where the learner can go from a line, grouped the way Sefaria's own panel
# groups it. Capped so a heavily quoted line stays readable.
RELATED = ["Halakhah", "Talmud", "Tanakh", "Mishnah", "Midrash", "Responsa",
           "Jewish Thought", "Chasidut", "Musar", "Reference"]
RELATED_CAP = 30

TAG = re.compile(r"<[^>]+>")
LITERAL_TAG = re.compile(r"</?(?:b|strong)\b[^>]*>", re.I)
CLAUSE_END = re.compile(r"[^.?!:]+[.?!:]?")
NIKUD = re.compile(r"[֑-ׇ]")
# Rishonim bold their lemma, sometimes after a short marker -- "[מתני']:",
# "גמרא:", "(דף ב.)", "הכי גריס רש"י ז"ל:" -- so allow a little before it.
BOLD_OPENING = re.compile(r"^.{0,40}?<b>(.{1,220}?)</b>", re.S)
DASH_OPENING = re.compile(r"^(.{2,90}?)\s+[–—-]\s+")

_SEEN = {}

# Bumped whenever the pack's shape or meaning changes. Older packs on disk are
# rebuilt: version 1 packs had every commentary detached from its line;
# version 5 names who speaks in each move of an argument.
PACK_VERSION = 5


class SefariaError(RuntimeError):
    pass


def get(path, soft=False, **params):
    url = "%s/%s" % (API, urllib.parse.quote(path, safe="/:,-.|"))
    if params:
        pairs = []
        for key, value in params.items():
            for item in value if isinstance(value, list) else [value]:
                pairs.append((key, item))
        url += "?" + urllib.parse.urlencode(pairs)
    # A soft call is a probe that is allowed to miss; a real fetch retries.
    attempts, timeout = (1, 8) if soft else (3, 45)
    last = None
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "chavruta/0.3"})
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as exc:
            last = exc
            if soft or exc.code in (400, 404):
                break
        except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
            last = exc
            if soft:
                break
        if attempt < attempts - 1:
            time.sleep(1.5 * (attempt + 1))
    if soft:
        return None
    raise SefariaError("could not reach Sefaria for %s (%s)" % (path, last))


def plain(value):
    """Text a person would read, from a string or Sefaria's nested lists."""
    if value is None:
        return ""
    if isinstance(value, list):
        return " ".join(p for p in (plain(v) for v in value) if p)
    return re.sub(r"\s+", " ", TAG.sub("", str(value))).strip()


def unpointed(text):
    return NIKUD.sub("", text)


def split_gloss(html):
    """Keep Steinsaltz's split between the words on the daf and his expansion."""
    spans = []
    for index, chunk in enumerate(LITERAL_TAG.split(html or "")):
        text = plain(chunk)
        if text:
            spans.append({"kind": "text" if index % 2 == 0 else "daf", "text": text})
    return spans


def split_clauses(vocalized):
    """Break a line at its printed stopping points."""
    clauses = []
    for match in CLAUSE_END.finditer(vocalized):
        text = match.group(0).strip()
        if text:
            clauses.append({"i": len(clauses), "he": text,
                            "ends": text[-1] if text[-1] in ".?!:" else None})
    return clauses


def fetch_daf(ref):
    """The amud in the vocalized Davidson text and its English, plus where it sits."""
    source, english, meta = [], [], {}
    for version in VERSIONS:
        data = get("v3/texts/%s" % ref, version=[version, "english"])
        meta = {k: data.get(k) for k in ("next", "prev", "heRef", "book", "heTitle")}
        for v in data.get("versions", []):
            text = v.get("text") or []
            text = text if isinstance(text, list) else [text]
            if v.get("languageFamilyName") == "english" or v.get("actualLanguage") == "en":
                english = english or text
            elif not source:
                source, meta["version"] = text, v.get("versionTitle")
        if source:
            return source, english, meta
    raise SefariaError("Sefaria has no Hebrew text for %s" % ref)


def fetch_links(ref):
    return get("links/%s" % ref, with_text=1) or []


def commentator(link):
    """The name a link's commentary goes by, e.g. "Rashi", "Rif", "Tosafot HaRosh"."""
    name = (link.get("collectiveTitle") or {}).get("en")
    if name:
        return name
    index = link.get("index_title") or ""
    return index.split(" on ")[0] if " on " in index else index


def anchors(link, ref):
    """Which lines of this amud a link hangs off, as integers."""
    refs = link.get("anchorRefExpanded") or [link.get("anchorRef") or ""]
    lines = []
    for r in refs:
        m = re.match(r"^%s:(\d+)(?:-(\d+))?$" % re.escape(ref), r or "")
        if m:
            start = int(m.group(1))
            lines.extend(range(start, int(m.group(2) or start) + 1))
    return sorted(set(lines))


def opening_words(name, html, body):
    """The dibur hamatchil: the words on the daf a comment hangs off."""
    if name == "Steinsaltz":
        return None  # a running explanation, not a comment on a lemma
    raw = html if isinstance(html, str) else ""
    m = BOLD_OPENING.match(raw)
    if m:
        return plain(m.group(1)).rstrip(" .:")
    m = DASH_OPENING.match(body)
    return m.group(1).rstrip(" .:") if m else None


def build(ref):
    """Everything retrieved about one amud, ready to learn from."""
    source, english, meta = fetch_daf(ref)
    links = fetch_links(ref)
    masechta = ref.rsplit(" ", 1)[0]

    segments = []
    for n, html in enumerate(source, start=1):
        vocalized = plain(html)
        segments.append({
            "ref": "%s:%d" % (ref, n),
            "n": n,
            "he": vocalized,
            "he_plain": unpointed(vocalized),
            "clauses": split_clauses(vocalized),
            "en": split_gloss(english[n - 1] if n <= len(english) else ""),
            "commentaries": {},
            "halacha": [],
            "xrefs": [],
            "related": {},
            "panel": {},
        })
    by_n = {s["n"]: s for s in segments}

    for link in links:
        lines = [n for n in anchors(link, ref) if n in by_n]
        if not lines:
            continue
        category = link.get("category") or ""
        first = by_n[lines[0]]
        for n in lines:
            by_n[n]["panel"][category] = by_n[n]["panel"].get(category, 0) + 1

        if category in KEEP_TEXT:
            # Pinned to this masechta: a daf's links can carry commentary on
            # another tractate that quotes it, and that is not on this page.
            if masechta not in (link.get("index_title") or masechta):
                continue
            name = commentator(link)
            body = plain(link.get("he"))
            if not body:
                continue
            english_text = link.get("text")
            entry = {
                "ref": link.get("ref"),
                "dibur": opening_words(name, link.get("he"), body),
                "weight": WHO.get(name, {}).get("weight", 20),
                "he": body,
                "en": plain(english_text) if isinstance(english_text, str) else None,
                "structure": sugya.structure(link.get("ref"), body),
            }
            if len(lines) > 1:
                entry["span"] = [lines[0], lines[-1]]
            first["commentaries"].setdefault(name, []).append(entry)
        elif category == "Halakhah" and link.get("type") == "ein mishpat / ner mitsvah":
            first["halacha"].append(link.get("ref"))
        elif category in ("Talmud", "Tanakh", "Mishnah"):
            first["xrefs"].append(link.get("ref"))
        if category in RELATED:
            bucket = first["related"].setdefault(category, [])
            if len(bucket) < RELATED_CAP and link.get("ref") not in bucket:
                bucket.append(link.get("ref"))

    for segment in segments:
        for entries in segment["commentaries"].values():
            entries.sort(key=lambda e: e["ref"])

    present = sorted({c for s in segments for c in s["commentaries"]},
                     key=lambda c: -WHO.get(c, {}).get("weight", 20))
    return {
        "pack_version": PACK_VERSION,
        "ref": ref,
        "he_ref": meta.get("heRef"),
        "masechta": ref.rsplit(" ", 1)[0],
        "next": meta.get("next"),
        "prev": meta.get("prev"),
        "version": meta.get("version"),
        "commentators": present,
        "weights": {c: WHO.get(c, {}).get("weight", 20) for c in present},
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "sefaria.org",
        # Where a learner would start and stop: mishna, gemara, a baraita.
        "sections": sugya.sections(segments),
        "segments": segments,
    }


def parse_range(text):
    if not text:
        return None
    chosen = set()
    for part in text.split(","):
        if "-" in part:
            start, end = part.split("-")
            chosen.update(range(int(start), int(end) + 1))
        else:
            chosen.add(int(part))
    return chosen


def amudim(masechta):
    """Every amud of a masechta in order, from commentators.MASECHTOT."""
    from .commentators import MASECHTOT
    m = next((x for x in MASECHTOT if x["name"] == masechta), None)
    if not m:
        return []
    out = []
    for n in range(m["first"], m["last"] + 1):
        out.append("%s %da" % (masechta, n))
        if n < m["last"] or m.get("last_amud", "b") == "b":
            out.append("%s %db" % (masechta, n))
    return out
