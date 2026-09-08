# -*- coding: utf-8 -*-
"""Searching a whole masechta, so the partner can place a page in its tractate.

A pack knows one amud in depth and the rest of the tractate not at all, which
is the wrong shape for the questions people actually ask -- "haven't we had
this already", "isn't that the opposite of what it says further on". Answering
those means knowing where a phrase turns up elsewhere.

Two ways in. A phrase search, for when the learner names the thing. And a
relatedness pass, for when they only gesture at it: pages are scored by the
rare words they share with the line in hand, since a word that appears on
forty amudim tells you nothing and one that appears on three tells you a lot.
"""

import json
import math
import os
import re
from collections import Counter

WORD = re.compile(r"[א-ת]{3,}")

# Grammatical furniture. These carry no information about what a page is about.
STOP = set("""אמר אמרי ליה להו לן לך לו לה הוא היא הם הן אשר אלא אלה ההוא ההיא
מאי מאן היכי הכי הכא התם דהא דלא ולא ואם אבל כאן כאשר משום מפני בכל וכל ככל
רבי רב תנא תניא תנו רבנן דאמר דתנן דכתיב שנאמר קרא לומר כלומר צריך אינו אין
יש הרי אפילו כגון וכן ועוד ומאי דבר דברים זמן שעה יום לילה""".split())


class Index:
    def __init__(self, data):
        self.masechta = data["masechta"]
        self.pages = data["pages"]
        # How many amudim each word appears on -- the basis for calling it rare.
        self.spread = Counter()
        for page in self.pages.values():
            for word in {w for line in page["lines"] for w in WORD.findall(line)}:
                self.spread[word] += 1
        self.total = max(len(self.pages), 1)

    @classmethod
    def load(cls, packs_dir, masechta):
        path = os.path.join(packs_dir, "_index_%s.json" % masechta.lower().replace(" ", "_"))
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8") as handle:
            return cls(json.load(handle))

    def weight(self, word):
        """Rarer words count for more; ubiquitous ones for nothing."""
        if word in STOP:
            return 0.0
        seen = self.spread.get(word, 0)
        if not seen or seen > self.total * 0.25:
            return 0.0
        return math.log(self.total / seen)

    def phrase(self, text, limit=6, exclude=None):
        """Where these exact words run together elsewhere in the masechta."""
        words = [w for w in WORD.findall(text) if w not in STOP]
        if len(words) < 2:
            return []
        needle = " ".join(words[:6])
        hits = []
        for ref, page in self.pages.items():
            if ref == exclude:
                continue
            for i, blob in enumerate(page["lines"], start=1):
                if needle in blob:
                    hits.append({"ref": "%s:%d" % (ref, i), "text": blob[:160]})
                    break
            if len(hits) >= limit:
                break
        return hits

    def related(self, text, limit=5, exclude=None):
        """Which other amudim share this line's uncommon vocabulary."""
        wanted = {w: self.weight(w) for w in set(WORD.findall(text))}
        wanted = {w: s for w, s in wanted.items() if s > 0}
        if not wanted:
            return []
        scored = []
        for ref, page in self.pages.items():
            if ref == exclude:
                continue
            words = {w for line in page["lines"] for w in WORD.findall(line)}
            shared = wanted.keys() & words
            if len(shared) < 2:
                continue
            scored.append((sum(wanted[w] for w in shared), ref, sorted(shared, key=lambda w: -wanted[w])[:4]))
        scored.sort(reverse=True)
        return [{"ref": ref, "shares": shares} for _, ref, shares in scored[:limit]]
