#!/usr/bin/env python3
"""Sefaria: fetching a daf and building its pack.

A pack holds everything the chavruta needs about a page, assembled once and
cached for every user who learns that daf. Nothing here is model-generated:
every field is retrieved from Sefaria, so any claim the chavruta later makes
about the page can be traced back to a live reference the learner can open.

The one exception is the sugya map (see build_sugya_map.py), which is written
by a model and then checked against the text in this pack.

Usage:
    python3 build_pack.py "Berakhot 2a" -o ../packs/
    python3 build_pack.py "Berakhot 2a" --segments 1-3 -o ../packs/

Needs outbound access to www.sefaria.org.
"""

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

from . import sugya

API = "https://www.sefaria.org/api"

# The vocalized Davidson text is the one worth aligning against: it carries
# both nikud and punctuation, and the punctuation is Steinsaltz's reading of
# where each clause stops. That is exactly the judgement a learner gets wrong.
VOCALIZED = "William Davidson Edition - Vocalized Aramaic"

from .commentators import WHO, backbone_for, wide_for

# Coverage is a fact and is probed (see available()); who answers what is
# judgement and lives in commentators.py. Weights come from there too.
WEIGHT = {name: entry["weight"] for name, entry in WHO.items()}

# Sefaria tags every link with a category -- Commentary, Halakhah, Midrash,
# Talmud, Responsa, Reference -- and that tagging is what its connections panel
# is built from. It is the skeleton of "what did X say here / what is the law
# here", already done for all of shas, so the pack mirrors it rather than
# inventing a taxonomy of its own.
PANEL = ["Commentary", "Halakhah", "Talmud", "Tanakh", "Mishnah", "Midrash",
         "Responsa", "Quoting Commentary", "Reference", "Chasidut", "Musar", "Kabbalah"]


# Ein Mishpat routes the sugya to where it lands in halacha. Sefaria types
# these links separately, which saves us from guessing.
HALACHA_LINK_TYPE = "ein mishpat / ner mitsvah"

TAG = re.compile(r"<[^>]+>")
# <b> and <strong> both mark literal talmud words inside a Steinsaltz gloss.
LITERAL_TAG = re.compile(r"</?(?:b|strong)\b[^>]*>", re.I)
# A clause ends at a full stop, question mark, or colon -- the sof pasuk of
# the printed gemara. Commas are a softer break and are kept inside the clause.
CLAUSE_END = re.compile(r"[^.?!:]+[.?!:]?")
# Rashi and Tosafot open with the words they are commenting on, then a dash.
# Sefaria ships the exact pattern per commentary in its index metadata, so we
# read it from there and keep these only for indexes that omit it.
FALLBACK_DIBUR = [r"^<b>(.+?)</b>", r"^(.{2,80}?)\s*[–—-]\s+"]


# Availability and dibur patterns are properties of a text, not of a session,
# so they are asked once per process rather than once per daf.
_SEEN = {}


def get(path, soft=False, **params):
    url = "%s/%s" % (API, urllib.parse.quote(path, safe="/:,-."))
    if params:
        parts = []
        for key, value in params.items():
            for item in value if isinstance(value, list) else [value]:
                parts.append("%s=%s" % (key, urllib.parse.quote(str(item))))
        url += "?" + "&".join(parts)
    # A soft call is a probe -- "does this text exist" -- and most of them are
    # expected to miss. Retrying those with backoff turned opening one daf into
    # a minute of waiting, so probes get one quick attempt and real fetches
    # keep the retries.
    attempts, timeout = (1, 6) if soft else (4, 30)
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(url, timeout=timeout) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as exc:
            if soft:
                return None
            if attempt == attempts - 1:
                if soft:
                    return None
                raise SystemExit("sefaria unreachable: %s (%s)" % (url, exc))
            time.sleep(2 ** attempt)


def plain(html):
    """Strip markup, leaving the words a person would read aloud.

    A link's text arrives as a string for a single comment and as a list when
    the link spans several, so both are flattened here rather than at every
    call site.
    """
    if isinstance(html, (list, tuple)):
        html = " ".join(plain(part) for part in html)
    return re.sub(r"\s+", " ", TAG.sub("", html or "")).strip()


def split_gloss(html):
    """Split a Steinsaltz gloss into literal talmud words and his expansion.

    Steinsaltz bolds the words that are actually on the daf and leaves his own
    connective explanation unbolded. That markup is a free word-level alignment
    between the raw Aramaic and its expansion -- the single most useful
    structure on Sefaria for this product. We keep it rather than flatten it.
    """
    spans = []
    for index, chunk in enumerate(LITERAL_TAG.split(html or "")):
        text = plain(chunk)
        if text:
            # split() alternates outside/inside the tag, so odd chunks are bold.
            spans.append({"kind": "text" if index % 2 == 0 else "daf", "text": text})
    return spans


def split_clauses(vocalized):
    """Break a segment at its printed stopping points.

    Where a learner stops is where a learner goes wrong, so these boundaries
    are ground truth for correcting a misread, not just display sugar.
    """
    clauses = []
    for match in CLAUSE_END.finditer(vocalized):
        text = match.group(0).strip()
        if text:
            clauses.append({
                "i": len(clauses),
                "he": text,
                "ends": text[-1] if text[-1] in ".?!:" else None,
            })
    return clauses


def dibur_patterns(title):
    """The patterns that split a comment's opening lemma from its body.

    Sefaria records these per commentary -- Rashi and Tosafot mark the lemma
    with a dash, others bold it -- so reading them beats one guessed regex.
    """
    if title not in _SEEN:
        _SEEN[title] = get("index/%s" % title, soft=True) or {}
    index = _SEEN[title]
    schema = index.get("schema", {})
    if not schema.get("isSegmentLevelDiburHamatchil", True):
        return []
    return [re.compile(p) for p in (schema.get("diburHamatchilRegexes") or FALLBACK_DIBUR)]


def available_from(links, names, masechta):
    """Who is actually on this daf, taken from the links we already fetched.

    Asking Sefaria "do you have Rashi on Berakhot" once per commentator is a
    request each, and answers a slightly different question than the one that
    matters: not whether a text exists somewhere in the masechta, but whether
    it is on the page in front of the learner. The links carry that already.
    """
    titles = {l.get("index_title") or "" for group in links.values() for l in group}
    found = []
    for name in names:
        # Pinned to this masechta on purpose: a daf quotes commentary from
        # other tractates, and "Rashbam on Pesachim" appearing in Berakhot's
        # links is not Rashbam being on this page.
        if any(t == name or t == "%s on %s" % (name, masechta) for t in titles):
            found.append(name)
    return found


def wanted_for(masechta, wide=True):
    """Everyone this masechta might want, before we know who is on the daf."""
    asked = backbone_for(masechta) + (wide_for(masechta) if wide else [])
    return list(dict.fromkeys(asked))


def fetch_daf(ref):
    """Pull the daf itself in both the vocalized source and the Davidson English."""
    # v3 wants "<language>|<title>". A bare title is accepted and silently
    # returns only the English, which reads downstream as a missing text.
    data = get("v3/texts/%s" % ref, version=["hebrew|" + VOCALIZED, "english"])
    source, english = [], []
    for version in data.get("versions", []):
        text = version.get("text") or []
        text = text if isinstance(text, list) else [text]
        if version.get("languageFamilyName") == "english":
            english = text
        elif version.get("versionTitle") == VOCALIZED:
            source = text
    if not source:
        raise SystemExit("no vocalized text for %s -- check the ref" % ref)
    return source, english


def fetch_links(ref):
    """Group every link on the daf by segment, then by commentator."""
    by_segment = {}
    for link in get("links/%s" % ref, with_text=1) or []:
        # anchorRef is already the segment this hangs off ("Berakhot 2a:1").
        # It was being shortened to the daf, so every per-segment lookup missed
        # and packs came out with no commentary at all.
        anchor = link.get("anchorRef") or link.get("ref", "")
        by_segment.setdefault(anchor, []).append(link)
    return by_segment


def commentator_of(link, wanted):
    """Match a link to a commentator we asked for, e.g. 'Rashi on Berakhot 2a:1:1'."""
    index = link.get("index_title") or link.get("collectiveTitle", {}).get("en") or ""
    for name in wanted:
        if index == name or index.startswith(name + " on "):
            return name
    return None


def build_segment(ref, number, source_html, english_html, links, wanted, patterns):
    vocalized = plain(source_html)
    segment = {
        "ref": "%s:%d" % (ref, number),
        "n": number,
        # Vocalized for display and for judging where the learner stopped.
        "he": vocalized,
        # Unpointed for fuzzy-matching degraded ASR against a known string.
        "he_plain": re.sub(r"[֑-ׇ]", "", vocalized),
        "clauses": split_clauses(vocalized),
        # Keeps the bold/unbold split rather than flattening it to a string.
        "en": split_gloss(english_html),
        "commentaries": {},
        "halacha": [],
        "xrefs": [],
        # Counts per category, so the panel can be drawn before anything loads.
        "panel": {},
    }
    for link in links:
        category = link.get("category")
        if category in PANEL:
            segment["panel"][category] = segment["panel"].get(category, 0) + 1
        name = commentator_of(link, wanted)
        body = plain(link.get("he") or link.get("text") or "")
        if name:
            opening = next(
                (m for p in patterns.get(name, []) for m in [p.match(body)] if m), None)
            segment["commentaries"].setdefault(name, []).append({
                "ref": link.get("ref"),
                # The words on the daf this comment hangs off -- our anchor for
                # "what does the commentary say about the line I just read".
                "dibur": opening.group(1).rstrip(" .:") if opening else None,
                "weight": WEIGHT.get(name, 20),
                "he": body,
                # The argument the comment states about itself, when it states one.
                "structure": sugya.structure(link.get("ref"), body),
                "en": plain(link.get("text") or "") if link.get("he") else None,
            })
        elif link.get("type") == HALACHA_LINK_TYPE:
            segment["halacha"].append(link.get("ref"))
        elif link.get("category") in ("Talmud", "Tanakh"):
            segment["xrefs"].append(link.get("ref"))
    return segment


def build(ref, wanted, only=None):
    source, english = fetch_daf(ref)
    links = fetch_links(ref)
    wanted = available_from(links, wanted, ref.rsplit(" ", 1)[0])
    patterns = {n: dibur_patterns("%s on %s" % (n, ref.rsplit(" ", 1)[0])) for n in wanted}
    segments = []
    for index, html in enumerate(source, start=1):
        if only and index not in only:
            continue
        segment_ref = "%s:%d" % (ref, index)
        segments.append(build_segment(
            ref, index, html,
            english[index - 1] if index <= len(english) else "",
            links.get(segment_ref, []), wanted, patterns,
        ))
    return {
        "ref": ref,
        "masechta": ref.rsplit(" ", 1)[0],
        "commentators": wanted,
        "weights": WEIGHT,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "sefaria.org",
        # No sugya map yet -- it is written separately and checked against this.
        "sugyot": [],
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", help='e.g. "Berakhot 2a"')
    parser.add_argument("-o", "--out", default=".", help="directory to write the pack into")
    parser.add_argument("--segments", help='limit to segments, e.g. "1-3" or "1,4,7"')
    args = parser.parse_args()

    masechta = args.ref.rsplit(" ", 1)[0]
    wanted = wanted_for(masechta)
    pack = build(args.ref, wanted, parse_range(args.segments))

    os.makedirs(args.out, exist_ok=True)
    name = args.ref.lower().replace(" ", "_").replace(":", "_") + ".json"
    path = os.path.join(args.out, name)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(pack, handle, ensure_ascii=False, indent=2)

    covered = sum(1 for s in pack["segments"] if s["commentaries"])
    print("%s: %d segments, %d with commentary -> %s"
          % (args.ref, len(pack["segments"]), covered, path), file=sys.stderr)


if __name__ == "__main__":
    main()
