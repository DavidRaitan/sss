#!/usr/bin/env python3
"""Check a pack against live Sefaria, word for word.

The one failure this product cannot survive is a corrupted source, and a pack
is a cache: caches drift, and a text edited upstream will not announce itself.
This re-fetches every text the pack holds and reports any that differ.

    python3 pack/verify_pack.py packs/berakhot_2a.json
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import sefaria  # noqa: E402


def words(text):
    return " ".join(sefaria.unpointed(sefaria.plain(text)).split())


def fetch(ref, version):
    data = sefaria.get("v3/texts/%s" % ref, soft=True, version=version)
    for v in (data or {}).get("versions", []):
        return words(v.get("text"))
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("pack")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()
    with open(args.pack, encoding="utf-8") as handle:
        pack = json.load(handle)
    checked = bad = missing = 0
    for seg in pack["segments"]:
        items = [(seg["ref"], seg["he"], sefaria.VERSIONS[0])]
        items += [(e["ref"], e["he"], "source") for es in seg["commentaries"].values() for e in es]
        for ref, ours, version in items:
            checked += 1
            theirs = fetch(ref, version)
            if theirs is None:
                missing += 1
                print("MISSING  %s" % ref)
            elif words(ours) != theirs:
                bad += 1
                print("DIFFERS  %s" % ref)
                if args.verbose:
                    print("  pack:    %s\n  sefaria: %s" % (words(ours)[:150], theirs[:150]))
            elif args.verbose:
                print("ok       %s" % ref)
    print("\n%d checked, %d differ, %d missing" % (checked, bad, missing), file=sys.stderr)
    return 1 if (bad or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
