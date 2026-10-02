# -*- coding: utf-8 -*-
"""The learner's own notes, pinned to a line.

"Note: Rashi here reads the watch as a third of the night." "Save this." "What
did I note on this perek?" -- said aloud mid-sitting, kept on disk, one line of
JSON each, and shown as 📝 on the line they belong to.
"""

import json
import os
import re
import threading
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.environ.get("CHAVRUTA_NOTES") or os.path.join(ROOT, "notes.jsonl")
_LOCK = threading.Lock()

# "note: ...", "save this", "remember that ..." -- and in Hebrew.
TAKE = re.compile(r"^\W*(?:(?:ok(?:ay)?|so),?\s+)?(?:(?:please\s+)?(?:make a |take a |add a )?note(?: that| this| down)?|"
                  r"write (?:this |that )?down|save (?:this|that)(?: as a note)?|"
                  r"תרשום(?: לי)?|תכתוב(?: לי)?|תשמור(?: את זה)?|הערה)(?![\w\u05d0-\u05ea])[\s:,\-–—]*(.*)$",
                  re.I | re.S)
ASK = re.compile(r"\b(my notes|what did i (note|write|save)|read (me )?my notes|any notes)\b|"
                 r"ההערות שלי|מה רשמתי|מה כתבתי|מה שמרתי|יש לי הערות", re.I)
WIDE = re.compile(r"\b(masechta|tractate|everything|all)\b|במסכת|בכל|כל ההערות", re.I)


def taken(said):
    """What they asked to note ("" = save the last answer), or None if this is not a note."""
    m = TAKE.match(said.strip())
    if not m:
        return None
    return m.group(1).strip()


def add(ref, line, text, kind="note"):
    entry = {"ref": ref, "line": int(line or 1), "text": text.strip()[:1000], "kind": kind,
             "at": time.strftime("%Y-%m-%d %H:%M")}
    with _LOCK:
        with open(PATH, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def all_notes():
    try:
        with open(PATH, encoding="utf-8") as handle:
            rows = [json.loads(l) for l in handle if l.strip()]
    except (OSError, ValueError):
        return []
    return rows


def on(ref=None, masechta=None):
    """Notes on one amud, or on a whole tractate, in page order."""
    rows = all_notes()
    if ref:
        rows = [r for r in rows if r["ref"] == ref]
    elif masechta:
        rows = [r for r in rows if r["ref"].rsplit(" ", 1)[0] == masechta]
    return rows


def spoken(rows, language="en", here=None):
    """Notes read back in a few sentences."""
    he = language == "he"
    if not rows:
        return "אין לך הערות כאן עדיין." if he else "You have no notes here yet."
    out = []
    for r in rows[-8:]:
        where = ("שורה %d" % r["line"]) if r["ref"] == here else ("%s שורה %d" % (r["ref"], r["line"]) if he
                                                                    else "%s line %d" % (r["ref"], r["line"]))
        out.append("%s: %s" % (where if he else where.replace("שורה", "line"), r["text"]))
    lead = ("יש לך %d הערות. " % len(rows)) if he else ("You have %d note%s. " % (len(rows), "" if len(rows) == 1 else "s"))
    return lead + " · ".join(out)
