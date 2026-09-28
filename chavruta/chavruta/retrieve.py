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
from . import library

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
}
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
 "navigate": {"daf": number, "amud": "a" or "b"} if they asked to go to a
             page, else null,
 "language": "he" if they spoke mostly Hebrew, "en" if mostly English,
 "reply": only when kind is "ping": the few words a study partner across the
          table would say back, in their language ("Yes, I hear you.", "Go
          ahead.", "כן, שומע אותך.", "יאללה, קדימה."), else null}

The kinds:
%s
- reading: they are reading the text aloud, not saying anything about it
- navigate: they asked to go to another page ("go to daf 5", "תעבור לדף ה׳ עמוד ב")

Hebrew numerals for pages: ב=2, י=10, יא=11, טו=15, כ=20, ל=30, מ=40, נ=50, ס=60.
"עמוד א" is a, "עמוד ב" is b. If no amud is said, use a.""" % (
    KINDS, "\n".join("- %s: %s" % (k, v) for k, v in list(who.ROUTES.items()) + list(LIGHT.items())))


def classify(llm, said):
    """One short call to the budget model. On any failure, consult broadly."""
    try:
        out = llm.json(ROUTER_SYSTEM, [{"role": "user", "content": said}], heavy=False)
    except Exception:
        return {"kind": "other", "claim": False, "names": [], "navigate": None, "language": None,
                "reply": None}
    kind = out.get("kind")
    nav = out.get("navigate")
    if not (isinstance(nav, dict) and str(nav.get("daf", "")).isdigit()):
        nav = None
    else:
        nav = {"daf": int(nav["daf"]), "amud": "b" if str(nav.get("amud")).lower() == "b" else "a"}
    return {
        "kind": kind if kind in KINDS else "other",
        "claim": bool(out.get("claim")),
        "names": [str(n) for n in (out.get("names") or []) if n][:4],
        "navigate": nav,
        "language": out.get("language") if out.get("language") in ("he", "en") else None,
        "reply": str(out["reply"])[:160] if kind == "ping" and out.get("reply") else None,
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
}

# The codes, and where each hangs: the Rema is inside the Shulchan Arukh's
# text; the later poskim are comments on its seif, or on the Tur's siman.
CODES = ("Rambam", "Tur", "Shulchan Arukh")
ON_THE_SEIF = ("Mishnah Berurah", "Magen Avraham", "Turei Zahav", "Kaf HaChayim",
               "Beur HaGra", "Biur Halacha", "Ba'er Hetev")
ON_THE_TUR = ("Beit Yosef", "Bach", "Prisha")
ON_THE_RIF = ("Rabbeinu Yonah", "Shiltei HaGiborim", "Ra'ah")


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
QUIET = ("ping", "reading", "navigate")


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

    def take(names, reach, per=2):
        for name in names:
            if name in backbone or name not in present:
                continue
            for pair in _near(pack, n, name, reach)[:per]:
                add(pair)

    # Named by the learner: always, and look across the whole amud for them --
    # Sefaria hangs the Rosh on this mishna off line 12.
    for spoken in route.get("names", []):
        match = _canonical(spoken, present)
        if match:
            before = len(chosen)
            take([match], 2, per=3)
            if len(chosen) == before:
                take([match], 99, per=2)

    named = len(chosen)
    if kind == "halacha":
        # Where the Rishonim on this amud say how it is ruled, wherever it
        # sits -- one ruling each, not four paragraphs of the same Meiri.
        ruled = set()
        for segment in pack.segments:
            for name in ("Rosh", "Rif", "Meiri", "Rashba", "Tosafot HaRosh"):
                if name in ruled:
                    continue
                for entry in segment["commentaries"].get(name, []):
                    if RULING.search(entry["he"]):
                        add((name, entry))
                        ruled.add(name)
                        break
        take(["Rif", "Rosh"], 99, per=1)
    elif kind in ("logic", "conflict"):
        take(who.wide_for(masechta, [kind])[:3], 1, per=1)
    elif kind == "on_commentary":
        take(["Maharsha", "Penei Yehoshua"], 1)
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
        room = 3
        for name in fresh:
            if room <= 0:
                break
            if name in backbone or name not in present or any(nm == name for nm, _ in chosen):
                continue
            got = _near(pack, n, name, 1)[:1]
            if got:
                add(got[0])
                room -= 1

    # One comment per commentator unless the learner asked for him by name.
    out, seen = [], set()
    for i, (name, entry) in enumerate(chosen):
        if i >= named and name in seen:
            continue
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
    wants_codes = kind == "halacha" or any(x in CODES + ("Rema",) + ON_THE_SEIF + ON_THE_TUR for x in named)
    if wants_codes:
        for book in CODES:
            for ref in found.get(book, []):
                add(("text", ref), book)
        later = [x for x in named if x in ON_THE_SEIF] or ["Mishnah Berurah"]
        for seif in found.get("Shulchan Arukh", []):
            for book in later:
                add(("follow", seif, book), book)
        tur = codes.get("Tur")
        for book in [x for x in named if x in ON_THE_TUR]:
            if tur:
                add(("follow", tur, book), book)

    # A Rishon who is not on this page but hangs off the Rif.
    for book in named:
        if book in ON_THE_RIF and rif:
            add(("follow", rif[0], book), book)

    # "I remember the opposite elsewhere": what the page itself points at.
    if kind == "conflict":
        seg = pack.segment(n)
        mine = re.compile(r"^%s \d+[ab]:\d+(-\d+)?$" % re.escape(pack.data.get("masechta", "")))
        for ref in [r for r in seg.get("xrefs", []) if mine.match(r)][:2]:
            add(("text", ref), ref)

    # "Give me numbers": tonight's real times, and a summer and a winter night
    # when they ask about the seasons.
    said = route.get("said") or ""
    if CLOCK.search(said) and kind in ("halacha", "meaning", "other", "logic"):
        import datetime
        today = datetime.date.today()
        add(("zmanim", today.isoformat()), "Zmanim")
        if SEASONS.search(said):
            add(("zmanim", "%d-06-21" % today.year), "Zmanim")
            add(("zmanim", "%d-12-21" % today.year), "Zmanim")
    return jobs


CLOCK = re.compile(r"\b(what time|clock|o'?clock|numbers?|real[- ]world time|tonight|today|p\.?m\.?|a\.?m\.?|"
                   r"summer|winter|latest|last time)\b|מה השעה|באיזו שעה|עד איזו שעה|הלילה|היום|קיץ|חורף", re.I)
SEASONS = re.compile(r"\b(summer|winter|seasons?)\b|קיץ|חורף", re.I)
