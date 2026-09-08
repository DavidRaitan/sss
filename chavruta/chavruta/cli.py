# -*- coding: utf-8 -*-
"""Learn with the partner in text, before any of it is spoken.

Disagreeing well is the hardest thing this product does and the likeliest to be
flat, so it gets proved here -- where a bad answer costs one line of typing --
rather than through a voice stack that would hide it behind latency and ASR.

    python3 -m chavruta.cli packs/berakhot_2a.json

Read a line, say what you think it means, and push. Misread something on
purpose and see whether it catches you.
"""

import argparse
import os
import sys

from .ground import render
from .pack import Pack
from .partner import Partner

HELP = """  :n / :p     next / previous line        :g N   go to line N
  :s          what sources are on this line  :l    show the line again
  :q          quit
Anything else is said to your chavruta."""


def show_line(pack, n):
    segment = pack.segment(n)
    print("\n\033[1m%s\033[0m" % segment["ref"])
    print(segment["he"])
    stops = " | ".join(c["he"] for c in segment["clauses"])
    if len(segment["clauses"]) > 1:
        print("\033[2mstops: %s\033[0m" % stops)


def show_sources(pack, n):
    rows = pack.sources_for(n)
    if not rows:
        print("  nothing on this line in this pack.")
    for name, entry in rows:
        struct = entry.get("structure") or {}
        shape = " ".join(m["kind"][:4] for m in struct.get("moves", []))
        print("  %-12s %-34s %s" % (name, (entry.get("dibur") or "")[:34], shape))
    segment = pack.segment(n)
    if segment.get("halacha"):
        print("  halacha:  " + ", ".join(segment["halacha"]))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", help="path to a pack JSON")
    parser.add_argument("--line", type=int, default=1, help="segment to start on")
    parser.add_argument("--effort", default="high",
                        choices=["low", "medium", "high", "xhigh", "max"],
                        help="thinking effort; lower is faster and less careful")
    args = parser.parse_args()

    pack = Pack.load(args.pack)
    if not os.environ.get("ANTHROPIC_API_KEY") and not os.environ.get("ANTHROPIC_AUTH_TOKEN"):
        print("No ANTHROPIC_API_KEY set -- export one, or run `ant auth login`.",
              file=sys.stderr)

    partner = Partner(pack, effort=args.effort)
    n, history = args.line, []

    print("%s -- %d lines. :h for commands." % (pack.ref, len(pack.segments)))
    if pack.is_fixture:
        print("\033[33m%s\033[0m" % pack.fixture_note)
    show_line(pack, n)
    for name, entry in pack.machlokes_on(n):
        print("\033[2mthere is a machlokes here (%s)\033[0m" % name)

    while True:
        try:
            said = input("\n> ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            return
        if not said:
            continue
        if said in (":q", ":quit"):
            return
        if said in (":h", ":help"):
            print(HELP)
            continue
        if said in (":n", ":p", ":l") or said.startswith(":g "):
            if said == ":n":
                n = min(n + 1, len(pack.segments))
            elif said == ":p":
                n = max(n - 1, 1)
            elif said.startswith(":g "):
                try:
                    n = max(1, min(int(said.split()[1]), len(pack.segments)))
                except (ValueError, IndexError):
                    print("  :g takes a line number.")
                    continue
            # Moving is a new position on the page, not a new conversation --
            # what they already said they understood still counts against them.
            show_line(pack, n)
            continue
        if said == ":s":
            show_sources(pack, n)
            continue

        try:
            text, verdict, history = partner.ask(n, history, said)
        except Exception as exc:  # network, auth, rate limit -- say which
            print("  \033[31m%s: %s\033[0m" % (type(exc).__name__, exc))
            continue
        print("\n" + render(text))
        if not verdict.ok:
            print("\033[31m[ungrounded: %s]\033[0m" % verdict.complaint())


if __name__ == "__main__":
    main()
