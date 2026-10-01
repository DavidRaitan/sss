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
from .commentators import MASECHTOT

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SESSIONS_DIR = os.environ.get("CHAVRUTA_SESSIONS") or os.path.join(ROOT, "sessions")
PACKS = os.environ.get("CHAVRUTA_PACKS") or os.path.join(ROOT, "packs")
LOAD = None          # set by the server: ref -> Pack (built from Sefaria if need be)
MOST = 20            # amudim in one review: ten dapim
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


def has_recap(ref):
    return os.path.exists(_path(ref))


def _body(ref):
    """The amud's words for its recap: from its page if built, else the text
    alone -- one quick call, not the whole page with every commentary."""
    pack = ON_DISK(ref) if ON_DISK else None
    if pack:
        return "\n".join(" ".join(s["text"] for s in seg.get("en", []) if s.get("text")) or seg["he"]
                         for seg in pack.segments)
    data = sefaria.get("v3/texts/%s" % ref, soft=True, version="source")
    for version in (data or {}).get("versions", []):
        he = sefaria.plain(version.get("text"))
        if he:
            return he
    if LOAD is None:
        return ""
    return "\n".join(seg["he"] for seg in LOAD(ref).segments)


def recap(ref):
    """A short recap of one amud, as a citable entry under the amud's own ref."""
    path = _path(ref)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    if LOAD is None and ON_DISK is None:
        return None
    body = _body(ref)[:9000]
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


# -- "did we learn this?" and "where did I see this?" ----------------------------

ON_DISK = None       # set by the server: ref -> Pack if built, else None (never fetches)
MISHNA = re.compile(r"\bmishn?ah?\b|המשנה|משנה", re.I)
STOP = {"את", "של", "על", "עם", "זה", "זו", "הוא", "היא", "מה", "למה", "איפה", "אנחנו", "למדנו", "ראיתי",
        "ראינו", "אתמול", "כבר", "פעם", "הזה", "הזאת", "כאן", "שם", "אולי", "אני", "חושב", "זוכר"}
BAVLI = re.compile(r"^(%s) (\d+)([ab]):" % "|".join(re.escape(m["name"]) for m in MASECHTOT))


def terms(said):
    """What to look for: a quoted phrase, else the Hebrew words of what they said."""
    quoted = re.findall(r"[«\"״“]([^»\"״”]{3,40})[»\"״”]", said)
    if quoted:
        return quoted[:2]
    words = [w for w in re.findall(r"[א-ת\"׳״']{3,}", said) if w not in STOP]
    return words[:4]


def _distance(ref, here):
    """Nearer pages first: this amud, its neighbours, this masechta, then elsewhere."""
    m, h = BAVLI.match(ref + ":"), BAVLI.match(here + ":")
    if not (m and h):
        return 10 ** 6
    if m.group(1) != h.group(1):
        return 10 ** 5
    return abs((int(m.group(2)) * 2 + (m.group(3) == "b")) - (int(h.group(2)) * 2 + (h.group(3) == "b")))


def studied_on(learned):
    """{amud: the dates it was learned}."""
    out = {}
    for sitting in learned:
        for ref in sitting["refs"]:
            out.setdefault(ref, []).append(sitting["date"])
    return out


def find_words(words, here, learned, limit=6):
    """Lines holding these words, in the pages they learned and the pages
    already on disk around here -- nearest first. [(line ref, text, dates)]."""
    if not words or ON_DISK is None:
        return []
    dates = studied_on(learned)
    masechta = here.rsplit(" ", 1)[0]
    pool = list(dates) + sefaria.amudim(masechta)
    pool = sorted(dict.fromkeys(pool), key=lambda r: (r not in dates, _distance(r, here)))[:80]
    hits = []
    for ref in pool:
        pack = ON_DISK(ref)
        if pack is None:
            continue
        for seg in pack.segments:
            if any(w.replace('"', "").replace("״", "") in seg["he_plain"] for w in words):
                hits.append((seg["ref"], seg["he_plain"][:160], dates.get(ref, [])))
                break
        if len(hits) >= limit:
            break
    return hits


def parallels(pack, n, learned, limit=4):
    """Where the page itself points for this passage elsewhere in the Bavli
    (Mesoret HaShas): nearest first, marked when they learned it."""
    sec = next((s for s in pack.data.get("sections") or [] if s["from"] <= n <= s["to"]), None)
    lines = range(sec["from"], sec["to"] + 1) if sec else [n]
    dates = studied_on(learned)
    refs = []
    for i in lines:
        for ref in pack.segment(i).get("xrefs", []):
            if BAVLI.match(ref) and not ref.startswith(pack.ref + ":") and ref not in refs:
                refs.append(ref)
    refs.sort(key=lambda r: _distance(r.split(":")[0], pack.ref))
    return [(r, dates.get(r.split(":")[0], [])) for r in refs[:limit]]


def find_mishna(ref, n, load, reach=24):
    """The mishna this part of the gemara is on: on this page above the line,
    or walking back page by page. A citable entry, or None."""
    masechta = ref.rsplit(" ", 1)[0]
    pages = sefaria.amudim(masechta)
    if ref not in pages:
        return None
    at = pages.index(ref)
    for i in range(at, max(-1, at - reach), -1):
        pack = load(pages[i])
        if pack is None:
            return None
        mishnas = [s for s in pack.data.get("sections") or []
                   if s["kind"] == "mishna" and (i < at or s["from"] <= n)]
        if mishnas:
            sec = mishnas[-1]
            lines = [pack.segment(k) for k in range(sec["from"], sec["to"] + 1)]
            english = " ".join(s["text"] for seg in lines for s in seg.get("en", []) if s.get("text"))
            body = "\n".join(seg["he"] for seg in lines) + ("\n\n(Steinsaltz) " + english if english else "")
            first, last = lines[0]["ref"], lines[-1]["ref"]
            return {"ref": first if first == last else "%s-%s" % (first, last.rsplit(":", 1)[1]),
                    "he": body[:6000], "dibur": None, "fetched": True, "amud": pages[i]}
    return None


def recap_quietly(ref):
    """After a page is learned: its recap, made in the background, so "did we
    learn this?" can be answered from every page they studied."""
    try:
        recap(ref)
    except Exception:
        pass
