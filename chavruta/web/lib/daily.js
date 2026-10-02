// What you are learning: today's daf, and the tractates you have open.
//
// Daf Yomi comes from Sefaria's calendar, which names the daf ("Bekhorot 10");
// the learner learns both amudim. It is asked with a time zone -- without one
// Sefaria answers for UTC, and in Israel the daf changes at midnight, not at
// three in the morning.
//
// Preparing a tractate builds every page of it in the background, one page at a
// time with a pause between them (Sefaria is free and asks to be treated
// gently), and then the whole-tractate index. A page already built is skipped,
// so preparing again only fills what is missing.
//
// Ported from chavruta/daily.py. A day is "YYYY-MM-DD" (Python's
// date.isoformat()); a Date is also accepted and read in local time, as
// Python's datetime.date.today() was. The days already asked (Python's
// packs/_dafyomi_days.json) are kept in store.kv "days", one key per date.

import * as sefaria from "./sefaria.js";
import { MASECHTOT } from "./commentators.js";
import { config } from "./net.js";
import * as store from "./store.js";
import { truthy } from "./py.js";

// Python: TIMEZONE = os.environ.get("CHAVRUTA_TZ", "Asia/Jerusalem"). Here
// config.tz, read when it is used; failing that, this browser's own zone.
export function TIMEZONE() {
  return config.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Jerusalem";
}
export const _DAYS = new Map();

/** A day as "YYYY-MM-DD": a string as given, a Date in local time. */
export function _iso(day) {
  if (day instanceof Date) return store.today(day);
  return String(day);
}

/** day - n days (n may be negative), as "YYYY-MM-DD". */
export function _shift(day, n) {
  const [y, m, d] = _iso(day).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}


/** {"ref": "Bekhorot 10", "he": "בכורות י׳", "amudim": [...], "date": ...} or None. */
export async function daf_yomi({ day = null } = {}) {
  const key = _iso(day || store.today());
  if (!_DAYS.has(key)) {
    try {
      const kept = await store.kv.get("days", key);
      if (kept) _DAYS.set(key, kept);
    } catch (e) {
      // not kept: asked again
    }
  }
  if (_DAYS.has(key)) {
    return _DAYS.get(key);
  }
  const [year, month, date] = key.split("-").map(Number);
  const data = (await sefaria.get("calendars", { soft: true, timezone: TIMEZONE(), diaspora: 0,
                                                year, month, day: date })) || {};
  let found = null;
  for (const item of data.calendar_items || []) {
    if ((item.title || {}).en === "Daf Yomi" && item.ref) {
      const ref = item.ref;
      const masechta = _rsplit_first(ref);
      const pages = new Set(sefaria.amudim(masechta));
      found = { "ref": ref, "he": (item.displayValue || {}).he || ref,
                "date": key, "masechta": masechta,
                // Sefaria lacks some Daf Yomi tractates (Shekalim, Kinnim, Middot).
                "amudim": [...("ab")].map((a) => ref + a).filter((r) => pages.has(r)) };
      break;
    }
  }
  if (found) {
    _DAYS.set(key, found);
    try {
      await store.kv.set("days", key, found);
    } catch (e) {
      // not kept
    }
  }
  return found;
}


const _rsplit_first = (ref) => (ref.includes(" ") ? ref.slice(0, ref.lastIndexOf(" ")) : ref);
const _has = (c, x) => (c instanceof Set || c instanceof Map ? c.has(x) : Array.isArray(c) || typeof c === "string"
  ? c.includes(x) : c !== null && c !== undefined && Object.hasOwn(c, x));


/** How far they have come: pages learned per tractate, the days in a row
 * they learned, and the Daf Yomi -- today's, and how many days running they
 * learned that day's daf. */
export async function progress(sittings, today, { mine = [] } = {}) {
  today = _iso(today);
  const learned = new Map();
  const days = new Set();
  for (const sitting of sittings) {
    days.add(sitting["date"]);
    for (const ref of sitting["refs"]) {
      const m = _rsplit_first(ref);
      if (!learned.has(m)) learned.set(m, new Set());
      learned.get(m).add(ref);
    }
  }
  let streak = 0, day = today;
  if (!days.has(day)) {
    day = _shift(day, -1);            // today not started yet: yesterday still counts
  }
  while (days.has(day)) {
    [streak, day] = [streak + 1, _shift(day, -1)];
  }
  const all_refs = new Set([...learned.values()].flatMap((s) => [...s]));
  const meets = (amudim) => (amudim || []).some((r) => all_refs.has(r));
  const todays = (await daf_yomi({ day: today })) || {};
  let yomi_streak = 0;
  day = today;
  for (let _ = 0; _ < 30; _++) {
    const d = (await daf_yomi({ day })) || {};
    if (!truthy(d.amudim) || !meets(d.amudim)) {
      if (day === today) {
        day = _shift(day, -1);
        continue;
      }
      break;
    }
    [yomi_streak, day] = [yomi_streak + 1, _shift(day, -1)];
  }
  const tractates = [];
  for (const m of MASECHTOT) {
    if (learned.has(m.name) || _has(mine, m.name)) {
      tractates.push({ "name": m.name, "he": m.he, "done": (learned.get(m.name) || new Set()).size,
                       "total": sefaria.amudim(m.name).length });
    }
  }
  return { "streak": streak, "learned_today": days.has(today),
           "daf_yomi": { "ref": todays.ref ?? null, "he": todays.he ?? null,
                         "done": meets(todays.amudim), "streak": yomi_streak },
           "tractates": tractates };
}


const sleep = (seconds) => new Promise((ok) => setTimeout(ok, seconds * 1000));


/** Builds whole tractates in the background, and says how far it got.
 *
 * build(ref), exists(ref) and finish(masechta) may be async; they are awaited.
 * Python's thread is an async loop here, started and not awaited by start();
 * the loop of each tractate is kept in `runs` (for whoever wants to wait on it). */
export class Preparer {
  constructor(build, exists, { finish = null, pause = 0.5 } = {}) {
    [this.build, this.exists, this.finish, this.pause] = [build, exists, finish, pause];
    this.state = {};
    this.runs = {};
  }

  async status(masechta) {
    const refs = sefaria.amudim(masechta);
    const s = { ...(this.state[masechta] || {}) };
    let done = 0;
    for (const r of refs) {
      if (await this.exists(r)) done += 1;
    }
    return { "masechta": masechta, "total": refs.length, "done": done,
             "running": Boolean(s.running), "failed": s.failed ?? 0 };
  }

  start(masechta) {
    if (!MASECHTOT.some((m) => m.name === masechta)) {
      return false;
    }
    if ((this.state[masechta] || {}).running) {
      return true;
    }
    this.state[masechta] = { "running": true, "failed": 0 };
    this.runs[masechta] = this._run(masechta);
    return true;
  }

  async _run(masechta) {
    try {
      for (const ref of sefaria.amudim(masechta)) {
        if (await this.exists(ref)) {
          continue;
        }
        try {
          await this.build(ref);
        } catch (e) {
          this.state[masechta].failed += 1;
        }
        await sleep(this.pause);
      }
      if (this.finish) {
        await this.finish(masechta);
      }
    } catch (e) {
      // A daemon thread's error ended the thread and nothing else.
    } finally {
      this.state[masechta].running = false;
    }
  }
}
