# -*- coding: utf-8 -*-
"""Loading a daf pack and asking it questions.

The pack is the only thing the partner is allowed to know about the page. That
is the whole point: if a claim is not traceable to something in here, it does
not ship (see ground.py).
"""

import json


class Pack:
    def __init__(self, data):
        self.data = data
        self.segments = data["segments"]
        self.is_fixture = bool(data.get("fixture"))
        self.fixture_note = data.get("fixture_note", "")

    @classmethod
    def load(cls, path):
        with open(path, encoding="utf-8") as handle:
            return cls(json.load(handle))

    @property
    def ref(self):
        return self.data["ref"]

    def segment(self, n):
        for segment in self.segments:
            if segment["n"] == n:
                return segment
        raise KeyError("%s has no segment %d" % (self.ref, n))

    def refs(self):
        """Every reference the partner is permitted to cite.

        A citation outside this set is, by construction, something the pack
        never supplied -- which is the signature of an invented source.
        """
        known = {self.ref}
        for segment in self.segments:
            known.add(segment["ref"])
            known.update(segment.get("halacha", []))
            known.update(segment.get("xrefs", []))
            for entries in segment["commentaries"].values():
                known.update(e["ref"] for e in entries)
        return known

    def commentators(self):
        return set(self.data.get("commentators", []))

    def sources_for(self, n, floor=0):
        """Every source on one segment, heaviest first."""
        segment = self.segment(n)
        found = []
        for name, entries in segment["commentaries"].items():
            for entry in entries:
                if entry.get("weight", 0) >= floor:
                    found.append((name, entry))
        return sorted(found, key=lambda pair: -pair[1].get("weight", 0))

    def machlokes_on(self, n):
        """Comments that state a position and then attack it.

        This is what earns an unprompted interruption: silence is the default,
        and a structural turn in the sugya is one of the few exceptions.
        """
        return [(name, e) for name, e in self.sources_for(n)
                if (e.get("structure") or {}).get("is_machlokes")]
