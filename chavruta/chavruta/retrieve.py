# -*- coding: utf-8 -*-
"""Which sources enter the conversation, and when.

The backbone -- what is printed on the page, Rashi and Tosafot and where
printed Rabbeinu Chananel -- is always in front of the partner, for the whole
amud, in a system prompt that holds still and is cached.

Everything else is on the bench. It is already in the pack (Sefaria returns
every link on a daf in one request), so widening costs no network and no wait;
what it costs is attention and tokens. So each turn a cheap model classifies
what was said, and only then does anything from the bench come in: because the
learner named it, because the question is the kind that commentator answers,
or because the learner has asked to learn deeper.
"""

import re

from . import commentators as who
from . import library, web

# Beyond the question kinds: the small exchanges of sitting together, which
# want a few words back and not a lecture.
LIGHT = {
    "ping": "checking you can hear them, telling you they are about to read, thanks, "
            "hello, a joke -- anything that needs only a few words back. NOT a request: "
            "'answer it', 'so answer', 'go on', 'what did you say', 'answer my question' "
            "want the real answer, so they are 'other'",
    "other": "anything else -- including asking you to answer, continue, or repeat what "
             "you said, which you then do in full",
    "check_reading": "asking whether they read it right, or whether they missed or "
                     "swapped a word",
    "people": "who a sage or commentator was: when or where he lived, which century, "
              "who came first, who taught whom, was he someone's student",
    "review": "asks to be reminded what was learned before -- the last pages, yesterday, "
              "last time, the mishna or chapter so far -- or for a summary of it",
    "quiz": "asks you to test them or ask them questions on what they learned",
    "recall": "asks whether they already learned something, or where they saw it -- 'did we learn "
              "this yesterday?', 'I think I read this somewhere', 'where did this word come up?'",
    "settings": "asks you to change how you work -- speak faster or slower, answer in Hebrew or "
                "English, bring more or fewer commentators, stop speaking up, wait longer, always "
                "bring or leave out a commentator, open on the daf yomi",
}

# What can be changed by voice, and to what. Anything else the router says is
# dropped: a setting is never set to a value the settings screen does not offer.
SETTINGS = {
    "rate": ("faster", "slower"), "language": ("en", "he", "auto"),
    "depth": ("daf", "rishonim", "acharonim"), "voices": (1, 2, 3, 5),
    "nudges": (True, False), "checks": (True, False), "pause": ("short", "normal", "long"),
    "speak": (True, False), "view": ("daf", "lin"), "translate": (True, False),
    "stops": (True, False), "speakers": (True, False), "sites_halacha": (True, False),
    "open": ("last", "today"),
}


def settings_changes(raw):
    """The router's proposed changes, kept only where they are real settings."""
    out = []
    for change in raw if isinstance(raw, list) else []:
        if not isinstance(change, dict):
            continue
        name, value = change.get("name"), change.get("value")
        if name in SETTINGS and value in SETTINGS[name]:
            out.append({"name": name, "value": value})
        elif name == "voices" and isinstance(value, int):
            out.append({"name": name, "value": max(1, min(5, value))})
        elif name == "favor" and isinstance(value, dict) and value.get("name") and value.get("value") in (1, -1, 0):
            known = [n for _, names in who.TABLE for n, _ in names]
            match = resolve(str(value["name"]), set(known)) or (value["name"] if value["name"] in known else None)
            if match in known:
                out.append({"name": "favor", "value": {"name": match, "value": value["value"]}})
        elif name == "mine" and isinstance(value, dict) and value.get("masechta") in {m["name"] for m in who.MASECHTOT}:
            out.append({"name": "mine", "value": {"masechta": value["masechta"], "add": value.get("add") is not False}})
    return out[:4]
KINDS = list(who.ROUTES) + list(LIGHT) + ["reading", "navigate"]

# Depth: how far past the printed page to reach without being asked.
DEPTHS = {
    "daf": "only what is printed on the page",
    "rishonim": "the page, plus the Rishonim strong in this masechta",
    "acharonim": "the page, the Rishonim, and the Acharonim on Rashi and Tosafot",
}
ACHARONIM = ["Maharsha", "Penei Yehoshua", "Rashash", "Chiddushei Rabbi Akiva Eiger",
             "Tzelach", "Gilyon HaShas"]

ROUTER_SYSTEM = """You sort what a person studying Talmud just said to their
study partner. Reply with JSON only:

{"kind": one of %s,
 "claim": true if they are asserting what the text means (not asking),
 "names": commentators they mentioned by name, in English spelling
          (e.g. "Rashi", "Tosafot", "Rashba", "Rambam", "Meiri"), else [],
 "navigate": {"daf": number, "amud": "a" or "b", "masechta": the tractate
             if they named one, spelled exactly as in this list: %s -- else null}
             if they asked to go to a page; {"daf_yomi": true} if they asked
             for today's daf ("the daf yomi", "הדף היומי"); else null,
 "settings": only when kind is "settings": the changes, as [{"name": ..., "value": ...}]
             with name one of rate ("faster"/"slower"), language ("en"/"he"/"auto"),
             depth ("daf"/"rishonim"/"acharonim"), voices (1-5, how many commentators),
             nudges (true/false, speaking up unasked), checks (true/false, asking about
             misread words), pause ("short"/"normal"/"long", how long to wait),
             speak (true/false, answering aloud), view ("daf"/"lin"), translate,
             stops, speakers (true/false), sites_halacha (true/false, checking Halacha
             Yomit on halacha questions), open ("last"/"today"), favor ({"name":
             commentator, "value": 1 always / -1 leave out / 0 normal}), mine
             ({"masechta": tractate, "add": true/false}); else [],
 "language": "he" if they spoke mostly Hebrew, "en" if mostly English,
 "reply": only when kind is "ping": the few words a study partner across the
          table would say back to exactly this, in their language. "Yes, I
          hear you." only if they asked whether you hear them; "we have some
          time then" gets "Plenty -- let's learn."; "let's start from the
          gemara" gets "Go ahead."; "כן, שומע אותך.", "יאללה, קדימה.". Else null}

The kinds:
%s
- reading: they are reading the text aloud, not saying anything about it
- navigate: they asked to go to another page ("go to daf 5", "תעבור לדף ה׳ עמוד ב")

Hebrew numerals for pages: ב=2, י=10, יא=11, טו=15, כ=20, ל=30, מ=40, נ=50, ס=60.
"עמוד א" is a, "עמוד ב" is b. If no amud is said, use a.""" % (
    KINDS, ", ".join("%s (%s)" % (m["name"], m["he"]) for m in who.MASECHTOT),
    "\n".join("- %s: %s" % (k, v) for k, v in list(who.ROUTES.items()) + list(LIGHT.items())))


# They spoke while it was still answering: what is this to the answer?
CUT_IN_SYSTEM = """

They spoke while you were still answering something else. The message starts
with what you were answering and how far you got. Add a field:
 "cut_in": "aside" -- a quick question about something in what you were just
             saying or reading to them: a word, a name, "wait, who's that?",
             "what does that mean?". It will be answered briefly and then you
             go back to where you were. When unsure, this.
           "merge" -- they are correcting, narrowing or adding to what they
             asked: "no, I meant ...", "and in the Rambam?", "what about when
             ...", "I'm asking about the night". The question as it now stands
             is answered instead.
           "new" -- a different question, not about what you were saying.
           "later" -- they want to keep something for later: "remind me to
             ask ...", "let's come back to that", "נחזור לזה אחר כך"."""
CUT_INS = ("aside", "merge", "new", "later")
LATER = re.compile(r"\b(later|come back to (it|that|this)|remind me|hold (on to )?that|park (it|that)|"
                   r"for another time)\b|אחר כך|נחזור לזה|תזכיר לי|תזכור את זה|בהמשך", re.I)
MERGE = re.compile(r"^\W*(no,? (i|what i) mean|i mean|i meant|actually|rather|not that|"
                   r"(and|but) (what about|also|in|according to)|what about|how about|"
                   r"לא,? (התכוונתי|אני מתכוון|הכוונה)|התכוונתי|בעצם|ומה עם|ומה לגבי|וגם)", re.I)


def cut_in_context(cut):
    """The line the router reads before their words, when they cut in."""
    said = " ".join((cut.get("said") or "").split())[-300:]
    unsaid = " ".join((cut.get("unsaid") or "").split())[:200]
    return "[you were answering «%s»; you had said: «...%s»; still to say: «%s...»]\n" % (
        (cut.get("asked") or "")[:200], said, unsaid)


def classify(llm, said, cut=None):
    """One short call to the budget model. On any failure, consult broadly.

    `cut`: what it was saying when they spoke ({asked, said, unsaid}); then the
    answer also says what their words are to it (see CUT_IN_SYSTEM)."""
    system = ROUTER_SYSTEM + (CUT_IN_SYSTEM if cut else "")
    content = (cut_in_context(cut) if cut else "") + said
    try:
        out = llm.json(system, [{"role": "user", "content": content}], heavy=False)
    except Exception:
        out = None
    cut_kind = None
    if cut:
        # The plain cases need no judgment; the rest are the model's call.
        cut_kind = "later" if LATER.search(said) else "merge" if MERGE.search(said) else \
            (out or {}).get("cut_in") if (out or {}).get("cut_in") in CUT_INS else \
            ("aside" if len(said.split()) <= 12 else "new")
    if out is None:
        return {"kind": "other", "claim": False, "names": [], "navigate": None, "language": None,
                "reply": None, "settings": [], "cut_in": cut_kind}
    kind = out.get("kind")
    nav = out.get("navigate")
    names = {m["name"] for m in who.MASECHTOT}
    if isinstance(nav, dict) and nav.get("daf_yomi"):
        nav = {"daf_yomi": True}
    elif not (isinstance(nav, dict) and str(nav.get("daf", "")).isdigit()):
        nav = None
    else:
        nav = {"daf": int(nav["daf"]), "amud": "b" if str(nav.get("amud")).lower() == "b" else "a",
               "masechta": nav.get("masechta") if nav.get("masechta") in names else None}
    return {
        "kind": kind if kind in KINDS else "other",
        "claim": bool(out.get("claim")),
        "names": [str(n) for n in (out.get("names") or []) if n][:4],
        "navigate": nav,
        "language": out.get("language") if out.get("language") in ("he", "en") else None,
        "reply": str(out["reply"])[:160] if kind == "ping" and out.get("reply") else None,
        "settings": settings_changes(out.get("settings")) if kind == "settings" else [],
        "cut_in": cut_kind,
    }


def _near(pack, n, name, reach):
    """A commentator's comments within `reach` lines of n, nearest first."""
    found = []
    for segment in pack.segments:
        distance = abs(segment["n"] - n)
        if distance <= reach:
            for entry in segment["commentaries"].get(name, []):
                found.append((distance, segment["n"], name, entry))
    found.sort(key=lambda t: (t[0], t[1]))
    return [(name_, entry) for _, _, name_, entry in found]


# Where a comment raises a difficulty. "That's the Tzelach's question" can only
# be said about questions it knows are on the page, so every comment near the
# line is scanned for one -- locally, with no call -- and the question itself
# is what the partner sees, not the whole comment.
# "אם כן למה" is the gemara's own question, quoted, not the commentator's.
ASKS = re.compile(r'קשה|קשיא|ק"ל|וא"ת|ואם תאמר|ואת"ל|תימה|תימא|תמוה|יש לדקדק|יש להקשות|יש לתמוה|'
                  r'צ"ע|צריך עיון|צ"ב|צריך ביאור|לכאורה|הקשה|מקשים|(?<!כן )(?<!א"כ )ו?למה|מדוע|'
                  r'מאי טעמא|מה טעם|ואין לומר|היאך')
# Not someone who asks: a translation, and a digest of Tosafot's rulings.
NOT_ASKING = ("Steinsaltz", "Piskei Tosafot")


def _in_order(entries):
    """A work's comments in the book's own order (Sefaria lists them otherwise)."""
    return sorted(entries, key=lambda e: [int(x) if x.isdigit() else 0
                                          for x in re.findall(r"\d+", e["ref"].rsplit(" ", 1)[-1])])


def asked_here(pack, n, most=12, words=36):
    """(name, entry, the question in its words) for comments near line n that
    raise a difficulty -- nearest first, at most three per work."""
    sec = next((x for x in pack.data.get("sections") or [] if x["from"] <= n <= x["to"]), None)
    lines = [s for s in pack.segments
             if (sec["from"] <= s["n"] <= sec["to"] if sec else abs(s["n"] - n) <= 2)]
    lines.sort(key=lambda s: (abs(s["n"] - n), s["n"]))
    out, per = [], {}
    for segment in lines:
        for name, entries in segment["commentaries"].items():
            if name in NOT_ASKING:
                continue
            for entry in _in_order(entries):
                text = " ".join((entry.get("he") or "").split())
                # Not "בתד"ה קשיא" -- the name of a Tosafot, not a question.
                hit = next((h for h in ASKS.finditer(text)
                            if not text[:h.start()].rstrip().endswith('ד"ה')), None)
                if not hit or per.get(name, 0) >= 3:
                    continue
                start = text.rfind(" ", 0, hit.start()) + 1      # from the word it is in
                before = text[:start].split()[-8:]
                after = text[start:].split()[:words - len(before)]
                out.append((name, entry, " ".join(before + after)))
                per[name] = per.get(name, 0) + 1
                if len(out) >= most:
                    return out
    return out


# How people actually say the names, mapped to what Sefaria calls them. Matched
# whole, never by prefix: a prefix match heard "Rashba" and fetched Rashi.
ALIASES = {
    "rashi": "Rashi", "רשי": "Rashi",
    "tosafot": "Tosafot", "tosafos": "Tosafot", "tosfos": "Tosafot", "tosfot": "Tosafot",
    "תוספות": "Tosafot", "tosafotharosh": "Tosafot HaRosh",
    "rashba": "Rashba", "רשבא": "Rashba", "ritva": "Ritva", "ריטבא": "Ritva",
    "ramban": "Ramban", "רמבן": "Ramban", "nachmanides": "Ramban",
    "rambam": "Rambam", "רמבם": "Rambam", "maimonides": "Rambam",
    "rif": "Rif", "ריף": "Rif", "rosh": "Rosh", "ראש": "Rosh",
    "ran": "Ran", "רן": "Ran", "meiri": "Meiri", "hameiri": "Meiri", "מאירי": "Meiri",
    "maharsha": "Maharsha", "מהרשא": "Maharsha", "rashash": "Rashash",
    "peneiyehoshua": "Penei Yehoshua", "pnei yehoshua": "Penei Yehoshua",
    "shitamekubetzet": "Shita Mekubetzet", "shittahmekubbetzet": "Shita Mekubetzet",
    "rabbeinuchananel": "Rabbeinu Chananel", "rabbeinutam": "Tosafot",
    "steinsaltz": "Steinsaltz", "rabbiakivaeiger": "Chiddushei Rabbi Akiva Eiger",
    "akivaeiger": "Chiddushei Rabbi Akiva Eiger", "tzelach": "Tzelach", "צלח": "Tzelach",
    # Past the page: reached through the links rather than found in the pack.
    "rabbeinuyonah": "Rabbeinu Yonah", "רבינויונה": "Rabbeinu Yonah",
    "tur": "Tur", "טור": "Tur", "הטור": "Tur",
    "shulchanarukh": "Shulchan Arukh", "shulchanaruch": "Shulchan Arukh",
    "שולחןערוך": "Shulchan Arukh", "שוע": "Shulchan Arukh",
    "rama": "Rema", "rema": "Rema", "ramo": "Rema", "רמא": "Rema",
    "mishnahberurah": "Mishnah Berurah", "mishnaberura": "Mishnah Berurah",
    "משנהברורה": "Mishnah Berurah", "magenavraham": "Magen Avraham",
    "taz": "Turei Zahav", "טז": "Turei Zahav", "beityosef": "Beit Yosef", "ביתיוסף": "Beit Yosef",
    "bach": "Bach", "arukhhashulchan": "Arukh HaShulchan", "kafhachayim": "Kaf HaChayim",
    "shiltei hagiborim": "Shiltei HaGiborim", "shilteihagiborim": "Shiltei HaGiborim",
    "kesefmishneh": "Kessef Mishneh", "kessefmishneh": "Kessef Mishneh", "כסףמשנה": "Kessef Mishneh",
    "raavad": "Hasagot HaRaavad", "haraavad": "Hasagot HaRaavad", "ראבד": "Hasagot HaRaavad",
    "השגותהראבד": "Hasagot HaRaavad", "lechemmishneh": "Lechem Mishneh", "לחםמשנה": "Lechem Mishneh",
    "mishnehlamelech": "Mishneh LaMelech", "משנהלמלך": "Mishneh LaMelech",
    "darkheimoshe": "Darkhei Moshe", "darkeimoshe": "Darkhei Moshe", "דרכימשה": "Darkhei Moshe",
    "prisha": "Prisha", "פרישה": "Prisha", "machatzithashekel": "Machatzit HaShekel",
    "מחציתהשקל": "Machatzit HaShekel", "perimegadim": "Peri Megadim", "primegadim": "Peri Megadim",
    "pri megadim": "Peri Megadim", "פרימגדים": "Peri Megadim", "shaareiteshuvah": "Sha'arei Teshuvah",
    "שערית שובה": "Sha'arei Teshuvah", "שעריתשובה": "Sha'arei Teshuvah",
    "eliyahrabbah": "Eliyah Rabbah", "אליהרבה": "Eliyah Rabbah",
    "beurhagra": "Beur HaGra", "biurhagra": "Beur HaGra", "gra": "Beur HaGra", "הגרא": "Beur HaGra",
    "beerheitev": "Ba'er Hetev", "baerhetev": "Ba'er Hetev", "בארהיטב": "Ba'er Hetev",
    "magenavraham": "Magen Avraham", "מגןאברהם": "Magen Avraham", "kafhachaim": "Kaf HaChayim",
    "כףהחיים": "Kaf HaChayim", "aruchhashulchan": "Arukh HaShulchan", "ערוךהשולחן": "Arukh HaShulchan",
    "biurhalacha": "Biur Halacha", "beurhalacha": "Biur Halacha", "ביאורהלכה": "Biur Halacha",
    "maharshal": "Maharshal", "מהרשל": "Maharshal", "chokhmatshlomo": "Maharshal",
    "maharam": "Maharam", "maharamlublin": "Maharam", "מהרם": "Maharam",
    "yaavetz": "Ya'avetz", "yavetz": "Ya'avetz", "יעבץ": "Ya'avetz",
    "tzlach": "Tzelach", "tzelach": "Tzelach", "raah": "Ra'ah", "ראה": "Ra'ah",
    "baalhamaor": "Ba'al HaMaor", "hamaor": "Ba'al HaMaor", "בעלהמאור": "Ba'al HaMaor",
    "benyehoyada": "Ben Yehoyada", "בןיהוידע": "Ben Yehoyada", "petacheinayim": "Petach Einayim",
    "פני יהושע": "Penei Yehoshua", "פנייהושע": "Penei Yehoshua",
}

# The codes, and where each hangs: the Rema is inside the Shulchan Arukh's
# text; the later poskim are comments on its seif, or on the Tur's siman.
#
# Names as Sefaria's links call them (checked against its links on Shulchan
# Arukh OC 235:1 and 58:1, Tur OC 235:1 and Mishneh Torah, Reading the Shema
# 1:9 -- see docs/research/halacha.md).
CODES = ("Rambam", "Tur", "Shulchan Arukh")
ON_THE_SEIF = ("Mishnah Berurah", "Magen Avraham", "Turei Zahav", "Kaf HaChayim",
               "Beur HaGra", "Biur Halacha", "Ba'er Hetev", "Machatzit HaShekel", "Peri Megadim",
               "Sha'arei Teshuvah", "Eliyah Rabbah")
ON_THE_TUR = ("Beit Yosef", "Bach", "Darkhei Moshe", "Prisha")
ON_THE_RIF = ("Rabbeinu Yonah", "Shiltei HaGiborim", "Ra'ah")
ON_THE_RAMBAM = ("Kessef Mishneh", "Hasagot HaRaavad", "Lechem Mishneh", "Mishneh LaMelech")
# Not linked to the seif on Sefaria, but numbered by the Shulchan Arukh's simanim.
BY_SIMAN = {"Arukh HaShulchan": "Arukh HaShulchan, Orach Chaim %s"}


def _key(name):
    return "".join(ch for ch in name.lower() if ch.isalnum())


def _canonical(name, present):
    """Match a spoken name to one the pack holds ("Tosfos" -> "Tosafot")."""
    key = _key(name)
    for p in present:
        if _key(p) == key:
            return p
    target = ALIASES.get(key) or ALIASES.get(name.lower())
    return target if target in present else None


def resolve(name, present):
    """A spoken name as the pack or the library knows it, or None."""
    return _canonical(name, present) or ALIASES.get(_key(name)) or ALIASES.get(name.lower())


# Where a commentary says it is ruling. Positional choice picked the Meiri's
# opening paragraph when asked about halacha, while "ולענין פסק הלכה" sat three
# comments further down the same amud.
RULING = re.compile(r"^.{0,40}?(פסק|הלכה|הלכתא|נמצא|לענין מעשה|והלכך)")

# Small exchanges and page-turns open nothing: a mic check does not need the Meiri.
# Questions about people open no commentary either; they fetch the people.
QUIET = ("ping", "reading", "navigate", "people", "review", "quiz", "recall", "settings")


def extras(pack, n, route, depth="daf", budget=7):
    """Sources already in the pack that come into this one turn, beyond the backbone."""
    kind = route.get("kind")
    if kind in QUIET:
        return []
    masechta = pack.data.get("masechta", "")
    present = set(pack.commentators())
    backbone = set(who.backbone_for(masechta))
    chosen = []

    def add(pair):
        if pair not in chosen:
            chosen.append(pair)

    def take(names, reach, per=2, most=None):
        got = 0
        for wanted in names:
            for name in who.filed(wanted, present):
                if name in backbone or (most is not None and got >= most):
                    continue
                pairs = _near(pack, n, name, reach)[:per]
                for pair in pairs:
                    add(pair)
                got += bool(pairs)

    # Named by the learner: always, and look across the whole amud for them --
    # Sefaria hangs the Rosh on this mishna off line 12.
    for spoken in route.get("names", []):
        match = _canonical(spoken, present) or (
            ALIASES.get(_key(spoken)) if who.filed(ALIASES.get(_key(spoken), ""), present) else None)
        if match:
            before = len(chosen)
            take([match], 2, per=3)
            if len(chosen) == before:
                take([match], 99, per=2)

    named = len(chosen)
    # The learner's favourites, where they have something in this unit.
    if kind in who.ROUTES and route.get("prefer"):
        sec = next((x for x in pack.data.get("sections") or [] if x["from"] <= n <= x["to"]), None)
        unit = [s for s in pack.segments
                if (sec["from"] <= s["n"] <= sec["to"] if sec else abs(s["n"] - n) <= 2)]
        unit.sort(key=lambda s: abs(s["n"] - n))
        for wanted in route["prefer"]:
            for name in who.filed(wanted, present):
                entry = next((s["commentaries"][name][0] for s in unit if s["commentaries"].get(name)), None)
                if entry and name not in backbone:
                    add((name, entry))
    if kind == "halacha":
        # Where the Rishonim on this amud say how it is ruled, wherever it
        # sits -- one ruling each, not four paragraphs of the same Meiri.
        # The digests first; the Meiri last -- an overview, light for psak.
        ruled = set()
        for segment in pack.segments:
            for name in ("Rosh", "Rif", "Rashba", "Tosafot HaRosh", "Meiri"):
                if name in ruled:
                    continue
                for entry in segment["commentaries"].get(name, []):
                    if RULING.search(entry["he"]):
                        add((name, entry))
                        ruled.add(name)
                        break
        take(["Rif", "Rosh"], 99, per=1)
    # Otherwise by what kind of work answers what kind of question: a question
    # on Tosafot goes to his explainers (the Maharsha, Tosafot HaRosh), a
    # contradiction with another sugya to R' Akiva Eiger, "why" to the
    # Catalonian novellae, an aggadah to the Maharsha's Chidushei Agadot and the
    # Ben Yehoyada.
    elif kind == "conflict":
        take(who.ASK["conflict"] + who.wide_for(masechta, [kind]), 1, per=1, most=3)
    elif kind == "logic":
        take(who.ASK["logic"] + who.wide_for(masechta, [kind]), 1, per=1, most=3)
    elif kind == "on_commentary":
        names = {resolve(x, present) for x in route.get("names", [])}
        ask = who.ASK["on_tosafot"] if "Tosafot" in names else \
            who.ASK["on_rashi"] if "Rashi" in names else who.ASK["on_commentary"]
        take(ask, 1, per=1, most=3)
    elif kind == "aggadah":
        take(who.ASK["aggadah"], 1, per=1, most=3)
    elif kind == "structure":
        take(["Meiri"], 1, per=1)

    # Depth widens questions about the page, not chat. It offers a few voices,
    # not everyone: in use it opened six a turn, and because the Meiri has a
    # comment on nearly every line he was in every one of them, and in almost
    # every answer. So: at most three, one comment each, and whoever was cited
    # in the last answers goes to the back of the line.
    if kind in who.ROUTES and depth in ("rishonim", "acharonim"):
        pool = who.wide_for(masechta)[:6] + (ACHARONIM if depth == "acharonim" else [])
        avoid = set(route.get("avoid") or [])
        fresh = [x for x in pool if x not in avoid]     # the just-cited sit this one out
        room = min(3, route.get("voices") or 3)
        for name in fresh:
            if room <= 0:
                break
            if name in backbone or name not in present or any(nm == name for nm, _ in chosen):
                continue
            got = _near(pack, n, name, 1)[:1]
            if got:
                add(got[0])
                room -= 1

    # One comment per commentator unless the learner asked for him by name;
    # nobody they asked to leave out, unless they name him; and no more
    # unasked voices than they set (a halacha chain needs at least three).
    mute = set(route.get("mute") or ())
    voices = route.get("voices") or 3
    if kind == "halacha":
        voices = max(voices + 2, 5)
    out, seen, unasked = [], set(), 0
    for i, (name, entry) in enumerate(chosen):
        if i >= named:
            if name in seen or name in mute:
                continue
            if name not in seen and unasked >= voices:
                continue
            unasked += 1
        seen.add(name)
        out.append((name, entry))
    return out[:budget]


def _line_refs(pack, n, reach=0):
    lines = [s for s in pack.segments if abs(s["n"] - n) <= reach]
    lines.sort(key=lambda s: abs(s["n"] - n))
    return lines


def plan(pack, n, route):
    """What to go and get from Sefaria for this turn -- the calls past the page.

    Returns [(job, label)], where a job is what library.gather runs and the
    label is the book as a person would say it, for "let me pull up ...".
    """
    kind = route.get("kind")
    if kind == "people":
        return people_plan(pack, route)
    if kind in ("review", "recall"):
        jobs = [(("recap", ref), "Recap") for ref in route.get("pages") or []] + \
            [(("text", ref), "Parallels") for ref in route.get("parallels") or []]
        # The D.A.F. outline of those dafim, when that site is trusted: a second,
        # fuller summary, and one written for pages learned before this app.
        if web.DAF_SITE in (route.get("sites") or []):
            dafim = []
            for ref in route.get("pages") or []:
                m = re.match(r"^(.+) (\d+)[ab]$", ref)
                if m and (m.group(1), int(m.group(2))) not in dafim:
                    dafim.append((m.group(1), int(m.group(2))))
            jobs += [(("outline", m, d), "D.A.F. outline") for m, d in dafim[-3:]]
        return jobs
    if kind in QUIET or kind == "check_reading":
        return []
    present = set(pack.commentators())
    jobs = []

    def add(job, label):
        if job not in [j for j, _ in jobs]:
            jobs.append((job, label))

    # The ein mishpat of the whole unit they are in, nearest lines first, two
    # per code: asked from the end of the mishna about its opening, the line
    # alone pointed at the Rambam on sacrifices rather than on Shema.
    sec = next((x for x in pack.data.get("sections") or [] if x["from"] <= n <= x["to"]), None)
    lines = [s for s in pack.segments if sec and sec["from"] <= s["n"] <= sec["to"]] or _line_refs(pack, n, 3)
    lines.sort(key=lambda s: abs(s["n"] - n))
    found, titles = {}, set()
    for segment in lines:
        for ref in segment.get("halacha", []):
            book = library.name_of(ref)
            title = ref.rsplit(" ", 1)[0]   # "Mishneh Torah, Reading the Shema"
            if book not in CODES or ref in found.setdefault(book, []) or len(found[book]) >= 2:
                continue
            if book == "Rambam" and title in titles:
                continue  # one halacha per set of hilchot, so each topic is heard
            titles.add(title)
            found[book].append(ref)
    codes = {book: refs[0] for book, refs in found.items()}
    rif = [e["ref"] for s in _line_refs(pack, n, reach=2)
           for e in s["commentaries"].get("Rif", [])][:1]

    named = [resolve(x, present) for x in route.get("names", [])]
    named = [x for x in named if x]
    # The learner's table: a favourite poseik comes with every halacha
    # question; one they left out comes only when named.
    prefer = [x for x in route.get("prefer") or () if x not in named]
    mute = {x for x in route.get("mute") or () if x not in named}
    wants_codes = kind == "halacha" or any(
        x in CODES + ("Rema",) + ON_THE_SEIF + ON_THE_TUR + ON_THE_RAMBAM + tuple(BY_SIMAN) for x in named)
    if wants_codes:
        for book in CODES:
            if book in mute:
                continue
            for ref in found.get(book, []):
                add(("text", ref), book)
        later = [x for x in named if x in ON_THE_SEIF] or \
            [x for x in ["Mishnah Berurah"] if x not in mute]
        if kind == "halacha":
            later += [p for p in prefer if p in ON_THE_SEIF and p not in later]
        for seif in found.get("Shulchan Arukh", []):
            for book in later:
                add(("follow", seif, book), book)
        tur = codes.get("Tur")
        on_tur = [x for x in named if x in ON_THE_TUR]
        if kind == "halacha":
            on_tur += [p for p in prefer if p in ON_THE_TUR and p not in on_tur]
        for book in on_tur:
            if tur:
                add(("follow", tur, book), book)
        # The Rambam's own commentators hang off his halacha.
        rambam = codes.get("Rambam") if "Rambam" not in mute else None
        on_rambam = [x for x in named if x in ON_THE_RAMBAM]
        if kind == "halacha":
            on_rambam += [p for p in prefer if p in ON_THE_RAMBAM and p not in on_rambam]
        for book in on_rambam:
            if rambam:
                add(("follow", rambam, book), book)
        # Numbered by siman though Sefaria does not link them to it.
        wanted = [x for x in named if x in BY_SIMAN] + \
            ([p for p in prefer if p in BY_SIMAN] if kind == "halacha" else [])
        seif = (found.get("Shulchan Arukh") or [None])[0]
        siman = re.search(r"(\d+)(?::\d+)?$", seif or "")
        for book in dict.fromkeys(wanted):
            if siman and seif.startswith("Shulchan Arukh, Orach Chayim"):
                add(("text", BY_SIMAN[book] % siman.group(1)), book)

    # A Rishon who is not on this page but hangs off the Rif. On Berakhot the
    # Rif is read with Talmidei Rabbeinu Yonah as a matter of course, so a
    # halacha question brings him unasked.
    rif_voices = [x for x in named if x in ON_THE_RIF]
    if kind == "halacha" and pack.data.get("masechta") == "Berakhot" and "Rabbeinu Yonah" not in mute:
        rif_voices.append("Rabbeinu Yonah")
    if kind == "halacha":
        rif_voices += [p for p in prefer if p in ON_THE_RIF and p not in rif_voices]
    for book in rif_voices:
        if rif:
            add(("follow", rif[0], book), book)

    # "I remember the opposite elsewhere": what the page itself points at.
    if kind == "conflict":
        seg = pack.segment(n)
        mine = re.compile(r"^%s \d+[ab]:\d+(-\d+)?$" % re.escape(pack.data.get("masechta", "")))
        for ref in [r for r in seg.get("xrefs", []) if mine.match(r)][:2]:
            add(("text", ref), ref)

    # "Give me numbers": tonight's real times, and a summer and a winter night
    # when they ask about the seasons.
    # Trusted sites, for what Sefaria does not have: Rav Ovadia's rulings on
    # Halacha Yomit, the Sha'ar HaTziyun on Wikisource. Named, asked for ("check
    # online"), or -- if the learner set it -- with every halacha question.
    said_ = route.get("said") or ""
    sites = route.get("sites") or []
    wanted = [d for d, pattern in web.WORKS if d in sites and pattern.search(said_)]
    if web.ANY_SITE.search(said_):
        wanted = list(sites)
    if kind == "halacha" and route.get("sites_halacha") and "halachayomit.co.il" in sites:
        wanted.append("halachayomit.co.il")
    seif = (found.get("Shulchan Arukh") or [None])[0]
    siman = re.search(r"Orach Chayim (\d+)", seif or "")
    for domain in dict.fromkeys(wanted):
        if domain == "he.wikisource.org":
            add(("wiki", wiki_query(pack, n, said_, siman.group(1) if siman else None)), web.label(domain))
        else:
            context = "%s%s" % (pack.data.get("he_ref") or pack.ref,
                                ", שולחן ערוך אורח חיים סימן %s" % siman.group(1) if siman else "")
            add(("site", domain, "%s (%s)" % (said_, context)), web.label(domain))

    # A place named on its own ("let's say in Tel Aviv") is about the clock too:
    # in use that turn was answered with a sunset the model made up.
    said = route.get("said") or ""
    place = route.get("place")
    if (CLOCK.search(said) or library.place_in(said)) and kind in ("halacha", "meaning", "other", "logic"):
        import datetime
        today = datetime.date.today()
        add(("zmanim", today.isoformat(), place), "Zmanim")
        if SEASONS.search(said):
            add(("zmanim", "%d-06-21" % today.year, place), "Zmanim")
            add(("zmanim", "%d-12-21" % today.year, place), "Zmanim")
    return jobs


def hebrew_number(n):
    """235 -> רלה, as Wikisource titles number simanim."""
    ones, tens, hundreds = "אבגדהוזחט", "יכלמנסעפצ", "קרשת"
    out, n = "", int(n)
    while n >= 400:
        out, n = out + "ת", n - 400
    if n >= 100:
        out, n = out + hundreds[n // 100 - 1], n % 100
    if n in (15, 16):
        return out + ("טו" if n == 15 else "טז")
    if n >= 10:
        out, n = out + tens[n // 10 - 1], n % 10
    return out + (ones[n - 1] if n else "")


# The Wikisource works, as its titles name them, and how to find the place.
WIKI_WORKS = [
    (re.compile(r"sha'?ar ha-?tziyun|שער הציון", re.I), "שער הציון", "siman"),
    (re.compile(r"birkei yosef|ברכי יוסף", re.I), "ברכי יוסף אורח חיים", "siman"),
    (re.compile(r"chazon ish|חזון איש", re.I), "חזון איש אורח חיים", "siman"),
    (re.compile(r"mordechai|מרדכי", re.I), "מרדכי", "line"),
]


def wiki_query(pack, n, said, siman):
    for pattern, work, by in WIKI_WORKS:
        if pattern.search(said):
            if by == "siman" and siman:
                return "%s %s" % (work, hebrew_number(siman))
            if by == "line":
                words = pack.segment(n)["he_plain"].split()[:4]
                masechta = (pack.data.get("he_ref") or "").split(" ")[0]
                return "%s %s %s" % (work, masechta, " ".join(words))
            return work
    return said


def people_plan(pack, route):
    """Who they asked about -- by name, or, for "when did *he* live?", whoever
    the last answers cited. A commentator on this page is looked up through his
    own book, which names him exactly; anyone else by name."""
    present = set(pack.commentators())
    names = [resolve(x, present) or x for x in route.get("names", [])]
    if not names:
        names = list(route.get("avoid") or [])     # the ones just cited
    books = {}
    for segment in pack.segments:
        for name, entries in segment["commentaries"].items():
            for entry in entries:
                books.setdefault(name, re.sub(r"\s+\d+[ab]?(:\d+)*(-\d+)?$", "", entry["ref"]))
    jobs = []
    for name in names[:3]:
        job = ("person", name, books.get(name), pack.ref)
        if job not in [j for j, _ in jobs]:
            jobs.append((job, "some background on " + name))
    return jobs


CLOCK = re.compile(r"\b(what time|clock|o'?clock|numbers?|real[- ]world time|tonight|today|p\.?m\.?|a\.?m\.?|"
                   r"summer|winter|latest|last time|sunset|sundown|sunrise|dawn|nightfall|dark|stars come out|"
                   r"how long (till|until|to|before))\b|מה השעה|באיזו שעה|עד איזו שעה|הלילה|היום|קיץ|חורף|"
                   r"שקיעה|השקיעה|זריחה|הזריחה|צאת הכוכבים|עלות השחר|מתי מחשיך|כמה זמן עד", re.I)
SEASONS = re.compile(r"\b(summer|winter|seasons?)\b|קיץ|חורף", re.I)
