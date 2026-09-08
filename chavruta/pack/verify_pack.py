#!/usr/bin/env python3
"""Check a pack against live Sefaria, character for character.

The one failure this product cannot survive is a corrupted source, and a pack
is a cache -- caches drift, transcriptions carry typos, and a text edited
upstream will not announce itself. This is the guard: it re-fetches everything
the pack claims and reports any text that does not match.

Run it against fixture packs always, and against real packs before a session.

    python3 pack/verify_pack.py packs/berakhot_2a.json

Needs outbound access to www.sefaria.org. Exits non-zero if anything differs.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import sefaria as bp


def normalize(text):
    """Compare the words, not the whitespace or the markup."""
    return " ".join(bp.plain(text).split())


def fetch(ref):
    data = bp.get("v3/texts/%s" % ref, soft=True, version="source")
    if not data:
        return None
    for version in data.get("versions", []):
        text = version.get("text")
        if isinstance(text, list):
            return " ".join(normalize(t) for t in text)
        if text:
            return normalize(text)
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack")
    parser.add_argument("-v", "--verbose", action="store_true")
    args = parser.parse_args()

    with open(args.pack, encoding="utf-8") as handle:
        pack = json.load(handle)

    checked = missing = bad = 0
    for segment in pack["segments"]:
        for ref, ours in [(segment["ref"], segment["he"])] + [
                (e["ref"], e["he"])
                for entries in segment["commentaries"].values() for e in entries]:
            checked += 1
            theirs = fetch(ref)
            if theirs is None:
                missing += 1
                print("MISSING  %s -- Sefaria returned nothing" % ref)
            elif normalize(ours) != theirs:
                bad += 1
                print("DIFFERS  %s" % ref)
                if args.verbose:
                    print("  pack:    %s" % normalize(ours)[:160])
                    print("  sefaria: %s" % theirs[:160])
            elif args.verbose:
                print("ok       %s" % ref)

    print("\n%d checked, %d differ, %d missing" % (checked, bad, missing),
          file=sys.stderr)
    if pack.get("fixture") and not (bad or missing):
        print("fixture matches Sefaria -- safe to use for testing", file=sys.stderr)
    return 1 if (bad or missing) else 0


if __name__ == "__main__":
    sys.exit(main())
