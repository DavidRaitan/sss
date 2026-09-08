# -*- coding: utf-8 -*-
"""Assemble a pack from the offline fixture, using the real builder's parsing.

Same code path as build_pack.py -- only the fetch is replaced -- so a fixture
pack exercises the parsing rather than papering over it. Fixture packs are
marked as such and every consumer is expected to say so on screen.

    python3 pack/make_fixture.py
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import sefaria as bp
from chavruta import sugya as extract_sugya
from chavruta import fixture_source as fx

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packs")


def comment(ref, index_title, body):
    name = index_title.split(" on ")[0]
    patterns = [p for p in bp.FALLBACK_DIBUR]
    import re
    opening = next((m for p in patterns for m in [re.compile(p).match(body)] if m), None)
    return name, {
        "ref": ref,
        "dibur": opening.group(1).rstrip(" .:–-") if opening else None,
        "weight": bp.WEIGHT.get(name, 20),
        "he": body,
        "en": None,
        "structure": extract_sugya.structure(ref, body),
    }


def main():
    segments = []
    for i, (src, en) in enumerate(zip(fx.SOURCE, fx.ENGLISH), start=1):
        vocalized = bp.plain(src)
        seg = {
            "ref": "%s:%d" % (fx.DAF, i),
            "n": i,
            "he": vocalized,
            "he_plain": bp.re.sub(r"[֑-ׇ]", "", vocalized),
            "clauses": bp.split_clauses(vocalized),
            "en": bp.split_gloss(en),
            "commentaries": {},
            "halacha": fx.HALACHA if i == 1 else [],
            "xrefs": fx.XREFS if i == 1 else [],
            "panel": {},
        }
        for ref, category, index_title, body in fx.COMMENTS:
            if not ref.startswith("%s:%d" % (fx.DAF, i)) and \
               not ref.startswith("%s on %s:%d" % (index_title.split(" on ")[0], fx.DAF, i)):
                continue
            name, entry = comment(ref, index_title, body)
            seg["commentaries"].setdefault(name, []).append(entry)
            seg["panel"][category] = seg["panel"].get(category, 0) + 1
        if i == 1:
            seg["panel"]["Halakhah"] = len(fx.HALACHA)
            seg["panel"]["Talmud"] = len(fx.XREFS)
        segments.append(seg)

    pack = {
        "ref": fx.DAF,
        "masechta": fx.DAF.rsplit(" ", 1)[0],
        "commentators": sorted({c for s in segments for c in s["commentaries"]}),
        "weights": bp.WEIGHT,
        "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "source": "sefaria.org",
        # Loud on purpose. Everything downstream checks this and says so.
        "fixture": True,
        "fixture_note": ("Transcribed offline for testing. Not authoritative -- "
                         "rebuild with build_pack.py before showing a learner."),
        "sugyot": [],
        "segments": segments,
    }
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "berakhot_2a.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(pack, handle, ensure_ascii=False, indent=2)
    print("wrote %s (%d segments, %d comments)" % (
        os.path.normpath(path), len(segments),
        sum(len(v) for s in segments for v in s["commentaries"].values())), file=sys.stderr)


if __name__ == "__main__":
    main()
