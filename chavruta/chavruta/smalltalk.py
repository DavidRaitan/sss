# -*- coding: utf-8 -*-
"""The small exchanges of sitting together, answered at once.

"Hey, what's up?" went through speech recognition, a routing model, the
partner and speech synthesis before a two-word answer came back -- six or
seven seconds for "hey". Across a table that is an eternity. These are
recognised from the words alone, answered from a short list with no model at
all, and their audio is made once and kept, so they come back as fast as the
recogniser can hear them.

Only short utterances, and only when nothing in them is being read from the
page: "I'm gonna read -- מאימתי קורין..." is reading, not small talk.
"""

import random
import re
import time

EN = re.compile(r"[A-Za-z]")

# (pattern, English replies, Hebrew replies). First match wins.
KINDS = [
    # "Enough" / "skip": the rest of the current answer is dropped.
    ("skip", r"^(ok(ay)?,? )?(skip( it)?|next|enough|that'?s enough|stop|move on|די|דלג|הבא|מספיק|תפסיק)[.!]?$",
     None, None),
    # "A bit faster" / "slower": the page changes its speaking speed.
    ("faster", r"\b(speak|talk|go|say it|read)?\s*(a (bit|little) )?faster\b|\bspeed (it )?up\b|"
               r"(תדבר|דבר|תקרא)?\s*(קצת )?(יותר )?מהר( יותר)?\b",
     None, None),
    ("slower", r"\b(speak|talk|go|say it|read)?\s*(a (bit|little) )?slower\b|\bslow (it )?down\b|"
               r"(תדבר|דבר|תקרא)?\s*(קצת )?(יותר )?לאט( יותר)?\b",
     None, None),
    # "What?" after an answer means it was not heard: say it again, don't
    # reassure them that *it* can hear ("Yes, I hear you" to "I didn't hear you").
    ("again", r"^(what|huh|sorry|pardon)\??$|\bsay (that|it) again\b|\brepeat (that|it|yourself)\b|"
              r"\bi (didn'?t|did not|couldn'?t|can'?t|don'?t) (hear|catch) (you|that|it)\b|\bcome again\b|"
              r"^מה\??$|לא שמעתי|תחזור על זה|תגיד שוב|עוד פעם",
     None, None),
    ("cant_hear", r"\bi can'?t hear you\b|\bi don'?t hear you\b|אני לא שומע אותך",
     ["Can you hear me now? I'll keep it short."], ["עכשיו אתה שומע אותי?"]),
    ("hear_me", r"\b(can|do) you hear me\b|\bare you (there|with me)\b|\bhello\?|"
                r"אתה שומע( אותי)?|שומע אותי|אתה (שם|איתי)",
     ["Yes, I hear you.", "I'm here, I hear you."], ["כן, שומע אותך.", "כאן, שומע."]),
    ("time", r"\bwhat time is it\b|\bwhat'?s the time\b|מה השעה",
     None, None),
    ("reading", r"\b(i'?m )?(gonna|going to) read\b|\blet me read\b|\bhear me read\b|\blisten to me read\b|"
                r"^go ahead\b|אני (קורא|אקרא|הולך לקרוא)|תקשיב לי|בוא נקרא|"
                r"\blet'?s (continue|keep going|go on|move on)\b|נמשיך|בוא נמשיך",
     ["Go ahead.", "Go ahead, I'm following."], ["קדימה.", "קדימה, אני איתך."]),
    ("thanks", r"^(ok(ay)?,? )?(thanks|thank you)\b|^תודה",
     ["Sure.", "Of course."], ["בשמחה.", "בכיף."]),
    ("hello", r"^(hey|hi|hello|yo|good (morning|evening))\b|\bwhat'?s up\b|\bhow are you\b|\bhow'?s it going\b|"
              r"^(היי|הי|שלום|בוקר טוב|ערב טוב)|מה נשמע|מה קורה|מה שלומך",
     ["Hey! All good — ready when you are.", "Good, thanks. Where are we starting?"],
     ["היי! הכל טוב, מוכן כשאתה מוכן.", "טוב, תודה. מאיפה מתחילים?"]),
]
KINDS = [(k, re.compile(p, re.I), en, he) for k, p, en, he in KINDS]

FILLER = {"ok", "okay", "so", "um", "uh", "yeah", "yes", "well", "hey", "right", "now", "then",
          "again", "it", "you", "me", "i", "and", "אוקיי", "טוב", "אז", "יאללה", "רגע", "שוב", "כן"}

# Every fixed reply, so its audio can be made ahead of time.
FIXED = [r for _, _, en, he in KINDS for r in (en or []) + (he or []) if r]


# Asking for something is never small talk: "so go ahead and answer" got "Go
# ahead." and "answer the question I asked" got "Yes, I hear you."
REQUEST = re.compile(r"\b(answer|explain|tell|repeat|continue|summari[sz]e|question|why|how|which|who|when|where)\b|"
                     r"תענה|ענה|תסביר|תגיד לי|שאלה|למה|איך|מי |מתי|איפה", re.I)


# "Um." and "Okay." are not turns. In use "Okay." got "Yes, I hear you." and
# "Um." got a second reply on top of "Go for it."
HESITATION = {"um", "umm", "uh", "uhh", "hmm", "hm", "mm", "mmm", "mhm", "erm", "er", "ah", "אמ", "אממ",
              "אה", "אהה", "הממ", "ממ"}
ACK = {"ok", "okay", "right", "yes", "yeah", "yep", "sure", "cool", "great", "nice", "alright", "good",
       "got", "see", "i", "it", "so", "go", "ahead","אוקיי", "טוב", "נכון", "כן", "סבבה", "יפה", "הבנתי", "אז"}


def words(said):
    return [w.lower() for w in re.findall(r"[\w'א-ת]+", said or "")]


def hesitation(said):
    """Only a sound while thinking: no reply at all."""
    w = words(said)
    return bool(w) and all(x in HESITATION for x in w)


def acknowledges(said):
    """"Okay", "right", "got it", "yes" -- and nothing else."""
    w = words(said)
    return bool(w) and len(w) <= 4 and all(x in ACK or x in HESITATION for x in w)


def reply(said, language="en", asked=False):
    """(kind, text) for small talk, or None. `language` is the setting;
    `asked` is whether the partner's last words were a question -- then "okay"
    is an answer to it, for the partner.

    kind "again" has no text: the client says its last answer once more; kind
    "filler" has none either, and nothing is said back.
    """
    text = said.strip()
    if not text or len(text.split()) > 9:
        return None
    if hesitation(text) or (acknowledges(text) and not asked):
        return "filler", ""
    if REQUEST.search(text) and not re.search(r"what time|מה השעה|say (that|it) again|repeat (that|it)|"
                                              r"let'?s (continue|keep going|go on|move on)", text, re.I):
        return None
    for kind, pattern, en, he in KINDS:
        hit = pattern.search(text)
        if not hit:
            continue
        # Nothing else of substance said: "hey, what's the summary here?" is a question.
        rest = [w for w in re.findall(r"[\w'א-ת]+", text[:hit.start()] + " " + text[hit.end():])
                if w.lower() not in FILLER]
        if len(rest) > 2:
            return None
        hebrew = language == "he" or (language == "auto" and not EN.search(text))
        if kind == "reading" and asked and re.match(r"^\W*((ok(ay)?|yes|yeah|sure|so)\W+)*go ahead\W*$", text, re.I):
            return None     # "go ahead" after "want it?" is a yes, for the partner
        if kind in ("again", "faster", "slower", "skip"):
            return kind, ""
        if kind == "time":
            now = time.strftime("%H:%M")
            return kind, ("השעה %s. ממשיכים?" % now) if hebrew else ("It's %s. Shall we keep going?" % now)
        return kind, random.choice(he if hebrew else en)
    return None
