#!/usr/bin/env python3
"""Build daf packs from Sefaria ahead of time.

    python3 pack/build_pack.py "Berakhot 2a"          one amud
    python3 pack/build_pack.py Berakhot               every amud of the masechta

The app builds packs itself the first time a page is opened; this is for
warming a whole masechta before you sit down (or before a flight).
"""

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from chavruta import prefetch  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("what", help='"Berakhot 2a", or a masechta name for all of it')
    parser.add_argument("--rebuild", action="store_true", help="fetch again even if cached")
    args = parser.parse_args()
    return prefetch.run(args.what, rebuild=args.rebuild)


if __name__ == "__main__":
    sys.exit(main())
