# -*- coding: utf-8 -*-
"""Coming back to it: what we learned, and questions on it.

"I'm on daf vav and it's been a while -- what were the last six pages about?"
"What did we do yesterday?" The answer is built from the pages themselves: a
short recap of each amud, made once from its text (the Steinsaltz rendering
where there is one) by the cheap model and kept on disk, then told as one
story by the partner, citing each amud. What was learned when comes from the
sittings the app already records.
"""

import json
import os
import re
import threading

from . import sefaria

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SESSIONS_DIR = os.environ.get("CHAVRUTA_SESSIONS") or os.path.join(ROOT, "sessions")
PACKS = os.environ.get("CHAVRUTA_PACKS") or os.path.join(ROOT, "packs")
LOAD = None          # set by the server: ref -> Pack (built from Sefaria if need be)
MOST = 12            # amudim in one review: six dapim
_LOCK = threading.Lock()


def sittings(days=60):
    """[{"date": "2026-09-27", "refs": ["Berakhot 5a", ...]}], newest first:
    the amudim read or asked about, per day, in the order they came up."""
    try:
        names = sorted((n for n in os.listdir(SESSIONS_DIR) if n.endswith(".jsonl")), reverse=True)[:days]
    except OSError:
        return []
    out = []
    for name in names:
        refs = []
        try:
            with open(os.path.join(SESSIONS_DIR, name), encoding="utf-8") as handle:
                for line in handle:
                    try:
                        row = json.loads(line)
                    except ValueError:
                        continue
                    ref = row.get("ref")
                    if row.get("kind") in ("heard", "answer") and ref and ref not in refs:
                        refs.append(ref)
        except OSError:
            continue
        if refs:
            out.append({"date": name[:-6], "refs": refs})
    return out


WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
         "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "a couple": 2, "few": 3, "several": 4,
         "אחד": 1, "שני": 2, "שתי": 2, "שניים": 2, "שלוש": 3, "שלושה": 3, "ארבע": 4, "ארבעה": 4,
         "חמש": 5, "חמישה": 5, "שש": 6, "שישה": 6, "שבע": 7, "שבעה": 7, "שמונה": 8, "תשע": 9, "עשר": 10,
         "כמה": 3,
         # "ששת הדפים האחרונים": the construct forms, as people say them.
         "שלושת": 3, "ארבעת": 4, "חמשת": 5, "ששת": 6, "שבעת": 7, "שמונת": 8, "תשעת": 9, "עשרת": 10}
LAST_TIME = re.compile(r"\b(yesterday|last time|last session|last night|where (was i|we were|did we stop))\b|"
                       r"אתמול|בפעם הקודמת|פעם שעברה|איפה עצרנו|איפה הייתי", re.I)
AMUDIM = re.compile(r"\b(amud|amudim|sides?)\b|עמודים|עמוד", re.I)
SO_FAR = re.compile(r"\b(so far|until here|up to here|this (page|amud|daf))\b|עד כאן|עד עכשיו|הדף הזה", re.I)


def count(said):
    m = re.search(r"\b(\d{1,2})\b", said)
    if m:
        return int(m.group(1))
    low = said.lower()
    for word, n in sorted(WORDS.items(), key=lambda kv: -len(kv[0])):
        if re.search(r"(?<![\wא-ת])%s(?![\wא-ת])" % re.escape(word), low):
            return n
    return None


def which_pages(ref, said, history, today):
    """The amudim to recap: last time's, or the N dapim before this one."""
    if LAST_TIME.search(said):
        before = [s for s in history if s["date"] < today] or history
        if before:
            return before[0]["refs"][:MOST]
    masechta = ref.rsplit(" ", 1)[0]
    pages = sefaria.amudim(masechta)
    if ref not in pages:
        return []
    at = pages.index(ref)
    n = count(said) or 2
    amudim = n if AMUDIM.search(said) else n * 2
    end = at + 1 if SO_FAR.search(said) else at
    return pages[max(0, end - min(amudim, MOST)):end] or [ref]


PROMPT = """Summarize one amud of Talmud for someone who learned it and wants a
refresher: 2-4 sentences in English -- the question the amud deals with, the
positions or the argument, and where it lands. Hebrew and Aramaic terms in
Hebrew letters. Only what is in the text below; no sources outside it."""


def _path(ref):
    return os.path.join(PACKS, "_recap", ref.lower().replace(" ", "_") + ".json")


def recap(ref):
    """A short recap of one amud, as a citable entry under the amud's own ref."""
    path = _path(ref)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    if LOAD is None:
        return None
    pack = LOAD(ref)
    lines = []
    for seg in pack.segments:
        english = " ".join(s["text"] for s in seg.get("en", []) if s.get("text"))
        lines.append(english or seg["he"])
    body = "\n".join(lines)[:9000]
    if not body.strip():
        return None
    from .llm import LLM
    summary = LLM().say(PROMPT, [{"role": "user", "content": "%s\n\n%s" % (ref, body)}], heavy=False,
                        max_tokens=600)
    if not summary:
        return None
    entry = {"ref": ref, "he": summary.strip(), "dibur": None, "fetched": True, "recap": True}
    with _LOCK:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(entry, handle, ensure_ascii=False)
    return entry


QUIZ_OPENING = {"en": "That's the end of the amud. Want a few quick questions on it before you go on?",
                "he": "סיימנו את העמוד. רוצה כמה שאלות חזרה לפני שממשיכים?"}
