# -*- coding: utf-8 -*-
"""python3 -m chavruta             open the app
   python3 -m chavruta doctor      check that everything it needs works, and say what does not
   python3 -m chavruta prefetch    build every page of Berakhot now, so each opens instantly
"""

import argparse
import os
import sys

from . import env

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env.load(os.path.join(ROOT, ".env"))


def doctor():
    """Each thing that can be wrong, checked for real, with what to do about it."""
    from . import sefaria
    from .llm import LLM, ModelError
    ok = True
    llm = LLM()

    def line(label, good, text, fix=""):
        print("%-11s %s %s" % (label, "✓" if good else "✗", text))
        if not good and fix:
            print("            → %s" % fix)
        return good

    print("provider    %s   (heavy %s, cheap %s)" % (llm.provider, llm.heavy, llm.cheap))
    key = os.environ.get("OPENAI_API_KEY") if llm.provider == "openai" else os.environ.get("ANTHROPIC_API_KEY")
    ok &= line("key", bool(key), "found" if key else "missing", "put OPENAI_API_KEY=... in chavruta/.env")

    try:
        got = sefaria.get("v3/texts/Berakhot 2a:1", version=sefaria.VERSIONS[0])
        ok &= line("sefaria", bool((got or {}).get("versions")), "reachable" if got else "answered, but no text")
    except Exception as exc:
        ok &= line("sefaria", False, "unreachable (%s)" % exc, "check the internet connection")

    try:
        pack = sefaria.build("Berakhot 2a")
        comments = sum(len(v) for s in pack["segments"] for v in s["commentaries"].values())
        on_page = sum(len(s["commentaries"].get(n, [])) for s in pack["segments"] for n in ("Rashi", "Tosafot"))
        ok &= line("page", on_page > 5, "Berakhot 2a: %d lines, %d comments, %d Rashi+Tosafot"
                   % (len(pack["segments"]), comments, on_page), "the Sefaria format may have changed")
    except Exception as exc:
        ok &= line("page", False, "could not build Berakhot 2a (%s)" % exc)

    if key and llm.provider == "openai":
        try:
            names = set(llm.models())
            for role, model in (("heavy", llm.heavy), ("cheap", llm.cheap), ("hearing", llm.stt), ("voice", llm.tts)):
                near = sorted(n for n in names if n.split("-")[0] == model.split("-")[0])[:5]
                ok &= line(role, model in names, model, "not visible to this key; try one of: " + ", ".join(near))
        except ModelError as exc:
            ok &= line("models", False, str(exc), "is the key valid and funded?")
        try:
            reply = llm.say("Answer with one word.", [{"role": "user", "content": "Say: ready"}], heavy=False)
            ok &= line("thinking", bool(reply), "the cheap model answered: %r" % reply[:30])
        except ModelError as exc:
            ok &= line("thinking", False, str(exc)[:160])

    log = os.path.join(ROOT, "chavruta.log")
    if os.path.exists(log):
        errors = [l for l in open(log, encoding="utf-8", errors="replace") if " ERROR " in l][-3:]
        if errors:
            print("\nlast problems in chavruta.log:")
            for l in errors:
                print("  " + l.strip()[:200])
    print("\n%s" % ("all good — run ./run.sh" if ok else "fix what is marked ✗, then run ./run.sh doctor again"))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(prog="chavruta", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", nargs="?", default="serve", choices=["serve", "doctor", "prefetch"])
    ap.add_argument("what", nargs="?", default="Berakhot", help="for prefetch: a masechta or one amud")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--lan", action="store_true",
                    help="listen on the local network too (the microphone needs https on a phone)")
    args = ap.parse_args()
    if args.command == "doctor":
        return doctor()
    if args.command == "prefetch":
        from . import prefetch
        return prefetch.run(args.what)
    from .server import serve
    serve(port=args.port, open_browser=not args.no_browser, host="0.0.0.0" if args.lan else "127.0.0.1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
