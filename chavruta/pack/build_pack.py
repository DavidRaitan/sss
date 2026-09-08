#!/usr/bin/env python3
"""Build a daf pack from Sefaria and write it to disk.

    python3 pack/build_pack.py "Berakhot 2a" -o packs/
    python3 pack/build_pack.py "Bava Metzia 59a" --wide -o packs/

The work is in chavruta/sefaria.py; this is the command-line front for it.
The server builds packs on demand, so this is for pre-warming a page you know
you will learn -- tomorrow's daf, the sugya you are preparing.
"""

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import sefaria


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ref", help='e.g. "Berakhot 2a"')
    parser.add_argument("-o", "--out", default="packs")
    parser.add_argument("--wide", action="store_true",
                        help="also pull the Rishonim beyond the printed page")
    parser.add_argument("--segments", help='limit to segments, e.g. "1-3"')
    args = parser.parse_args()

    masechta = args.ref.rsplit(" ", 1)[0]
    wanted = sefaria.wanted_for(masechta, wide=args.wide)
    pack = sefaria.build(args.ref, wanted, sefaria.parse_range(args.segments))

    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, args.ref.lower().replace(" ", "_") + ".json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(pack, handle, ensure_ascii=False, indent=2)
    print("%s: %d segments, %s -> %s" % (
        args.ref, len(pack["segments"]), ", ".join(wanted), path), file=sys.stderr)


if __name__ == "__main__":
    main()
