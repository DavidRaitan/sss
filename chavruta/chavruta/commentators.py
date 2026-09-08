# -*- coding: utf-8 -*-
"""Who to ask, for what, and where they are strong.

Sefaria will tell you which texts exist on a daf. It will not tell you that a
"how does this square with what I learned elsewhere" question belongs to
Tosafot because contradiction-hunting is the entire literary purpose of
Tosafot, or that on Nedarim the Ran does the job Rashi does everywhere else.
That judgement is not in any API, and it is the thing that makes this a
chavruta rather than a search box.

Two layers, kept apart on purpose:

  TIERS + SPECIALTY   editorial judgement -- hand-written, argued with, wrong
                      in places, and the part worth improving over time.
  availability        fact -- probed against Sefaria per masechta, because
                      guessing is how you promise Rabbeinu Chananel on a
                      masechta he was never printed on.

BACKBONE loads with the page. Everything else is fetched only when the
conversation actually reaches for it -- see retrieve.py.
"""

# What you can open. One masechta for now, deliberately: the routing judgement
# below is per-tractate and unverified everywhere else, and offering a page we
# route badly is worse than not offering it.
MASECHTOT = [
    {"name": "Berakhot", "he": "ברכות", "first": 2, "last": 64, "last_amud": "a"},
]


# --- layer 1: who is on the page, and who is a step away ----------------------

# On the daf itself. These are what the learner is looking at while you talk,
# so an error here is caught instantly and costs you the learner.
BACKBONE = ["Steinsaltz", "Rashi", "Tosafot", "Rabbeinu Chananel"]

# One step out: fetched when a question calls for them.
WIDE = ["Rif", "Rosh", "Ramban", "Rashba", "Ritva", "Ran", "Meiri",
        "Tosafot HaRosh", "Rashbam", "Shita Mekubetzet", "Maharsha",
        "Penei Yehoshua", "Rashash"]

# Where the sugya lands. Reported, never ruled -- see the spec's rule 2.
HALACHIC_CHAIN = ["Rif", "Mishneh Torah", "Rosh", "Tur", "Shulchan Arukh"]

WHO = {
    "Steinsaltz": dict(
        he='שטיינזלץ', era="modern", tier="backbone", weight=95,
        answers=["meaning", "structure"],
        specialty="Orientation. Punctuates the text, fills the elliptical Aramaic "
                  "into full sentences, and says what the sugya is doing. Start here "
                  "when the learner is lost, not when they are stuck on a fine point."),
    "Rashi": dict(
        he='רש"י', era="rishon", died=1105, tier="backbone", weight=100,
        answers=["meaning"],
        specialty="What the words mean and what is happening, at the point where it "
                  "would trip you. Answers the immediate difficulty and never the "
                  "theoretical one; if Rashi says something apparently obvious, he is "
                  "usually excluding a reading you have not noticed yet."),
    "Tosafot": dict(
        he='תוספות', era="rishon", tier="backbone", weight=100,
        answers=["conflict", "logic"],
        specialty="Contradiction. Takes this sugya against every other place in shas "
                  "that seems to say otherwise, and will not let either go. This is "
                  "the address for 'but I learned the opposite in ___'. Not one "
                  "author: a school, arguing with itself across generations."),
    "Rabbeinu Chananel": dict(
        he='רבינו חננאל', era="rishon", died=1055, tier="backbone", weight=95,
        answers=["meaning", "halacha"],
        specialty="Terse, early, North African. Gives the conclusion of the sugya and "
                  "the practical upshot rather than the running explanation, and draws "
                  "on the Yerushalmi and the Geonim more than later Rishonim do. "
                  "Printed on the page only in some masechtot."),
    "Rif": dict(
        he='רי"ף', era="rishon", died=1103, tier="halachic", weight=75,
        answers=["halacha"],
        specialty="The sugya boiled down to what is binding, with the rejected "
                  "positions cut out. Reading what he omitted is as informative as "
                  "reading what he kept."),
    "Rosh": dict(
        he='רא"ש', era="rishon", died=1327, tier="halachic", weight=70,
        answers=["halacha", "conflict"],
        specialty="Halachic like the Rif, but keeps the Franco-German dialectic and "
                  "the Tosafist arguments on the way to the ruling."),
    "Rambam": dict(
        he='רמב"ם', era="rishon", died=1204, tier="halachic", weight=75,
        answers=["halacha"],
        specialty="Where the sugya finally lands, stated as law with the argument "
                  "removed. Ein Mishpat on the daf points here. What he leaves out, "
                  "and how he recasts a case, is itself a reading of the sugya."),
    "Ramban": dict(
        he='רמב"ן', era="rishon", died=1270, tier="wide", weight=65,
        answers=["logic"],
        specialty="Expansive and architectural. Defends the earlier Rishonim against "
                  "objections and rebuilds the sugya's underlying structure. Go here "
                  "when the question is why the argument works, not what it says."),
    "Rashba": dict(
        he='רשב"א', era="rishon", died=1310, tier="wide", weight=65,
        answers=["logic", "conflict"],
        specialty="The sharpest analytic of the Spanish school. Defines the terms of a "
                  "machlokes precisely -- what exactly the two sides disagree about. "
                  "Especially strong in the Nashim and Nezikin orders and Chullin."),
    "Ritva": dict(
        he='ריטב"א', era="rishon", died=1330, tier="wide", weight=60,
        answers=["logic", "meaning"],
        specialty="Compressed and clarifying. Says the necessary thing in the fewest "
                  "words, often resolving what Rashi left implicit. Good when a "
                  "Ramban answer would be too long for the question asked."),
    "Ran": dict(
        he='ר"ן', era="rishon", died=1376, tier="wide", weight=60,
        answers=["logic", "halacha", "meaning"],
        specialty="Two different works: the commentary on the Rif, and on Nedarim the "
                  "running page commentary itself. On Nedarim treat him as backbone."),
    "Meiri": dict(
        he='מאירי', era="rishon", died=1315, tier="wide", weight=55,
        answers=["structure", "meaning", "halacha"],
        specialty="Beit HaBechirah: an orderly summary of the whole sugya and its "
                  "conclusions in clear Hebrew, without the dialectic. The best "
                  "single source for 'what happened on this page overall'."),
    "Rashbam": dict(
        he='רשב"ם', era="rishon", died=1158, tier="backbone", weight=100,
        answers=["meaning"],
        specialty="Rashi's grandson. On Bava Batra from 29a onward his commentary "
                  "replaces Rashi's on the page and is far more expansive."),
    "Tosafot HaRosh": dict(
        he='תוספות הרא"ש', era="rishon", tier="wide", weight=60, answers=["conflict"],
        specialty="The Rosh's own recension of Tosafot, often clearer than the printed "
                  "Tosafot and sometimes preserving what it compressed away."),
    "Shita Mekubetzet": dict(
        he='שיטה מקובצת', era="acharon", died=1575, tier="wide", weight=60,
        answers=["logic", "conflict"],
        specialty="An anthology, not an opinion: collects Rishonim whose manuscripts "
                  "were otherwise lost. In Bava Metzia, Bava Kamma, Ketubot and "
                  "Nedarim it is where the Rishonim actually are."),
    "Maharsha": dict(
        he='מהרש"א', era="acharon", died=1631, tier="wide", weight=40,
        answers=["on_commentary"],
        specialty="Commentary on Rashi and Tosafot rather than on the gemara. The "
                  "address for 'what is Tosafot actually asking here'."),
    "Penei Yehoshua": dict(
        he='פני יהושע', era="acharon", died=1756, tier="wide", weight=30,
        answers=["on_commentary", "logic"],
        specialty="Sustained analysis of the sugya together with Rashi and Tosafot. "
                  "Deep, and long -- offer it, do not volunteer it."),
    "Rashash": dict(
        he='רש"ש', era="acharon", died=1794, tier="wide", weight=30,
        answers=["meaning"],
        specialty="Short textual and emendation notes. Useful when a line looks "
                  "corrupt or a word will not parse."),
}

# --- layer 2: where the defaults change ---------------------------------------
# Editorial judgement, not fact. Correct it as you learn -- that is the point.

# Masechtot where the printed page is not what you would assume.
PAGE_EXCEPTIONS = {
    "Nedarim": "The printed 'Rashi' is not Rashi's, and the standard commentary is "
               "the Ran. Treat the Ran as backbone here.",
    "Nazir": "The printed 'Rashi' is not Rashi's. Lean on Tosafot and the Rosh.",
    "Bava Batra": "Rashi only through 29a; from there the page commentary is the "
                  "Rashbam, and it is much fuller.",
    "Makkot": "Rashi's commentary breaks off at 19b; the remainder is by others.",
    "Taanit": "Rabbeinu Chananel and the Ran carry more of the load than usual.",
    "Meilah": "Rashi's commentary is not his throughout.",
}

# Who is worth reaching for first, beyond the backbone, per masechta.
STRONG_IN = {
    "Berakhot": ["Rif", "Rosh", "Meiri", "Tosafot HaRosh", "Rashba"],
    "Shabbat": ["Rabbeinu Chananel", "Ramban", "Rashba", "Ritva", "Meiri", "Rif"],
    "Eruvin": ["Rabbeinu Chananel", "Ritva", "Rashba", "Meiri"],
    "Pesachim": ["Rabbeinu Chananel", "Ramban", "Rashbam", "Ran", "Meiri"],
    "Yoma": ["Rabbeinu Chananel", "Ritva", "Meiri", "Tosafot Yeshanim"],
    "Sukkah": ["Ran", "Ritva", "Rabbeinu Chananel", "Meiri"],
    "Rosh Hashanah": ["Ran", "Ritva", "Rabbeinu Chananel"],
    "Megillah": ["Ran", "Ritva", "Meiri"],
    "Moed Katan": ["Ran", "Ritva", "Rabbeinu Chananel"],
    "Chagigah": ["Ramban", "Ritva", "Rabbeinu Chananel"],
    "Yevamot": ["Ramban", "Rashba", "Ritva", "Meiri", "Tosafot HaRosh"],
    "Ketubot": ["Shita Mekubetzet", "Rashba", "Ramban", "Ritva", "Meiri"],
    "Nedarim": ["Ran", "Shita Mekubetzet", "Rashba", "Meiri"],
    "Gittin": ["Ramban", "Rashba", "Ritva", "Ran", "Meiri"],
    "Kiddushin": ["Ritva", "Rashba", "Ramban", "Meiri", "Tosafot HaRosh"],
    "Bava Kamma": ["Shita Mekubetzet", "Rashba", "Ramban", "Meiri"],
    "Bava Metzia": ["Shita Mekubetzet", "Ramban", "Rashba", "Ritva", "Meiri"],
    "Bava Batra": ["Rashbam", "Ramban", "Rashba", "Ritva", "Shita Mekubetzet"],
    "Sanhedrin": ["Ramban", "Ran", "Meiri", "Yad Ramah"],
    "Makkot": ["Ritva", "Meiri", "Ramban"],
    "Shevuot": ["Ramban", "Ritva", "Meiri"],
    "Avodah Zarah": ["Ramban", "Ritva", "Rashba", "Meiri"],
    "Chullin": ["Rashba", "Ritva", "Ramban", "Meiri", "Rabbeinu Chananel"],
    "Niddah": ["Ramban", "Rashba", "Ritva", "Meiri"],
}

# A question type -> who answers it. The reason the product is not a search box.
ROUTES = {
    "meaning": "what does this word or line actually mean",
    "conflict": "how does this square with somewhere else I learned",
    "structure": "why is this here, how did we get to this, what is the page doing",
    "logic": "what is the underlying reasoning, what exactly is the machlokes about",
    "halacha": "where does this land in practice (reported, never ruled)",
    "on_commentary": "how do we understand Rashi or Tosafot here",
}


def backbone_for(masechta):
    """What loads with the page, before anything is asked."""
    names = list(BACKBONE)
    if masechta == "Nedarim":
        names.append("Ran")
    if masechta == "Bava Batra":
        names.append("Rashbam")
    return names


def wide_for(masechta, kinds=None):
    """Who to reach for, most promising first, optionally filtered by question."""
    ranked = STRONG_IN.get(masechta, []) + [w for w in WIDE if w not in STRONG_IN.get(masechta, [])]
    out = []
    for name in ranked:
        entry = WHO.get(name)
        if not entry or name in BACKBONE:
            continue
        if kinds and not set(entry.get("answers", [])) & set(kinds):
            continue
        out.append(name)
    return out


def note_for(masechta):
    return PAGE_EXCEPTIONS.get(masechta)


def brief(name):
    """One line for the prompt, so the model reaches correctly rather than evenly."""
    entry = WHO.get(name)
    return "%s (%s): %s" % (name, entry["he"], entry["specialty"]) if entry else name
