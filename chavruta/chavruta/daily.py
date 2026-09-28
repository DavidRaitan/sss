# -*- coding: utf-8 -*-
"""What you are learning: today's daf, and the tractates you have open.

Daf Yomi comes from Sefaria's calendar, which names the daf ("Bekhorot 10");
the learner learns both amudim. It is asked with a time zone -- without one
Sefaria answers for UTC, and in Israel the daf changes at midnight, not at
three in the morning.

Preparing a tractate builds every page of it in the background, one page at a
time with a pause between them (Sefaria is free and asks to be treated
gently), and then the whole-tractate index. A page already built is skipped,
so preparing again only fills what is missing.
"""

import datetime
import json
import os
import threading
import time

from . import sefaria
from .commentators import MASECHTOT

TIMEZONE = os.environ.get("CHAVRUTA_TZ", "Asia/Jerusalem")
_DAYS = {}
_LOCK = threading.Lock()


def _days_path():
    return os.path.join(os.environ.get("CHAVRUTA_PACKS") or os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "packs"), "_dafyomi_days.json")


def daf_yomi(day=None):
    """{"ref": "Bekhorot 10", "he": "בכורות י׳", "amudim": [...], "date": ...} or None."""
    day = day or datetime.date.today()
    key = day.isoformat()
    with _LOCK:
        if not _DAYS:
            try:
                with open(_days_path(), encoding="utf-8") as handle:
                    _DAYS.update(json.load(handle))
            except (OSError, ValueError):
                pass
        if key in _DAYS:
            return _DAYS[key]
    data = sefaria.get("calendars", soft=True, timezone=TIMEZONE, diaspora=0,
                       year=day.year, month=day.month, day=day.day) or {}
    found = None
    for item in data.get("calendar_items") or []:
        if (item.get("title") or {}).get("en") == "Daf Yomi" and item.get("ref"):
            ref = item["ref"]
            masechta = ref.rsplit(" ", 1)[0]
            pages = set(sefaria.amudim(masechta))
            found = {"ref": ref, "he": (item.get("displayValue") or {}).get("he") or ref,
                     "date": key, "masechta": masechta,
                     # Sefaria lacks some Daf Yomi tractates (Shekalim, Kinnim, Middot).
                     "amudim": [ref + a for a in "ab" if ref + a in pages]}
            break
    if found:
        with _LOCK:
            _DAYS[key] = found
            try:
                with open(_days_path(), "w", encoding="utf-8") as handle:
                    json.dump(_DAYS, handle, ensure_ascii=False)
            except OSError:
                pass
    return found


def progress(sittings, today, mine=()):
    """How far they have come: pages learned per tractate, the days in a row
    they learned, and the Daf Yomi -- today's, and how many days running they
    learned that day's daf."""
    learned = {}
    days = set()
    for sitting in sittings:
        days.add(sitting["date"])
        for ref in sitting["refs"]:
            learned.setdefault(ref.rsplit(" ", 1)[0], set()).add(ref)
    streak, day = 0, today
    if day.isoformat() not in days:
        day -= datetime.timedelta(days=1)            # today not started yet: yesterday still counts
    while day.isoformat() in days:
        streak, day = streak + 1, day - datetime.timedelta(days=1)
    all_refs = set().union(*learned.values()) if learned else set()
    todays = daf_yomi(today) or {}
    yomi_streak, day = 0, today
    for _ in range(30):
        d = daf_yomi(day) or {}
        if not d.get("amudim") or not set(d["amudim"]) & all_refs:
            if day == today:
                day -= datetime.timedelta(days=1)
                continue
            break
        yomi_streak, day = yomi_streak + 1, day - datetime.timedelta(days=1)
    tractates = []
    for m in MASECHTOT:
        if m["name"] in learned or m["name"] in mine:
            tractates.append({"name": m["name"], "he": m["he"], "done": len(learned.get(m["name"], ())),
                              "total": len(sefaria.amudim(m["name"]))})
    return {"streak": streak, "learned_today": today.isoformat() in days,
            "daf_yomi": {"ref": todays.get("ref"), "he": todays.get("he"),
                         "done": bool(set(todays.get("amudim") or []) & all_refs), "streak": yomi_streak},
            "tractates": tractates}


class Preparer:
    """Builds whole tractates in the background, and says how far it got."""

    def __init__(self, build, exists, finish=None, pause=0.5):
        self.build, self.exists, self.finish, self.pause = build, exists, finish, pause
        self.state = {}
        self.lock = threading.Lock()

    def status(self, masechta):
        refs = sefaria.amudim(masechta)
        with self.lock:
            s = dict(self.state.get(masechta) or {})
        done = sum(1 for r in refs if self.exists(r))
        return {"masechta": masechta, "total": len(refs), "done": done,
                "running": bool(s.get("running")), "failed": s.get("failed", 0)}

    def start(self, masechta):
        if not any(m["name"] == masechta for m in MASECHTOT):
            return False
        with self.lock:
            if (self.state.get(masechta) or {}).get("running"):
                return True
            self.state[masechta] = {"running": True, "failed": 0}
        threading.Thread(target=self._run, args=(masechta,), daemon=True).start()
        return True

    def _run(self, masechta):
        try:
            for ref in sefaria.amudim(masechta):
                if self.exists(ref):
                    continue
                try:
                    self.build(ref)
                except Exception:
                    with self.lock:
                        self.state[masechta]["failed"] += 1
                time.sleep(self.pause)
            if self.finish:
                self.finish(masechta)
        finally:
            with self.lock:
                self.state[masechta]["running"] = False
