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

from . import commentators as who

KINDS = list(who.ROUTES) + ["reading", "navigate", "other"]

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
 "language": "he" if they spoke mostly Hebrew, "en" if mostly English}

The kinds:
%s
- reading: they are reading the text aloud, not saying anything about it
- navigate: they asked to go to another page ("go to daf 5", "תעבור לדף ה׳ עמוד ב")
- other: anything else

Hebrew numerals for pages: ב=2, י=10, יא=11, טו=15, כ=20, ל=30, מ=40, נ=50, ס=60.
"עמוד א" is a, "עמוד ב" is b. If no amud is said, use a.""" % (
    KINDS, "\n".join("- %s: %s" % (k, v) for k, v in who.ROUTES.items()))


def classify(llm, said):
    """One short call to the budget model. On any failure, consult broadly."""
    try:
        out = llm.json(ROUTER_SYSTEM, [{"role": "user", "content": said}], heavy=False)
    except Exception:
        return {"kind": "other", "claim": False, "names": [], "navigate": None, "language": None}
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
    "akivaeiger": "Chiddushei Rabbi Akiva Eiger",
}


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


def extras(pack, n, route, depth="daf", budget=7):
    """Bench sources that come into this one turn, beyond the backbone."""
    masechta = pack.data.get("masechta", "")
    present = set(pack.commentators())
    backbone = set(who.backbone_for(masechta))
    chosen = []

    def take(names, reach, per=2):
        for name in names:
            if name in backbone or name not in present:
                continue
            got = _near(pack, n, name, reach)[:per]
            for pair in got:
                if pair not in chosen:
                    chosen.append(pair)

    # Named by the learner: always, and look further afield for them.
    for spoken in route.get("names", []):
        match = _canonical(spoken, present)
        if match:
            before = len(chosen)
            take([match], 2, per=3)
            if len(chosen) == before:
                take([match], 99, per=2)

    kind = route.get("kind")
    if kind == "halacha":
        take(["Rif", "Rosh", "Meiri"], 2)
    elif kind in ("logic", "conflict"):
        take(who.wide_for(masechta, [kind])[:3], 1, per=1)
    elif kind == "on_commentary":
        take(["Maharsha", "Penei Yehoshua"], 1)
    elif kind == "structure":
        take(["Meiri"], 1, per=1)

    if depth in ("rishonim", "acharonim"):
        take(who.wide_for(masechta)[:5], 1, per=1)
    if depth == "acharonim":
        take(ACHARONIM, 1, per=1)

    return chosen[:budget]
