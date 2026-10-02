# -*- coding: utf-8 -*-
"""The same partner in a terminal, for testing a behaviour without a microphone.

    python3 -m chavruta.cli "Berakhot 2a"

Say what you think a line means, and push. Lines starting with ":" move you:
:n next line, :p previous, :g 5 go to line 5, :s sources here, :q quit.
"""

import argparse
import os
import sys

from . import env
from .ground import render
from .llm import LLM
from .partner import Partner


def main():
    env.load(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("ref", nargs="?", default="Berakhot 2a")
    ap.add_argument("--depth", default="daf", choices=["daf", "rishonim", "acharonim"])
    ap.add_argument("--language", default="auto", choices=["auto", "he", "en"])
    args = ap.parse_args()

    from .server import load_pack
    pack = load_pack(args.ref)
    partner = Partner(pack, LLM(), depth=args.depth, language=args.language)
    n, history = 1, []
    print("%s — %d lines. :h for help." % (pack.ref, len(pack.segments)))
    print("\n" + pack.segment(n)["he"])
    while True:
        try:
            said = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return 0
        if not said:
            continue
        if said in (":q", ":quit"):
            return 0
        if said in (":h", ":help"):
            print(__doc__)
            continue
        if said in (":n", ":p") or said.startswith(":g"):
            if said == ":n":
                n = min(n + 1, len(pack.segments))
            elif said == ":p":
                n = max(n - 1, 1)
            else:
                try:
                    n = max(1, min(int(said.split()[1]), len(pack.segments)))
                except (IndexError, ValueError):
                    print("  :g takes a line number")
                    continue
            print("\nline %d: %s" % (n, pack.segment(n)["he"]))
            continue
        if said == ":s":
            for name, e in pack.sources_for(n):
                print("  %-16s %s" % (name, (e.get("dibur") or e["he"])[:60]))
            continue
        try:
            text, verdict, history, trace = partner.ask(n, history, said)
        except Exception as exc:
            print("  %s: %s" % (type(exc).__name__, exc))
            continue
        print("\n" + render(text))
        print("  [%s%s]" % (trace["kind"], " · opened " + ", ".join(trace["opened"]) if trace["opened"] else ""))
        if not verdict.ok:
            print("  ungrounded: " + verdict.complaint())


if __name__ == "__main__":
    sys.exit(main())
