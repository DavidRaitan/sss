# -*- coding: utf-8 -*-
"""Read the argument structure a commentary already states about itself.

The sugya map -- where the question is posed, which move is the hard one, who
disagrees with whom, what the page leans on elsewhere -- looked like it had to
be generated. Mostly it does not. Tosafot says all of it out loud, in fixed
phrases that barely vary across shas:

    פירש רש"י …      here is the position being discussed
    תימה / ועוד קשה   here is what is wrong with it
    ויש לומר          here is the answer
    לכן פירש ר"ת      here is the alternative
    על כן אומר ר"י    here is where it lands
    (לקמן דף ה.)      here is what it depends on elsewhere

Extracting those beats them being invented. What comes out is retrieved
structure: it can be shown to the learner with the words that produced it, it
can be checked, and when the parse fails it fails visibly instead of turning
into a confident paraphrase. Anything this misses is left for a model to
propose, marked as generated, and never merged in silently.
"""

import re

# Hebrew abbreviations and elisions are written with ASCII quotes, gershayim
# and geresh interchangeably, so every marker has to accept all of them. The
# patterns below spell a quote as ~ and this expands it, which also keeps the
# class from nesting inside another character class.
QUOTE = "[\"\u05f4\u2033'\u05f3]"


def _p(pattern):
    return re.compile(pattern.replace("~", QUOTE))


# A comment opens with its dibur hamatchil -- the words it hangs off -- then a
# dash. Those words are quoted gemara, not the commentator's argument, so they
# are stripped before anything here looks for a move.
OPENING = re.compile(r"^.{0,80}?\s[\u2013\u2014-]\s+")

# Ordered: the first pattern matching a clause decides its role, so specific
# phrasings come before general ones. Each is anchored to the clause opening,
# because these markers announce a move -- they do not appear mid-sentence.
# (Unanchored, "תימא לפירושו" reads as a position rather than the objection
# to one, which inverts the argument.)
MOVES = [
    ("position", _p(r"(?:פ~?ר~?ש|פירש|פי~|פירוש)\s*(?:רש~י|ר~ת|ר~י|הקונטרס)?"),
     "states the reading under discussion"),
    ("alternative", _p(r"(?:לכן|ולכן|על כן|ע~כ|אלא)\s*(?:פי|פירש|נראה|אומר|אומרים)"),
     "offers a different reading"),
    ("difficulty", _p(r"(?:ועוד קשה|ועוד|תימה|תימא|וקשה|קשה|קשיא|ואם תאמר|וא~ת|ואי תימא)"),
     "raises a difficulty"),
    ("answer", _p(r"(?:ויש לומר|יש לומר|וי~ל|ותירץ|ומתרץ|ותירצו)"),
     "answers it"),
    ("conclusion", _p(r"(?:ומכאן נראה|והלכך|לפיכך|הלכך|ומכאן|נמצא)"),
     "draws the practical conclusion"),
]

# "(לקמן ברכות דף ס:)" / "(דף ג.)" -- what this page leans on elsewhere.
CITATION = re.compile(r"\(([^()]{0,60}?דף[^()]{0,20}?)\)")
# Who is named. Deliberately narrow: a name we cannot resolve is worse than none.
NAMED = _p(r"(רש~י|ר~ת|ר~י|ריב~א|הרי~ף|הרמב~ם|רבינו תם|ר~ יוחנן|רבי יוחנן"
           r"|ריב~ל|רבי יהושע בן לוי|רבי יהודה|רבנן|הקונטרס|הירושלמי)")

# Clauses end at a full stop; the printed colon closes a comment.
CLAUSE = re.compile(r"[^.:]+[.:]?")


def moves(body):
    """Walk a comment clause by clause, labelling the ones that declare a move."""
    found = []
    offset = 0
    opening = OPENING.match(body)
    if opening:
        offset, body = opening.end(), body[opening.end():]
    for match in CLAUSE.finditer(body):
        clause = match.group(0).strip()
        if len(clause) < 8:
            continue
        for kind, pattern, gloss in MOVES:
            hit = pattern.match(clause)
            if not hit:
                continue
            found.append({
                "kind": kind,
                "gloss": gloss,
                # The words that produced the label, so a learner can check it.
                "marker": hit.group(0),
                "at": offset + match.start(),
                "text": clause,
                "names": sorted(set(NAMED.findall(clause))),
            })
            break
    return found


def citations(body):
    """Where the comment sends you, in its own words."""
    return sorted({m.group(1).strip() for m in CITATION.finditer(body)})


def structure(ref, body):
    """The argument shape of one comment, or None if it does not declare one."""
    found = moves(body)
    if not found:
        return None
    counts = {}
    for move in found:
        counts[move["kind"]] = counts.get(move["kind"], 0) + 1
    return {
        "ref": ref,
        "moves": found,
        "counts": counts,
        "cites": citations(body),
        "names": sorted({n for m in found for n in m["names"]}),
        # A comment that states a position and then attacks it is a machlokes,
        # and that is the thing worth volunteering to the learner unprompted.
        "is_machlokes": counts.get("difficulty", 0) >= 1 and (
            counts.get("position", 0) >= 1 or counts.get("alternative", 0) >= 1),
    }


def summarize(struct):
    """One line a person can read, built only from what was matched."""
    if not struct:
        return "no declared structure"
    order = " → ".join(m["kind"] for m in struct["moves"])
    who = ", ".join(struct["names"]) or "unattributed"
    return "%s | %s | cites: %s" % (order, who, ", ".join(struct["cites"]) or "none")
