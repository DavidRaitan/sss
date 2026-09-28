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
        answers=["structure", "meaning"],
        specialty="Beit HaBechirah: a summarizing digest -- skips the give-and-take "
                  "and states the upshot, naming Rishonim by epithet. The best single "
                  "overview of 'what happened on this page', but light as an authority "
                  "for halacha: unknown until 1920, so the codes never weighed him."),
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
        specialty="Explainer of Rashi and Tosafot rather than of the gemara: what "
                  "they mean and why. 'Whoever has grasped the Maharsha has understood "
                  "Tosafot.' The first address for 'what is Tosafot actually asking'."),
    # The Maharsha as Sefaria files him: his halachic and his aggadic halves.
    "Chidushei Halachot": dict(
        he='מהרש"א', era="acharon", died=1631, tier="wide", weight=40,
        answers=["on_commentary"],
        specialty="The Maharsha on the halachic passages -- explainer of Rashi and "
                  "Tosafot, the first address for 'what is Tosafot actually asking'."),
    "Chidushei Agadot": dict(
        he='מהרש"א', era="acharon", died=1631, tier="wide", weight=45,
        answers=["aggadah"],
        specialty="The Maharsha on the aggadah: the first stop after Rashi on a "
                  "story or aggadic statement, reading the strange tales as parables."),
    "Penei Yehoshua": dict(
        he='פני יהושע', era="acharon", died=1756, tier="wide", weight=30,
        answers=["on_commentary", "logic", "conflict"],
        specialty="The classic question-raiser: shows the problem in the sugya, "
                  "Rashi and Tosafot that you missed. Deep, and long -- offer it, do "
                  "not volunteer it."),
    "Chiddushei Rabbi Akiva Eiger": dict(
        he='רבי עקיבא איגר', era="acharon", died=1837, tier="wide", weight=35,
        answers=["conflict", "on_commentary"],
        specialty="Short 'tzarich iyun' questions and cross-references that tie a "
                  "distant sugya to this one. The address when something here seems "
                  "to contradict another place."),
    "Gilyon HaShas": dict(
        he='גליון הש"ס', era="acharon", died=1837, tier="wide", weight=35,
        answers=["conflict"],
        specialty="R' Akiva Eiger's margin notes on the page: pointers to a "
                  "contradiction or a proof elsewhere in shas. Printed on the daf."),
    "Tzelach": dict(
        he='צל"ח', era="acharon", died=1793, tier="wide", weight=25,
        answers=["logic", "on_commentary"],
        specialty="The Noda BiYehuda's novellae: a question-raiser on the sugya, Rashi "
                  "and Tosafot, on some tractates only. Long; offer it."),
    "Rashash": dict(
        he='רש"ש', era="acharon", died=1872, tier="wide", weight=30,
        answers=["meaning", "on_commentary"],
        specialty="Short textual and emendation notes, and pointed remarks on Rashi. "
                  "Useful when a line looks corrupt or a word will not parse."),
    "Ra'ah": dict(
        he='רא"ה', era="rishon", died=1293, tier="wide", weight=50,
        answers=["logic"],
        specialty="Catalonian novellae (the Rashba's teacher's generation); on "
                  "Berakhot, comments on the Rif and the sugya."),
    "HaMaor": dict(
        he='המאור', era="rishon", died=1186, tier="wide", weight=40,
        answers=["halacha", "logic"],
        specialty="The Ba'al HaMaor: Provençal critique of the Rif's rulings, "
                  "answered by the Ramban's Milchamot."),
    "Ben Yehoyada": dict(
        he='בן יהוידע', era="acharon", died=1909, tier="wide", weight=40,
        answers=["aggadah"],
        specialty="The Ben Ish Chai on the aggadot of the Bavli, on the plain level "
                  "and on remez and sod. For Sephardi and Mizrahi learners the major "
                  "aggadah commentary."),
    "Petach Einayim": dict(
        he='פתח עינים', era="acharon", died=1806, tier="wide", weight=30,
        answers=["aggadah", "conflict"],
        specialty="The Chida's notes: sources and parallels, strong on aggadah."),
}

# Where Sefaria files someone under a different name than people use: the
# Maharsha on Berakhot is "Chidushei Halachot" and "Chidushei Agadot". Asked
# for "the Maharsha", nothing on the page was ever found.
FILED_AS = {"Maharsha": ["Chidushei Halachot", "Chidushei Agadot"]}

# What kind of work answers what kind of question -- the shelf sorted by what
# each work does, not by how famous its author is. Genre predicts function:
# an explainer tells you what the text says; a question-raiser, what problem
# you missed; analytic novellae, why the argument works; a digest, what
# survived as law; a summary, the whole page at once.
ASK = {
    "on_commentary": ["Maharsha", "Tosafot HaRosh", "Rashash", "Penei Yehoshua",
                      "Chiddushei Rabbi Akiva Eiger"],
    "on_tosafot": ["Maharsha", "Tosafot HaRosh", "Gilyon HaShas", "Penei Yehoshua",
                   "Chiddushei Rabbi Akiva Eiger"],
    "on_rashi": ["Maharsha", "Rashash", "Penei Yehoshua"],
    "conflict": ["Gilyon HaShas", "Chiddushei Rabbi Akiva Eiger", "Penei Yehoshua", "Petach Einayim"],
    "logic": ["Rashba", "Ritva", "Ramban", "Ran", "Ra'ah"],
    "aggadah": ["Maharsha", "Ben Yehoyada", "Petach Einayim"],
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
    # The Rif is printed with Talmidei Rabbeinu Yonah on Berakhot alone -- a
    # tractate where R' Yonah is standard iyun.
    "Berakhot": ["Rif", "Rosh", "Rashba", "Ritva", "Tosafot HaRosh", "Meiri"],
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
    "aggadah": "what an aggadic story or statement means, or what its idea is",
}


# Who the learner can seat at the table, or ask to stay out of it (settings).
# Rashi and Tosafot are the page itself and are always there.
TABLE = [
    ("ראשונים", [("Rif", 'רי"ף'), ("Rabbeinu Yonah", "רבינו יונה"), ("Rosh", 'רא"ש'),
                 ("Tosafot HaRosh", 'תוספות הרא"ש'), ("Rabbeinu Chananel", "רבינו חננאל"),
                 ("Ramban", 'רמב"ן'), ("Rashba", 'רשב"א'), ("Ritva", 'ריטב"א'), ("Ran", 'ר"ן'),
                 ("Ra'ah", 'רא"ה'), ("HaMaor", "בעל המאור"), ("Meiri", "מאירי"),
                 ("Shita Mekubetzet", "שיטה מקובצת")]),
    ("אחרונים", [("Maharsha", 'מהרש"א'), ("Penei Yehoshua", "פני יהושע"),
                 ("Chiddushei Rabbi Akiva Eiger", "רבי עקיבא איגר"), ("Gilyon HaShas", 'גליון הש"ס'),
                 ("Tzelach", 'צל"ח'), ("Rashash", 'רש"ש'), ("Petach Einayim", "פתח עינים"),
                 ("Ben Yehoyada", "בן יהוידע")]),
    ("פוסקים", [("Rambam", 'רמב"ם'), ("Tur", "טור"), ("Beit Yosef", "בית יוסף"), ("Bach", 'ב"ח'),
                ("Shulchan Arukh", "שולחן ערוך"), ("Magen Avraham", "מגן אברהם"),
                ("Turei Zahav", 'ט"ז'), ("Mishnah Berurah", "משנה ברורה"), ("Kaf HaChayim", "כף החיים")]),
]


def table():
    return [{"group": group, "names": [{"name": n, "he": he} for n, he in names]} for group, names in TABLE]


def seats(favor):
    """{name: 1 | -1} from settings -> (preferred, muted), each with the names
    Sefaria files them under."""
    prefer, mute = [], set()
    for name, value in (favor or {}).items():
        names = [name] + FILED_AS.get(name, [])
        if value == 1:
            prefer.extend(names)
        elif value == -1:
            mute.update(names)
    return prefer, mute


def filed(name, present):
    """The names a commentator is found under on this page."""
    return [n for n in [name] + FILED_AS.get(name, []) if n in present]


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
