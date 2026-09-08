#!/usr/bin/env python3
"""Index a whole masechta, so "I'm sure I learned this ten pages back" is answerable.

A pack knows one amud very well and knows nothing about the rest of the
tractate. That is the wrong shape for the question a learner actually asks --
"didn't we see this already", "isn't this the opposite of what it says later" --
because answering it means knowing where else a phrase turns up.

This walks every amud once, stores the bare consonantal text, and leaves a file
small enough to search instantly. Text only: no commentary, no translation. One
request per amud, so it takes a couple of minutes and then never again.

    python3 pack/build_index.py Berakhot
"""

import argparse
import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import sefaria, sugya
from chavruta.commentators import MASECHTOT

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "packs")


def amudim(m):
    for n in range(m["first"], m["last"] + 1):
        for side in ("a", "b"):
            if n == m["last"] and side != m.get("last_amud", "b"):
                continue
            yield "%s %d%s" % (m["name"], n, side)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("masechta", nargs="?", default="Berakhot")
    args = parser.parse_args()

    m = next((x for x in MASECHTOT if x["name"] == args.masechta), None)
    if not m:
        raise SystemExit("no such masechta configured: %s" % args.masechta)

    pages, started = {}, time.time()
    refs = list(amudim(m))
    for i, ref in enumerate(refs, 1):
        try:
            source, _ = sefaria.fetch_daf(ref)
        except SystemExit:
            print("  skipped %s" % ref, file=sys.stderr)
            continue
        segments = [{"n": j, "he": sefaria.plain(html)}
                    for j, html in enumerate(source, start=1)]
        pages[ref] = {
            # Unpointed, because that is what a search should match against.
            "lines": [sugya.bare(s["he"]) for s in segments],
            "sections": [{"label": s["label"], "from": s["from"], "to": s["to"]}
                         for s in sugya.sections(segments)],
        }
        if i % 10 == 0 or i == len(refs):
            print("  %d/%d  %s  (%.0fs)" % (i, len(refs), ref, time.time() - started),
                  file=sys.stderr)

    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, "_index_%s.json" % args.masechta.lower().replace(" ", "_"))
    with open(path, "w", encoding="utf-8") as handle:
        json.dump({"masechta": args.masechta, "pages": pages}, handle, ensure_ascii=False)
    print("%d amudim -> %s (%.1f MB)" % (
        len(pages), path, os.path.getsize(path) / 1e6), file=sys.stderr)


if __name__ == "__main__":
    main()
