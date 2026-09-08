# -*- coding: utf-8 -*-
"""python3 -m chavruta        opens the app
   python3 -m chavruta doctor checks that everything it needs is reachable
"""

import argparse
import os
import sys

from . import env

env.load(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))
env.load(".env")


def doctor():
    """Check the three things that can be wrong, and say which."""
    from . import sefaria
    from .llm import LLM, ModelError

    ok = True
    llm = LLM()
    print("provider   %s" % llm.provider)
    print("models     heavy=%s  cheap=%s" % (llm.heavy, llm.cheap))

    key = os.environ.get("OPENAI_API_KEY") or os.environ.get("ANTHROPIC_API_KEY")
    print("key        %s" % ("found" if key else "MISSING -- put it in .env"))
    ok &= bool(key)

    print("sefaria    ", end="", flush=True)
    try:
        got = sefaria.get("v3/texts/Berakhot%202a.1", soft=True, version="source")
        print("reachable" if got else "UNREACHABLE -- check your network")
        ok &= bool(got)
    except Exception as exc:
        print("UNREACHABLE (%s)" % exc)
        ok = False

    if key:
        print("models api ", end="", flush=True)
        try:
            names = llm.models()
            print("%d models visible" % len(names))
            for want in (llm.heavy, llm.cheap):
                mark = "ok" if want in names else "NOT VISIBLE to this key"
                print("           %-22s %s" % (want, mark))
                if want not in names:
                    near = [n for n in names if n.split("-")[0] == want.split("-")[0]][:6]
                    if near:
                        print("           try instead: %s" % ", ".join(near))
                    ok = False
        except ModelError as exc:
            print("could not list (%s)" % exc)
    print("\n%s" % ("all good -- run `python3 -m chavruta`" if ok
                    else "fix the above, then run doctor again"))
    return 0 if ok else 1


def main():
    parser = argparse.ArgumentParser(prog="chavruta", description=__doc__)
    parser.add_argument("command", nargs="?", default="serve",
                        choices=["serve", "doctor"])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if args.command == "doctor":
        return doctor()
    from .server import serve
    serve(port=args.port, open_browser=not args.no_browser)
    return 0


if __name__ == "__main__":
    sys.exit(main())
