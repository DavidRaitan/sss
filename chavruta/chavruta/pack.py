# -*- coding: utf-8 -*-
"""A daf pack, loaded, and the questions the rest of the app asks of it.

The pack is the only thing the partner is allowed to know about the page. If a
claim is not traceable to something in here, it does not ship (see ground.py).
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
        return self.segments[min(max(n, 1), len(self.segments)) - 1]

    def refs(self):
        """Every reference the partner may cite. Anything else was invented."""
        known = {self.ref}
        for segment in self.segments:
            known.add(segment["ref"])
            known.update(segment.get("halacha", []))
            known.update(segment.get("xrefs", []))
            for refs in (segment.get("related") or {}).values():
                known.update(refs)
            for entries in segment["commentaries"].values():
                known.update(e["ref"] for e in entries)
        return known

    def commentators(self):
        return list(self.data.get("commentators") or
                    sorted({c for s in self.segments for c in s["commentaries"]}))

    def sources_for(self, n, names=None):
        segment = self.segment(n)
        found = []
        for name, entries in segment["commentaries"].items():
            if names is None or name in names:
                found.extend((name, e) for e in entries)
        return sorted(found, key=lambda pair: -pair[1].get("weight", 0))

    def machlokes_on(self, n):
        """Comments that state a position and then attack it -- the one kind of
        structural turn that earns an unprompted interruption."""
        return [(name, e) for name, e in self.sources_for(n)
                if (e.get("structure") or {}).get("is_machlokes")]
