# -*- coding: utf-8 -*-
"""Warm the cache: build every pack of a masechta before you need it.

The idea from the design conversation -- "run it at five in the morning" --
except that a pack is the same for everyone on that daf, so this is a one-time
job per masechta rather than a nightly one. After it runs, every page opens
instantly and works with no connection to Sefaria at all.
"""

import sys
import time

from . import sefaria


def run(what, rebuild=False, out=sys.stdout):
    from .server import load_pack, pack_path, allowed
    import os
    refs = [what] if allowed(what) else sefaria.amudim(what)
    if not refs:
        print("nothing to build for %r -- try \"Berakhot\" or \"Berakhot 2a\"" % what, file=out)
        return 1
    built = cached = failed = 0
    for i, ref in enumerate(refs, 1):
        if os.path.exists(pack_path(ref)) and not rebuild:
            cached += 1
            continue
        try:
            pack = load_pack(ref, rebuild=rebuild)
            n = sum(len(v) for s in pack.segments for v in s["commentaries"].values())
            print("  %3d/%d  %-16s %2d lines, %3d comments" % (i, len(refs), ref, len(pack.segments), n), file=out)
            built += 1
            time.sleep(0.4)  # be polite to a free service
        except Exception as exc:
            print("  %3d/%d  %-16s FAILED: %s" % (i, len(refs), ref, exc), file=out)
            failed += 1
    print("\n%d built, %d already cached, %d failed" % (built, cached, failed), file=out)
    return 1 if failed else 0
