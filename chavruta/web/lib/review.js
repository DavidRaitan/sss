// Coming back to it: what we learned, and questions on it.
//
// "I'm on daf vav and it's been a while -- what were the last six pages about?"
// "What did we do yesterday?" The answer is built from the pages themselves: a
// short recap of each amud, made once from its text (the Steinsaltz rendering
// where there is one) by the cheap model and kept on disk, then told as one
// story by the partner, citing each amud. What was learned when comes from the
// sittings the app already records.
//
// Ported from chavruta/review.py. The sittings (sessions/<date>.jsonl) are
// store.log rows; the recaps (packs/_recap/<ref>.json) are store.kv "recaps",
// under the same name the file had. The Python's module globals LOAD and
// ON_DISK, set by the server, are `hooks` here, set by the app:
//
//     hooks.LOAD     async ref -> Pack (built from Sefaria if need be)
//     hooks.ON_DISK  async ref -> Pack if built, else null (never fetches)

import * as sefaria from "./sefaria.js";
import { MASECHTOT } from "./commentators.js";
import * as store from "./store.js";
import { LLM } from "./llm.js";
import { re, search, match, findall, escape, pysplit, rsplit, strip, sorted, truthy, any, fmt } from "./py.js";

export const hooks = {
  LOAD: null,        // set by the app: ref -> Pack (built from Sefaria if need be)
  ON_DISK: null,     // set by the app: ref -> Pack if built, else None (never fetches)
};
export const MOST = 20;            // amudim in one review: ten dapim


/** [{"date": "2026-09-27", "refs": ["Berakhot 5a", ...]}], newest first:
 * the amudim read or asked about, per day, in the order they came up.
 *
 * `days`: how many days with sittings to look at (the Python counted its
 * session files, one per day). */
export async function sittings({ days = 60 } = {}) {
  let rows;
  try {
    rows = await store.log.list({ kinds: ["heard", "answer"], fields: ["ref", "at", "kind"] });
  } catch (e) {
    return [];
  }
  const by_day = new Map();
  for (const row of rows) {
    const date = String(row.at || "").slice(0, 10);
    if (!by_day.has(date)) by_day.set(date, []);
    by_day.get(date).push(row);
  }
  const names = sorted([...by_day.keys()], null, true).slice(0, days);
  const out = [];
  for (const name of names) {
    const refs = [];
    for (const row of by_day.get(name)) {
      const ref = row.ref;
      if (["heard", "answer"].includes(row.kind) && truthy(ref) && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
    if (refs.length) {
      out.push({ "date": name, "refs": refs });
    }
  }
  return out;
}


export const WORDS = {
  "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
  "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "fifteen": 15, "twenty": 20, "a couple": 2, "few": 3, "several": 4,
  "אחד": 1, "שני": 2, "שתי": 2, "שניים": 2, "שלוש": 3, "שלושה": 3, "ארבע": 4, "ארבעה": 4,
  "חמש": 5, "חמישה": 5, "שש": 6, "שישה": 6, "שבע": 7, "שבעה": 7, "שמונה": 8, "תשע": 9, "עשר": 10,
  "כמה": 3,
  // "ששת הדפים האחרונים": the construct forms, as people say them.
  "שלושת": 3, "ארבעת": 4, "חמשת": 5, "ששת": 6, "שבעת": 7, "שמונת": 8, "תשעת": 9, "עשרת": 10,
};
export const LAST_TIME = re(String.raw`\b(yesterday|last time|last session|last night|where (was i|we were|did we stop))\b|` +
                            String.raw`אתמול|בפעם הקודמת|פעם שעברה|איפה עצרנו|איפה הייתי`, "i");
export const AMUDIM = re(String.raw`\b(amud|amudim|sides?)\b|עמודים|עמוד`, "i");
export const SO_FAR = re(String.raw`\b(so far|until here|up to here|this (page|amud|daf))\b|עד כאן|עד עכשיו|הדף הזה`, "i");


export function count(said) {
  const m = search(re(String.raw`\b(\d{1,2})\b`), said);
  if (m) {
    return parseInt(m.group(1), 10);
  }
  const low = said.toLowerCase();
  for (const [word, n] of sorted(Object.entries(WORDS), (kv) => -kv[0].length)) {
    if (search(re(String.raw`(?<![\wא-ת])` + escape(word) + String.raw`(?![\wא-ת])`), low)) {
      return n;
    }
  }
  return null;
}


/** The amudim to recap: last time's, or the N dapim before this one. */
export function which_pages(ref, said, history, today) {
  if (search(LAST_TIME, said)) {
    const before = or_list(history.filter((s) => s["date"] < today), history);
    if (truthy(before)) {
      return before[0]["refs"].slice(0, MOST);
    }
  }
  const masechta = rsplit(ref, " ", 1)[0];
  const pages = sefaria.amudim(masechta);
  if (!pages.includes(ref)) {
    return [];
  }
  const at = pages.indexOf(ref);
  const n = count(said) || 2;
  const amudim = search(AMUDIM, said) ? n : n * 2;
  const end = search(SO_FAR, said) ? at + 1 : at;
  const got = pages.slice(Math.max(0, end - Math.min(amudim, MOST)), end);
  return got.length ? got : [ref];
}

const or_list = (a, b) => (a.length ? a : b);


export const PROMPT = `Summarize one amud of Talmud for someone who learned it and wants a
refresher: 2-4 sentences in English -- the question the amud deals with, the
positions or the argument, and where it lands. Hebrew and Aramaic terms in
Hebrew letters. Only what is in the text below; no sources outside it.`;


/** Where a recap is kept: its key in store.kv "recaps" (the Python's file name). */
export function _path(ref) {
  return ref.toLowerCase().replaceAll(" ", "_");
}


export async function has_recap(ref) {
  const kept = await store.kv.get("recaps", _path(ref));
  return kept !== null && kept !== undefined;
}


/** The amud's words for its recap: from its page if built, else the text
 * alone -- one quick call, not the whole page with every commentary. */
export async function _body(ref) {
  const pack = hooks.ON_DISK ? await hooks.ON_DISK(ref) : null;
  if (pack) {
    return pack.segments.map((seg) => (seg.en || []).filter((s) => truthy(s.text)).map((s) => s.text).join(" ") || seg.he)
      .join("\n");
  }
  const data = await sefaria.get(fmt("v3/texts/%s", ref), { soft: true, version: "source" });
  for (const version of (data || {}).versions || []) {
    const he = sefaria.plain(version.text);
    if (he) {
      return he;
    }
  }
  if (hooks.LOAD === null || hooks.LOAD === undefined) {
    return "";
  }
  return (await hooks.LOAD(ref)).segments.map((seg) => seg.he).join("\n");
}


/** A short recap of one amud, as a citable entry under the amud's own ref. */
export async function recap(ref) {
  const path = _path(ref);
  const kept = await store.kv.get("recaps", path);
  if (kept !== null && kept !== undefined) {
    return kept;
  }
  if (!hooks.LOAD && !hooks.ON_DISK) {
    return null;
  }
  const body = (await _body(ref)).slice(0, 9000);
  if (!strip(body)) {
    return null;
  }
  const summary = await new LLM().say(PROMPT, [{ "role": "user", "content": fmt("%s\n\n%s", ref, body) }],
                                      { heavy: false, max_tokens: 600 });
  if (!summary) {
    return null;
  }
  const entry = { "ref": ref, "he": strip(summary), "dibur": null, "fetched": true, "recap": true };
  await store.kv.set("recaps", path, entry);
  return entry;
}


export const QUIZ_OPENING = { "en": "That's the end of the amud. Want a few quick questions on it before you go on?",
                              "he": "סיימנו את העמוד. רוצה כמה שאלות חזרה לפני שממשיכים?" };


// -- "did we learn this?" and "where did I see this?" ----------------------------

export const MISHNA = re(String.raw`\bmishn?ah?\b|המשנה|משנה`, "i");
export const STOP = new Set(["את", "של", "על", "עם", "זה", "זו", "הוא", "היא", "מה", "למה", "איפה", "אנחנו", "למדנו", "ראיתי",
                             "ראינו", "אתמול", "כבר", "פעם", "הזה", "הזאת", "כאן", "שם", "אולי", "אני", "חושב", "זוכר"]);
export const BAVLI = re(String.raw`^(` + MASECHTOT.map((m) => escape(m.name)).join("|") + String.raw`) (\d+)([ab]):`);


/** What to look for: a quoted phrase, else the Hebrew words of what they said. */
export function terms(said) {
  const quoted = findall(re(String.raw`[«\"״“]([^»\"״”]{3,40})[»\"״”]`), said);
  if (quoted.length) {
    return quoted.slice(0, 2);
  }
  const words = findall(re(String.raw`[א-ת\"׳״']{3,}`), said).filter((w) => !STOP.has(w));
  return words.slice(0, 4);
}


/** Nearer pages first: this amud, its neighbours, this masechta, then elsewhere. */
export function _distance(ref, here) {
  const [m, h] = [match(BAVLI, ref + ":"), match(BAVLI, here + ":")];
  if (!(m && h)) {
    return 10 ** 6;
  }
  if (m.group(1) !== h.group(1)) {
    return 10 ** 5;
  }
  return Math.abs((parseInt(m.group(2), 10) * 2 + (m.group(3) === "b" ? 1 : 0)) -
                  (parseInt(h.group(2), 10) * 2 + (h.group(3) === "b" ? 1 : 0)));
}


/** {amud: the dates it was learned}. */
export function studied_on(learned) {
  const out = {};
  for (const sitting of learned) {
    for (const ref of sitting["refs"]) {
      (out[ref] ??= []).push(sitting["date"]);
    }
  }
  return out;
}


/** Lines holding these words, in the pages they learned and the pages
 * already on disk around here -- nearest first. [(line ref, text, dates)]. */
export async function find_words(words, here, learned, { limit = 6 } = {}) {
  if (!truthy(words) || !hooks.ON_DISK) {
    return [];
  }
  const dates = studied_on(learned);
  const masechta = rsplit(here, " ", 1)[0];
  let pool = [...Object.keys(dates), ...sefaria.amudim(masechta)];
  pool = sorted([...new Set(pool)], (r) => [!Object.hasOwn(dates, r), _distance(r, here)]).slice(0, 80);
  const hits = [];
  for (const ref of pool) {
    const pack = await hooks.ON_DISK(ref);
    if (pack === null || pack === undefined) {
      continue;
    }
    for (const seg of pack.segments) {
      if (any(words.map((w) => seg.he_plain.includes(w.replaceAll('"', "").replaceAll("״", ""))))) {
        hits.push([seg.ref, seg.he_plain.slice(0, 160), dates[ref] || []]);
        break;
      }
    }
    if (hits.length >= limit) {
      break;
    }
  }
  return hits;
}


/** Where the page itself points for this passage elsewhere in the Bavli
 * (Mesoret HaShas): nearest first, marked when they learned it. */
export function parallels(pack, n, learned, { limit = 4 } = {}) {
  const sec = (pack.data.sections || []).find((s) => s.from <= n && n <= s.to) ?? null;
  const lines = sec ? Array.from({ length: sec.to - sec.from + 1 }, (_, i) => sec.from + i) : [n];
  const dates = studied_on(learned);
  let refs = [];
  for (const i of lines) {
    for (const ref of pack.segment(i).xrefs || []) {
      if (match(BAVLI, ref) && !ref.startsWith(pack.ref + ":") && !refs.includes(ref)) {
        refs.push(ref);
      }
    }
  }
  refs = sorted(refs, (r) => _distance(r.split(":")[0], pack.ref));
  return refs.slice(0, limit).map((r) => [r, dates[r.split(":")[0]] || []]);
}


/** The mishna this part of the gemara is on: on this page above the line,
 * or walking back page by page. A citable entry, or None. */
export async function find_mishna(ref, n, load, { reach = 24 } = {}) {
  const masechta = rsplit(ref, " ", 1)[0];
  const pages = sefaria.amudim(masechta);
  if (!pages.includes(ref)) {
    return null;
  }
  const at = pages.indexOf(ref);
  for (let i = at; i > Math.max(-1, at - reach); i--) {
    const pack = await load(pages[i]);
    if (pack === null || pack === undefined) {
      return null;
    }
    const mishnas = (pack.data.sections || []).filter((s) => s.kind === "mishna" && (i < at || s.from <= n));
    if (mishnas.length) {
      const sec = mishnas[mishnas.length - 1];
      const lines = [];
      for (let k = sec.from; k <= sec.to; k++) lines.push(pack.segment(k));
      const english = lines.flatMap((seg) => (seg.en || []).filter((s) => truthy(s.text)).map((s) => s.text)).join(" ");
      const body = lines.map((seg) => seg.he).join("\n") + (english ? "\n\n(Steinsaltz) " + english : "");
      const [first, last] = [lines[0].ref, lines[lines.length - 1].ref];
      return { "ref": first === last ? first : fmt("%s-%s", first, rsplit(last, ":", 1)[1]),
               "he": body.slice(0, 6000), "dibur": null, "fetched": true, "amud": pages[i] };
    }
  }
  return null;
}


/** After a page is learned: its recap, made in the background, so "did we
 * learn this?" can be answered from every page they studied. */
export async function recap_quietly(ref) {
  try {
    await recap(ref);
  } catch (e) {
    // pass
  }
}
