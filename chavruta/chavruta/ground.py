# -*- coding: utf-8 -*-
"""The grounding gate: nothing leaves without a reference behind it.

Two failures matter, and they are different. Citing a reference the pack never
held means the source was invented. Naming a commentator without citing him
means the attribution is floating, which is the same failure wearing a
politer face -- "Tosafot says" with nothing after it is exactly the sentence a
talmid chacham will check and we will lose on.

Both are caught here rather than discouraged in the prompt, because a rule that
is only ever asked for is a rule that holds until the one time it doesn't.
"""

import re

CITE = re.compile(r"\[\[([^\]]+)\]\]")

# Naming one of these commits you to citing him in the same answer.
ATTRIBUTIONS = [
    "Rashi", "Tosafot", "Steinsaltz", "Rabbeinu Chananel", "Rif", "Rosh",
    "Ramban", "Rashba", "Ritva", "Ran", "Meiri", "Maharsha", "Rambam",
    "Shulchan Arukh", "Tur", "Rabbeinu Tam",
]


class Verdict:
    def __init__(self, text, unknown, uncited):
        self.text = text
        self.unknown = unknown      # cited, but not in the pack
        self.uncited = uncited      # named, but never cited

    @property
    def ok(self):
        return not self.unknown and not self.uncited

    def complaint(self):
        """What to hand back to the model so it can fix it, in its own terms."""
        parts = []
        if self.unknown:
            parts.append(
                "These references are not in the pack, so they cannot be used: %s. "
                "If the answer needs a source you do not have, say you do not have it."
                % ", ".join(sorted(self.unknown)))
        if self.uncited:
            parts.append(
                "You named %s without citing anything. Attribute from the pack with "
                "[[ref]] or do not name them." % ", ".join(sorted(self.uncited)))
        return " ".join(parts)


def check(text, known_refs):
    cited = {c.strip() for c in CITE.findall(text)}
    unknown = {c for c in cited if c not in known_refs}

    # A name is only fairly counted as an attribution when it is used to report
    # a view, so ignore names that appear inside a citation marker itself.
    bare = CITE.sub(" ", text)
    uncited = set()
    for name in ATTRIBUTIONS:
        if re.search(r"\b%s\b" % re.escape(name), bare) and not any(
                name in c for c in cited):
            uncited.add(name)
    return Verdict(text, unknown, uncited)


def render(text):
    """Strip the machine-readable markers for display, keeping the reference."""
    return CITE.sub(lambda m: "(%s)" % m.group(1).strip(), text)
