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


def tokens(text):
    """The heard words as said (for quoting back) beside their reduced form."""
    out = []
    for t in text.split():
        k = norm(t)
        if k:
            out.append((t.strip(".,;:?!\"'()[]«»—-"), k))
    return out


def hebrew_share(text):
    he, la = len(HEBREW_CHAR.findall(text)), len(LATIN_CHAR.findall(text))
    return he / float(he + la) if he + la else 0.0


class Page:
    """Every word on the amud, with where it sits: line, clause, place in clause."""

    def __init__(self, pack):
        self.words, self.where, self.at, self.surface = [], [], [], []
        for segment in pack["segments"]:
            clauses = segment.get("clauses") or [{"i": 0, "he": segment["he"]}]
            place = 0  # the word's place in its line, counted the way the page counts
            for clause in clauses:
                said = tokens(NIKUD.sub("", clause["he"]))
                ws = [k for _, k in said]
                for k, w in enumerate(ws):
                    self.surface.append(said[k][0])
                    self.words.append(w)
                    self.where.append((segment["n"], clause["i"], k, len(ws)))
                    self.at.append(place)
                    place += 1
        self._sim = {}
        self.vocabulary = set(self.words)

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
        not count against the match. Also returns the alignment itself, so the
        places where what was said and what is printed part ways can be named.
        """
        said = tokens(transcript)
        heard = [k for _, k in said]
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
        # Walk back: where the matched run began, how much matched, and each
        # step of the alignment -- same, swapped, said-but-not-printed, or
        # printed-but-not-said.
        i, j = best_at
        end_i, end_j = i, j - 1
        matched, start_j, start_i = 0, j - 1, i - 1
        ops = []
        while i > 0 and j > 0 and (i, j) in trace:
            step = trace[(i, j)]
            if step == 0:
                same = self.sim(heard[i - 1], self.words[j - 1]) >= SIMILAR
                matched += same
                ops.append(("same" if same else "swap", i - 1, j - 1))
                start_j, start_i = j - 1, i - 1
                i, j = i - 1, j - 1
            elif step == 1:
                ops.append(("added", i - 1, None))
                i -= 1
            else:
                ops.append(("skipped", None, j - 1))
                j -= 1
        ops.reverse()
        return {"score": best, "matched": matched, "heard": len(heard),
                "start": start_j, "end": end_j, "start_heard": start_i, "end_heard": end_i,
                "ops": ops, "said": said}

    def printed(self, j):
        return self.surface[j] if j < len(self.surface) else self.words[j]


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
    # A short line needs fewer words to be recognised: «הם מוכרים עד חצות» is
    # «וחכמים אומרים עד חצות» misheard, not talk.
    need = 2 if hebrew_words <= 4 else 3
    if not hit or hit["matched"] < need:
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
    slips = differences(page, hit)
    if slips:
        result["slips"] = slips
    # "Are you sure? Let me read it again. מאימתי..." -- a question wrapped
    # around a reading. The reading is followed, and the question answered.
    if result["mode"] == "reading" and asks(page, transcript):
        result["mode"] = "quoting"
        result["asked"] = True
    return result


QUESTION = re.compile(r"[^.?!]*\?")


def asks(page, transcript):
    """Whether they asked something of their own, not a question the page asks."""
    for sentence in QUESTION.findall(transcript):
        latin = len(re.findall(r"[A-Za-z]+", sentence))
        hebrew = [norm(t) for t in sentence.split() if HEBREW_CHAR.search(t)]
        on_page = sum(1 for w in hebrew if w in page.vocabulary)
        if latin >= 2 and latin > len(hebrew):
            return True
        if hebrew and on_page < 0.5 * len(hebrew):
            return True
    return False


# Small words the recogniser drops or invents all the time. Never worth a word.
LIGHT = {norm(w) for w in "את של על ד ו ה לא הוא היא ליה להו אי מאי הכי נמי קא וכו כי אם עד כל זה".split()}
# Below this, two words are different words rather than two spellings or two
# pronunciations of one: מעשר/בתרומתן, השנייה/הראשונה -- but not
# בערבית/בערבין or קוראים/קורין, which is how people say it and none of our business.
DIFFERENT = 0.66


def differences(page, hit):
    """Where what was said and what is printed part ways -- in meaning, not accent.

    A swapped word, a word that carries meaning left out, words that are not
    on the page at all. These are the things a chavruta across the table
    would hear and ask about ("מעשר? it says תרומה"), as opposed to how a
    word was pronounced, which is none of the partner's business and which
    speech recognition cannot hear anyway.
    """
    said, ops = hit["said"], hit["ops"]
    swapped, skipped, added = [], [], []
    for op, i, j in ops:
        if op == "swap":
            a, b = said[i][1], page.words[j]
            if page.sim(a, b) < DIFFERENT and len(b) >= 3 and len(a) >= 2 and a not in LIGHT:
                swapped.append([said[i][0], page.printed(j)])
        elif op == "skipped":
            if len(page.words[j]) >= 3 and page.words[j] not in LIGHT:
                skipped.append(page.printed(j))
        elif op == "added":
            if len(said[i][1]) >= 3 and said[i][1] not in LIGHT:
                added.append(said[i][0])
    # What came after the last word that lined up. One or two words are the
    # end of the reading said differently ("...האשמורה השנייה"); more is
    # something else they said, in Hebrew, that is not on the page.
    tail = said[hit["end_heard"]:]
    after = ""
    if tail and any(HEBREW_CHAR.search(w) for w, _ in tail):
        if len(tail) <= 2:
            for k, (word, key) in enumerate(tail):
                j = hit["end"] + 1 + k
                if j < len(page.words) and page.sim(key, page.words[j]) < DIFFERENT \
                        and len(page.words[j]) >= 3 and key not in LIGHT:
                    swapped.append([word, page.printed(j)])
        elif sum(1 for _, key in tail if key in page.vocabulary) < 0.6 * len(tail):
            # Mostly words the amud does not have. (Mostly words it does have
            # is reading that skipped ahead, which is theirs to do.)
            after = " ".join(w for w, _ in tail)
    out = {}
    if swapped:
        out["swapped"] = swapped[:4]
    if skipped:
        out["skipped"] = skipped[:4]
    if added:
        out["added"] = added[:4]
    if after:
        out["after"] = after
    return out


def describe(slips):
    """The comparison in a sentence the partner can use."""
    parts = []
    for said, printed in slips.get("swapped", []):
        parts.append("said «%s» where the page has «%s»" % (said, printed))
    if slips.get("skipped"):
        parts.append("did not say «%s»" % "», «".join(slips["skipped"]))
    if slips.get("added"):
        parts.append("added «%s», which is not on the page" % "», «".join(slips["added"]))
    if slips.get("after"):
        parts.append("then went on, not from the page: «%s»" % slips["after"])
    return "; ".join(parts)


def unspeak(text, page, run=9, keep=5):
    """Keep the voice from reading the gemara back to them.

    Short quotes are how a chavruta points ("it says «עד חצות»") and are
    spoken. A stretch of nine or more of the page's own words in a row is the
    machine reading the daf aloud, which is the learner's job: the first few
    words are kept, so the sentence still points somewhere, and the rest
    becomes a pause.
    """
    tokens = text.split()
    keys = [norm(t) for t in tokens]
    grams = page.grams(run)
    silence = [False] * len(tokens)
    for i in range(len(tokens) - run + 1):
        window = keys[i:i + run]
        if all(window) and tuple(window) in grams:
            for j in range(i + keep, i + run):
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
