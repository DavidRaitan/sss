# -*- coding: utf-8 -*-
"""Where on the page is the learner?

The spec's central technical bet: reading aloud is not a transcription problem.
The text of the amud is already known, so what we are doing is finding a noisy
string inside a known one. Speech recognition garbles Aramaic, but garbled
Aramaic still lines up with the page far better than it lines up with anything
else, and that is enough to know which line they are on, whether they are
reading or talking, and where they stopped.

That last one feeds the only correction the partner is allowed to make about
someone's reading: not which words they said -- we cannot hear that reliably and
must never pretend to -- but where they broke the sentence, which is printed.
"""

import re
from difflib import SequenceMatcher

NIKUD = re.compile(r"[֑-ׇ]")
NOT_LETTER = re.compile(r"[^א-ת]+")
HEBREW_CHAR = re.compile(r"[א-ת]")
LATIN_CHAR = re.compile(r"[A-Za-z]")
FINALS = str.maketrans("ךםןףץ", "כמנפצ")

MATCH, MISMATCH, GAP = 2.0, -1.0, -1.0
SIMILAR = 0.72


def norm(word):
    """A word reduced to its letters, so ASR spelling does not decide a match."""
    return NOT_LETTER.sub("", NIKUD.sub("", word)).translate(FINALS)


def words(text):
    return [w for w in (norm(t) for t in text.split()) if w]


def hebrew_share(text):
    he, la = len(HEBREW_CHAR.findall(text)), len(LATIN_CHAR.findall(text))
    return he / float(he + la) if he + la else 0.0


class Page:
    """Every word on the amud, with where it sits: line, clause, place in clause."""

    def __init__(self, pack):
        self.words, self.where, self.at = [], [], []
        for segment in pack["segments"]:
            clauses = segment.get("clauses") or [{"i": 0, "he": segment["he"]}]
            place = 0  # the word's place in its line, counted the way the page counts
            for clause in clauses:
                ws = words(clause["he"])
                for k, w in enumerate(ws):
                    self.words.append(w)
                    self.where.append((segment["n"], clause["i"], k, len(ws)))
                    self.at.append(place)
                    place += 1
        self._sim = {}

    def grams(self, n):
        """Every run of n consecutive words on the amud, for spotting quotation."""
        key = "_grams%d" % n
        if not hasattr(self, key):
            setattr(self, key, {tuple(self.words[i:i + n]) for i in range(len(self.words) - n + 1)})
        return getattr(self, key)

    def sim(self, a, b):
        if a == b:
            return 1.0
        key = (a, b)
        if key not in self._sim:
            # Cheap filters first: most pairs are nowhere near each other.
            if abs(len(a) - len(b)) > 2 or (a[0] != b[0] and a[-1] != b[-1]):
                self._sim[key] = 0.0
            else:
                self._sim[key] = SequenceMatcher(None, a, b).ratio()
        return self._sim[key]

    def locate(self, transcript):
        """Best local alignment of what was heard against the page.

        Smith-Waterman over words: the heard words need not be complete or in
        perfect order, and whatever they said before or after the reading does
        not count against the match.
        """
        heard = words(transcript)
        if not heard or not self.words:
            return None
        rows, cols = len(heard), len(self.words)
        prev = [0.0] * (cols + 1)
        best, best_at = 0.0, None
        trace = {}
        for i in range(1, rows + 1):
            cur = [0.0] * (cols + 1)
            for j in range(1, cols + 1):
                s = self.sim(heard[i - 1], self.words[j - 1])
                diag = prev[j - 1] + (MATCH * s if s >= SIMILAR else MISMATCH)
                up, left = prev[j] + GAP, cur[j - 1] + GAP
                score = max(0.0, diag, up, left)
                cur[j] = score
                if score > 0:
                    trace[(i, j)] = 0 if score == diag else (1 if score == up else 2)
                if score > best:
                    best, best_at = score, (i, j)
            prev = cur
        if not best_at:
            return None
        # Walk back to find where the matched run began and how much matched.
        i, j = best_at
        matched, end_j, start_j = 0, j - 1, j - 1
        # Rebuild scores cheaply by re-walking the trace.
        while i > 0 and j > 0 and (i, j) in trace:
            step = trace[(i, j)]
            if step == 0:
                if self.sim(heard[i - 1], self.words[j - 1]) >= SIMILAR:
                    matched += 1
                start_j = j - 1
                i, j = i - 1, j - 1
            elif step == 1:
                i -= 1
            else:
                j -= 1
        return {"score": best, "matched": matched, "heard": len(heard),
                "start": start_j, "end": end_j}


def listen(page, transcript):
    """Decide what a stretch of speech was, and where it leaves the learner.

    reading  -- they were reading the page aloud; follow, and stay quiet
    quoting  -- they talked, and quoted the page while doing it
    talking  -- nothing on the page matched; this is conversation
    """
    share = hebrew_share(transcript)
    # Gate on how many Hebrew words there are, not their share: "so when he
    # says תנא אקרא קאי he means..." is mostly English and still points at a line.
    hebrew_words = sum(1 for t in transcript.split() if HEBREW_CHAR.search(t))
    hit = page.locate(transcript) if hebrew_words >= 3 else None
    if not hit or hit["matched"] < 3:
        return {"mode": "talking", "hebrew": round(share, 2)}

    coverage = hit["matched"] / float(max(hit["heard"], 1))
    n, clause, k, size = page.where[hit["end"]]
    start_n = page.where[hit["start"]][0]
    left = size - (k + 1)
    result = {
        "mode": "reading" if (share >= 0.6 and coverage >= 0.55) else "quoting",
        "line": n,
        "from_line": start_n,
        "clause": clause,
        "coverage": round(coverage, 2),
        "matched": hit["matched"],
        "hebrew": round(share, 2),
        # Only claim a mid-clause stop when the match is strong enough that a
        # wrong claim is unlikely -- a false "you stopped early" is exactly
        # the kind of correction that makes a learner stop trusting this.
        "stopped_mid_clause": bool(left >= 2 and coverage >= 0.7 and hit["matched"] >= 4),
        # So the page can show how far it followed -- position, never a verdict.
        "from_word": page.at[hit["start"]],
        "word": page.at[hit["end"]],
        "words_left_in_clause": left,
    }
    return result


def unspeak(text, page, run=4):
    """Cut any stretch of the page's own words out of what will be spoken.

    The partner marks its quotations with «» and those are silenced already;
    this is the net underneath, for the time it forgets. Any run of `run` or
    more consecutive words that appears on the amud is replaced with a pause,
    so the rule "the gemara is never spoken" holds whatever the model does.
    """
    tokens = text.split()
    keys = [norm(t) for t in tokens]
    grams = page.grams(run)
    silence = [False] * len(tokens)
    for i in range(len(tokens) - run + 1):
        window = keys[i:i + run]
        if all(window) and tuple(window) in grams:
            for j in range(i, i + run):
                silence[j] = True
    out, quiet = [], False
    for token, hush in zip(tokens, silence):
        if hush:
            if not quiet:
                out.append("…")
            quiet = True
        else:
            out.append(token)
            quiet = False
    return " ".join(out)
