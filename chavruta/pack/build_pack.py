#!/usr/bin/env python3
"""Build a daf pack -- the precomputed artifact for one amud of Talmud.

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

API = "https://www.sefaria.org/api"

# The vocalized Davidson text is the one worth aligning against: it carries
# both nikud and punctuation, and the punctuation is Steinsaltz's reading of
# where each clause stops. That is exactly the judgement a learner gets wrong.
VOCALIZED = "William Davidson Edition - Vocalized Aramaic"

# Two different things live here, and conflating them is how you promise a
# learner Rabbeinu Chananel on a masechta he was never printed on.
#
# ROUTING is judgement: which commentator answers which kind of question. It is
# hand-authored, it is the moat, and no API will hand it to us.
ROUTING = {
    "meaning": ["Rashi", "Steinsaltz"],
    "conflict": ["Tosafot"],            # squaring this sugya with another: its whole function
    "structure": ["Steinsaltz"],        # plus the sugya map
    "logic": ["Ramban", "Rashba", "Ritva", "Ran", "Meiri"],
    "halacha": ["Rif", "Rosh"],         # then Ein Mishpat out to Rambam / Tur / Shulchan Arukh
    "on_the_page": ["Rashi", "Tosafot", "Rabbeinu Chananel"],
    "on_commentary": ["Maharsha"],
}

# COVERAGE is a fact about the data, so we ask Sefaria rather than guess -- see
# available(). Which Rishonim are strong on a tractate is judgement; which ones
# Sefaria actually holds is not.

# Sefaria tags every link with a category -- Commentary, Halakhah, Midrash,
# Talmud, Responsa, Reference -- and that tagging is what its connections panel
# is built from. It is the skeleton of "what did X say here / what is the law
# here", already done for all of shas, so the pack mirrors it rather than
# inventing a taxonomy of its own.
PANEL = ["Commentary", "Halakhah", "Talmud", "Tanakh", "Mishnah", "Midrash",
         "Responsa", "Quoting Commentary", "Reference", "Chasidut", "Musar", "Kabbalah"]

# Weight decides two things: what surfaces first when the panel opens, and what
# is heavy enough to precompute into the pack instead of fetching on demand.
# Anything printed on the daf itself outranks everything else, because that is
# what the learner is looking at while we talk.
WEIGHT = {
    "Rashi": 100, "Tosafot": 100, "Rabbeinu Chananel": 95, "Steinsaltz": 95,
    "Rif": 75, "Rosh": 70, "Tosafot HaRosh": 65,
    "Ramban": 60, "Rashba": 60, "Ritva": 60, "Ran": 55, "Meiri": 55,
    "Maharsha": 40, "Penei Yehoshua": 30, "Rashash": 30,
}
PRELOAD_ABOVE = 50  # heavier than this ships inside the pack; the rest is fetched live

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


def get(path, soft=False, **params):
    url = "%s/%s" % (API, urllib.parse.quote(path, safe="/:,-. "))
    if params:
        parts = []
        for key, value in params.items():
            for item in value if isinstance(value, list) else [value]:
                parts.append("%s=%s" % (key, urllib.parse.quote(str(item))))
        url += "?" + "&".join(parts)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                return json.load(response)
        except (urllib.error.URLError, TimeoutError) as exc:
            code = getattr(exc, "code", None)
            if soft and code == 404:
                return None
            if attempt == 3:
                if soft:
                    return None
                raise SystemExit("sefaria unreachable: %s (%s)" % (url, exc))
            time.sleep(2 ** attempt)


def plain(html):
    """Strip markup, leaving the words a person would read aloud."""
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
    index = get("v2/raw_index/%s" % title, soft=True) or {}
    schema = index.get("schema", {})
    if not schema.get("isSegmentLevelDiburHamatchil", True):
        return []
    return [re.compile(p) for p in (schema.get("diburHamatchilRegexes") or FALLBACK_DIBUR)]


def available(masechta, names):
    """Which of these commentators Sefaria actually holds on this masechta."""
    return [n for n in names
            if get("v2/raw_index/%s on %s" % (n, masechta), soft=True) is not None]


def wanted_for(masechta):
    """Everything the routing table might reach for, that Sefaria really has."""
    asked = list(dict.fromkeys(sum(ROUTING.values(), [])))
    asked = [n for n in asked if WEIGHT.get(n, 0) > PRELOAD_ABOVE]
    return available(masechta, sorted(asked, key=lambda n: -WEIGHT.get(n, 0)))


def fetch_daf(ref):
    """Pull the daf itself in both the vocalized source and the Davidson English."""
    data = get("v3/texts/%s" % ref, version=[VOCALIZED, "english"])
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
    for link in get("links/%s" % ref, with_text=1):
        anchor = link.get("anchorRef") or link.get("ref", "")
        segment = anchor.rsplit(":", 1)[0] if ":" in anchor else anchor
        by_segment.setdefault(segment, []).append(link)
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
        "routing": ROUTING,
        "weights": WEIGHT,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "sefaria.org",
        # No sugya map yet -- it is written separately and checked against this.
        "sugyot": [],
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
