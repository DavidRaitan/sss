# -*- coding: utf-8 -*-
"""The grounding gate: nothing leaves without a reference behind it.

Two failures matter. Citing a reference the pack never held means the source
was invented. Naming a commentator without citing him means the attribution is
floating -- "Tosafot says" with nothing after it is exactly the sentence a
talmid chacham checks, and we lose on.

It has to work in Hebrew as well as English. The first version only knew the
English names, so a reply in Hebrew could say "רש״י אומר" with nothing behind
it and pass -- the gate was blind in the language the learner speaks.
"""

import re

CITE = re.compile(r"\[\[([^\]]+)\]\]")
QUOTE_MARK = "[\"'״׳’]"
# Hebrew prefixes -- ו ב ל כ ש מ ה ד -- sit directly on a name, and they stack:
# "והרשב״א" is ו + ה + רשב״א.
PREFIX = "(?<![\u05d0-\u05eaA-Za-z])[\u05d5\u05d1\u05dc\u05db\u05e9\u05de\u05d4\u05d3]{0,2}"
END = "(?![א-תA-Za-z])"

# name -> (English spellings, Hebrew spellings with ~ for a quote mark,
#          what a citation of him looks like)
NAMES = {
    "Rashi": (["Rashi"], ["רש~י"], ["Rashi on"]),
    "Tosafot": (["Tosafot", "Tosafos", "Tosfos"], ["תוספות", "תוס~"], ["Tosafot on"]),
    "Tosafot HaRosh": (["Tosafot HaRosh"], ["תוספות הרא~ש"], ["Tosafot HaRosh"]),
    "Steinsaltz": (["Steinsaltz"], ["שטיינזלץ"], ["Steinsaltz", "Berakhot"]),
    "Rabbeinu Chananel": (["Rabbeinu Chananel"], ["רבינו חננאל", "ר~ח"], ["Rabbeinu Chananel"]),
    "Rif": (["Rif"], ["רי~ף"], ["Rif "]),
    "Rosh": (["Rosh"], ["רא~ש"], ["Rosh on"]),
    "Ramban": (["Ramban"], ["רמב~ן"], ["Ramban"]),
    "Rashba": (["Rashba"], ["רשב~א"], ["Rashba"]),
    "Ritva": (["Ritva"], ["ריטב~א"], ["Ritva"]),
    "Ran": (["Ran"], ["ר~ן"], ["Ran on"]),
    "Meiri": (["Meiri"], ["מאירי"], ["Meiri"]),
    "Maharsha": (["Maharsha"], ["מהרש~א"], ["Maharsha"]),
    "Rambam": (["Rambam", "Maimonides"], ["רמב~ם"], ["Mishneh Torah"]),
    "Shulchan Arukh": (["Shulchan Arukh", "Shulchan Aruch"], ["שולחן ערוך", "שו~ע"], ["Shulchan Arukh"]),
    "Tur": (["Tur"], ["הטור"], ["Tur,"]),
    "Rabbeinu Tam": (["Rabbeinu Tam"], ["רבינו תם", "ר~ת"], ["Tosafot on"]),
    "Shita Mekubetzet": (["Shita Mekubetzet"], ["שיטה מקובצת"], ["Shita Mekubetzet"]),
}


def _pattern(english, hebrew):
    parts = [r"\b%s\b" % re.escape(e) for e in english]
    # Escape around the placeholder, not through it: re.escape turns "~" into
    # "\~", which would make the quote a literal bracket and match nothing.
    parts += [PREFIX + QUOTE_MARK.join(re.escape(p) for p in h.split("~")) + END
              for h in hebrew]
    return re.compile("|".join(parts))


PATTERNS = {name: _pattern(en, he) for name, (en, he, _) in NAMES.items()}


class Verdict:
    def __init__(self, text, unknown, uncited):
        self.text = text
        self.unknown = unknown      # cited, but not in the pack
        self.uncited = uncited      # named, but never cited

    @property
    def ok(self):
        return not self.unknown and not self.uncited

    def complaint(self):
        parts = []
        if self.unknown:
            parts.append(
                "These references are not in the material you were given, so they "
                "cannot be used: %s. If the answer needs a source you do not have, "
                "say you do not have it here." % ", ".join(sorted(self.unknown)))
        if self.uncited:
            parts.append(
                "You named %s without a citation. Put the [[ref]] right after the "
                "name, or do not attribute it." % ", ".join(sorted(self.uncited)))
        return " ".join(parts)


def check(text, known_refs):
    cited = [c.strip() for c in CITE.findall(text)]
    unknown = {c for c in cited if c not in known_refs}
    bare = CITE.sub(" ", text)
    uncited = set()
    for name, pattern in PATTERNS.items():
        if not pattern.search(bare):
            continue
        looks_like = NAMES[name][2]
        if not any(any(mark in c for mark in looks_like) for c in cited):
            uncited.add(name)
    # "Tosafot HaRosh" also matches "Tosafot"; if the longer name is cited,
    # the shorter one is not a separate floating claim.
    if "Tosafot" in uncited and any("Tosafot HaRosh" in c for c in cited) \
            and not re.search(r"\bTosafot\b(?! HaRosh)", bare):
        uncited.discard("Tosafot")
    return Verdict(text, unknown, uncited)


def render(text):
    """For a transcript: keep the reference, drop the machine markers."""
    return CITE.sub(lambda m: "(%s)" % m.group(1).strip(), text)
