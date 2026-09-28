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
    ("cant_hear", r"\bi can'?t hear you\b|\bi don'?t hear you\b|אני לא שומע אותך",
     ["Can you hear me now? I'll keep it short."], ["עכשיו אתה שומע אותי?"]),
    ("hear_me", r"\b(can|do) you hear me\b|\bare you (there|with me)\b|\bhello\?|"
                r"אתה שומע( אותי)?|שומע אותי|אתה (שם|איתי)",
     ["Yes, I hear you.", "I'm here, I hear you."], ["כן, שומע אותך.", "כאן, שומע."]),
    ("time", r"\bwhat time is it\b|\bwhat'?s the time\b|מה השעה",
     None, None),
    ("reading", r"\b(i'?m )?(gonna|going to) read\b|\blet me read\b|\bhear me read\b|\blisten to me read\b|"
                r"^go ahead\b|אני (קורא|אקרא|הולך לקרוא)|תקשיב לי|בוא נקרא",
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
FIXED = [r for _, _, en, he in KINDS for r in (en or []) + (he or [])]


def reply(said, language="en"):
    """(kind, text) for small talk, or None. `language` is the setting."""
    text = said.strip()
    if not text or len(text.split()) > 9:
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
        if kind == "time":
            now = time.strftime("%H:%M")
            return kind, ("השעה %s. ממשיכים?" % now) if hebrew else ("It's %s. Shall we keep going?" % now)
        return kind, random.choice(he if hebrew else en)
    return None
