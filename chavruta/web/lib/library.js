// Past the page: going to get a source while the learner waits.
//
// The pack holds what Sefaria links to the amud, and for most of the conversation
// that is enough. But a chavruta asked "was this codified in the Tur?" does not
// say "I don't have the Tur here". They reach for it. The page already names where
// to go -- the ein mishpat points at the Rambam, the Tur and the Shulchan Arukh;
// the Rif's links lead to Rabbeinu Yonah; the Shulchan Arukh's lead to the
// Mishnah Berurah -- so going there is a few requests, made in parallel, and
// cached for the rest of the sitting.
//
// Everything fetched comes back as a plain entry with its exact ref, so the
// grounding gate treats it like anything else in the pack: citable because it was
// actually read, and only then.
//
// Ported from chavruta/library.py. The thread pool and its deadline are
// promises side by side, each given until DEADLINE (py.js within()). The
// module's caches are Maps; a tuple key is a string (JSON of the tuple).

import * as review from "./review.js";
import * as sefaria from "./sefaria.js";
import * as web from "./web.js";
import * as store from "./store.js";
import { LLM } from "./llm.js";
import { config, getJSON, urlencode, quote, HttpError } from "./net.js";
import { re, search, sub, escape, pysplit, rsplit, sorted, truthy, fmt, now, within, pyround } from "./py.js";

export const _TEXTS = new Map(), _LINKS = new Map();
// How long a turn may wait on Sefaria in total. Past this the partner answers
// from what did arrive and says what did not.
export const DEADLINE = 14.0;


export function _key(name) {
  return [...(name || "").toLowerCase()].filter((ch) => /^[\p{L}\p{N}]$/u.test(ch)).join("");
}


/** What people call the book a ref is in: "Tur, Orach Chayim 235" -> "Tur". */
export function name_of(ref) {
  if (ref.startsWith("Mishneh Torah")) {
    return "Rambam";
  }
  if (ref.startsWith("Shulchan Arukh")) {
    return "Shulchan Arukh";
  }
  if (ref.startsWith("Sefer Mitzvot Gadol")) {
    return "Semag";
  }
  const title = ref.includes(" on ") ? ref.split(" on ")[0] : ref.split(",")[0];
  return /\d/u.test(title.slice(-1)) ? rsplit(title, " ", 1)[0] : title;
}


/** The Hebrew of any ref as plain text, or None if Sefaria has none. */
export async function text(ref) {
  if (_TEXTS.has(ref)) {
    return _TEXTS.get(ref);
  }
  // A page of a trusted site, or a cited night's times, opens in the
  // panel like any other source.
  const page = await web.cached(ref);
  if (page) {
    return page;
  }
  for (const entry of _ZMANIM.values()) {
    if (entry && entry.ref === ref) {
      return entry;
    }
  }
  const data = await sefaria.get(fmt("v3/texts/%s", ref), { soft: true, version: "source" });
  let entry = null;
  for (const version of (data || {}).versions || []) {
    if (version.languageFamilyName === "hebrew" || version.actualLanguage === "he") {
      const he = sefaria.plain(version.text);
      if (he) {
        entry = { "ref": data.ref || ref, "he": he, "he_ref": data.heRef ?? null,
                  "dibur": null, "fetched": true };
        break;
      }
    }
  }
  _TEXTS.set(ref, entry);
  return entry;
}


/** Everything Sefaria links to a ref, with the text of each. */
export async function links(ref) {
  if (_LINKS.has(ref)) {
    return _LINKS.get(ref);
  }
  let found = (await sefaria.get(fmt("links/%s", ref), { soft: true, with_text: 1 })) || [];
  found = Array.isArray(found) ? found : [];
  _LINKS.set(ref, found);
  return found;
}


/** The comments of one work hanging off a ref: [(name, entry)], in order.
 *
 * `want` is matched against the work's own name ("Mishnah Berurah",
 * "Rabbeinu Yonah"). Only comments on this exact ref: a seif of the Shulchan
 * Arukh links to Mishnah Berurah notes on three other simanim too, which
 * merely quote it ("Quoting Commentary"). */
export async function follow(ref, want) {
  const out = [];
  for (const link of await links(ref)) {
    const name = sefaria.commentator(link);
    if (_key(name) !== _key(want) || link.category !== "Commentary") {
      continue;
    }
    const anchor = link.anchorRef || "";
    if (anchor && anchor !== ref) {
      continue;
    }
    const body = sefaria.plain(link.he);
    if (body) {
      out.push([name, { "ref": link.ref ?? null, "he": body, "dibur": null, "fetched": true }]);
    }
  }
  return sorted(out, (pair) => _order(pair[1].ref));
}


export function _order(ref) {
  const tail = rsplit(ref, " ", 1).slice(-1)[0];
  return tail.replaceAll("-", ":").split(":").map((p) => (/^\d+$/u.test(p) ? parseInt(p, 10) : 0));
}


const TIMED_OUT = Symbol("timed out");

/** Run fetch jobs side by side. Each job is ("text", ref) or ("follow", ref, name).
 *
 * Returns (found, missed): found is [(name, entry)] in job order; missed is the
 * jobs that came back empty or ran out of time. */
export async function gather(jobs) {
  const started = now();
  const run = async (job) => {
    if (job[0] === "text") return text(job[1]);
    if (job[0] === "zmanim") return zmanim(job[1], { place: job.length > 2 ? job[2] : null });
    if (job[0] === "person") return person(job[1], { book: job.length > 2 ? job[2] : null, page: job.length > 3 ? job[3] : null });
    if (job[0] === "site") return _site(job[1], job[2]);
    if (job[0] === "wiki") return web.wikisource(job[1]);
    if (job[0] === "recap") return review.recap(job[1]);
    if (job[0] === "outline") return _outline(job[1], job[2]);
    return follow(job[1], job[2]);
  };
  const futures = jobs.map((job) => [job, within(run(job).then((r) => ({ result: r }), () => ({ result: null })),
                                                 DEADLINE, TIMED_OUT)]);
  const found = [], missed = [];
  for (const [job, future] of futures) {
    const done = await future;
    if (done === TIMED_OUT) {
      missed.push(job);
      continue;
    }
    const result = done.result;
    if (!truthy(result)) {
      missed.push(job);
    } else if (job[0] === "text") {
      found.push([name_of(result.ref), result]);
    } else if (job[0] === "zmanim") {
      found.push(["Zmanim", result]);
    } else if (job[0] === "person") {
      found.push(["About " + job[1], result]);
    } else if (job[0] === "recap") {
      found.push(["Recap", result]);
    } else if (job[0] === "outline") {
      found.push(["D.A.F. outline", result]);
    } else if (job[0] === "site" || job[0] === "wiki") {
      found.push(...result.map((entry) => [web.label(entry.site), entry]));
    } else {
      found.push(...result);
    }
  }
  return [found, missed, pyround(now() - started, 1)];
}


export async function _site(domain, query) {
  const llm = new LLM();
  return web.search(domain, query, (q, d, opts) => llm.find_pages(q, d, opts));
}


export async function _outline(masechta, daf) {
  const llm = new LLM();
  return web.outline(masechta, daf, (q, d, opts) => llm.find_pages(q, d, opts));
}


/** Whether a job would be answered without going out -- then nothing is announced. */
export async function cached(job) {
  if (["site", "wiki", "outline"].includes(job[0])) {
    return false;
  }
  if (job[0] === "recap") {
    const kept = await store.kv.get("recaps", review._path(job[1]));
    return kept !== null && kept !== undefined;
  }
  if (job[0] === "zmanim") {
    const place = job.length > 2 && (Object.hasOwn(PLACES, job[2]) || job[2] === "Jerusalem") ? job[2] : null;
    return _ZMANIM.has(_zkey(job[1], place));
  }
  if (job[0] === "person") {
    return _PEOPLE.has(_pkey(job[1], job[2], job.length > 3 ? job[3] : null));
  }
  return job[0] === "text" ? _TEXTS.has(job[1]) : _LINKS.has(job[1]);
}


// -- who they were ---------------------------------------------------------------

// "When did he live? Who came first -- was he the Rashba's student?" Sefaria
// keeps this for its authors and for the sages of the Mishnah and Gemara:
// years and places, the generation of a tanna or amora, a short biography, and
// who taught whom. A commentary's index names its author (and often says whose
// student he was); the name search finds a sage who wrote no book. Wikipedia's
// summary is used only when Sefaria has no description at all.
export const _PEOPLE = new Map();
const _pkey = (name, book, page) => JSON.stringify([name ?? null, book ?? null, page ?? null]);
// WIKI_API is config.wiki (CHAVRUTA_WIKI_API), read when it is used.
export const GENERATION = { "T": "tanna (sage of the Mishnah era)", "A": "amora (sage of the Gemara era)",
                            "Z": "zug (one of the pairs before the tannaim)", "P": "prophet", "M": "member of the Great Assembly" };
export const ERA = { "GN": "Geonim", "RI": "Rishonim", "AH": "Acharonim", "CO": "contemporary", "T": "Tannaim", "A": "Amoraim" };


/** 'rabbi-yehudah-b-ilai' -> 'Rabbi Yehudah b Ilai' (for teachers and students). */
export function _human(slug) {
  const words = pysplit(slug.replaceAll("-(", " (").replaceAll("-", " "));
  return words.map((w) => (w === "b" ? "ben" : w.startsWith("(") ? w : w.slice(0, 1).toUpperCase() + w.slice(1))).join(" ");
}


/** Every passage Sefaria ties to a person -- how it tells namesakes apart. */
export async function _pages(slug) {
  const data = (await sefaria.get(fmt("v2/topics/%s", slug), { soft: true, with_refs: 1 })) || {};
  const out = [];
  for (const group of Object.values(data.refs || {})) {
    out.push(...((group || {}).refs || []).map((r) => r.ref || ""));
  }
  return out;
}


/** The one of these people Sefaria ties to this amud, and where, or (None, None). */
export async function on_page(slugs, page) {
  const hits = [];
  for (const slug of slugs) {
    const where = (await _pages(slug)).filter((r) => r === page || r.startsWith(page + ":"));
    if (where.length) {
      hits.push([slug, where[0]]);
    }
  }
  return hits.length === 1 ? hits[0] : [null, null];
}


export async function _topic(slug) {
  const data = (await sefaria.get(fmt("v2/topics/%s", slug), { soft: true, with_links: 1, group_related: 1 })) || {};
  if (!data.slug) {
    return null;
  }
  const props = {};
  for (const [k, v] of Object.entries(data.properties || {})) props[k] = (v || {}).value ?? null;
  // Sefaria keeps empty stubs beside the real records ("rashba" beside
  // "rashba1"): a topic with nothing in it is not an answer.
  if (!truthy(props) && !(data.description || {}).en) {
    return null;
  }
  const lines = [fmt("%s (%s)", (data.primaryTitle || {}).en || slug, (data.primaryTitle || {}).he || "")];
  const [born, died] = [props.birthYear ?? null, props.deathYear ?? null];
  if (truthy(born) || truthy(died)) {
    lines.push(fmt("lived %s–%s%s", truthy(born) ? born : "?", truthy(died) ? died : "?",
                   props.birthPlace ? ", " + props.birthPlace : ""));
  }
  const gen = props.generation ?? null;
  if (truthy(gen) && Object.hasOwn(GENERATION, String(gen).slice(0, 1))) {
    lines.push(fmt("%s, generation %s", GENERATION[String(gen).slice(0, 1)], String(gen).slice(1)));
  }
  if (typeof props.era === "string" && Object.hasOwn(ERA, props.era)) {
    lines.push(fmt("era: %s", ERA[props.era]));
  }
  let about = (data.description || {}).en || props.enBio || null;
  const links = data.links || {};
  const teachers = ((links["learned-from"] || {}).links || []).map((l) => _human(l.topic)).slice(0, 5);
  const students = ((links["taught"] || {}).links || []).map((l) => _human(l.topic)).slice(0, 6);
  if (teachers.length) {
    lines.push("teachers: " + teachers.join(", "));
  }
  if (students.length) {
    lines.push("students: " + students.join(", "));
  }
  if (!about && props.enWikiLink) {
    about = await _wiki(rsplit(props.enWikiLink, "/", 1).slice(-1)[0]);
  }
  if (about) {
    lines.push(sub(re(String.raw`\[([^\]]+)\]\([^)]+\)`), String.raw`\1`, about).replaceAll("*", ""));
    if (truthy(born) || truthy(died) || truthy(gen)) {
      // Sefaria's prose sometimes disagrees with its own dates (the
      // Penei Yehoshua "early 19th century", born 1680).
      lines.push("where this description and the years or generation above disagree, " +
                 "the years and generation are right");
    }
  }
  return lines.join("; ");
}


// What urllib could raise: the network, a status, a bad reply.
function _unreadable(e) {
  return e instanceof HttpError || e instanceof SyntaxError || e instanceof TypeError ||
    e instanceof RangeError || (e && (e.name === "AbortError" || e.name === "TimeoutError" || e.message === "timed out"));
}


export async function _wiki(title) {
  try {
    const data = await getJSON(config.wiki + quote(title), { timeout: 6, headers: { "User-Agent": "chavruta/0.3" } });
    return (data.extract || "").slice(0, 700);
  } catch (e) {
    if (!_unreadable(e)) throw e;
    return "";
  }
}


/** Who someone was, as a citable entry. `book` is the index title of their
 * commentary on this page ("Meiri on Berakhot"), when there is one; `page`
 * is the amud, to tell namesakes apart. */
export async function person(name, { book = null, page = null } = {}) {
  const key = _pkey(name, book, page);
  if (_PEOPLE.has(key)) {
    return _PEOPLE.get(key);
  }
  const parts = [];
  let slugs = [];
  if (book) {
    const index = (await sefaria.get(fmt("v2/index/%s", book), { soft: true })) || {};
    slugs = (index.authors || []).filter((a) => a.slug).map((a) => a.slug);
    const when = (index.compDateString || {}).en;
    if (index.enDesc || when) {
      parts.push(fmt("%s%s: %s", book, when ? " written" + when : "", index.enDesc || ""));
    }
  }
  if (!slugs.length) {
    // "Rabban Gamliel" is three people. Taking the first match answered a
    // question about the Mishnah's Rabban Gamliel of Yavneh with his
    // grandfather the Elder, a generation too early. When Sefaria names one
    // exact match, that is him; otherwise every one of that name goes in,
    // and the partner decides from the page which is meant.
    const found = (await sefaria.get(fmt("name/%s", name), { soft: true, limit: 8 })) || {};
    const people = (found.completion_objects || []).filter((o) => ["AuthorTopic", "PersonTopic"].includes(o.type) && o.key);
    if (found.key && ["AuthorTopic", "PersonTopic"].includes(found.type)) {
      slugs = [found.key];
    } else {
      const same = people.filter((o) => (o.title || "").toLowerCase().startsWith(name.toLowerCase()));
      slugs = (same.length ? same : people).map((o) => o.key).slice(0, 3);
    }
    // Sefaria ties each passage to the person it means: if exactly one of
    // the namesakes is tied to this amud, that is him.
    const [which, where] = page && slugs.length > 1 ? await on_page(slugs, page) : [null, null];
    if (which) {
      slugs = [which];
      parts.push(fmt("Several people are called %s; Sefaria ties this page (%s) to the one below.", name, where));
    } else if (slugs.length > 1) {
      parts.push(fmt("Several people are called %s. Decide from the page which one is meant -- " +
                     "by who he argues with and the era of the text -- say which, and use only his record:", name));
    }
  }
  for (const slug of slugs.slice(0, 3)) {
    const about = await _topic(slug);
    if (about) {
      parts.push(about);
    }
  }
  let entry = null;
  if (parts.length) {
    entry = { "ref": fmt("About %s", name), "he": parts.join("\n"), "dibur": null, "fetched": true };
  }
  _PEOPLE.set(key, entry);
  return entry;
}


// -- the clock: real times for a real night --------------------------------------

// "Give me numbers -- when is the last time, in summer and in winter?" is a
// question about tonight in a real place. Hebcal publishes the zmanim for any
// date and place, free; Jerusalem unless set otherwise.
// ZMANIM_API is config.zmanim (CHAVRUTA_ZMANIM_API), PLACE config.place
// (CHAVRUTA_GEONAMEID), PLACE_NAME config.placeName (CHAVRUTA_PLACE): read when used.
export const _ZMANIM = new Map();
const _zkey = (date, place) => JSON.stringify([date, place ?? null]);
// The night that begins on the evening of the date: its start from that day's
// times, its dawn from the next morning's.
export const EVENING = [["sunset", "sunset (shkiah)"], ["tzeit7083deg", "nightfall, three stars (tzeit, 7.08°)"],
                        ["tzeit85deg", "nightfall, stricter (tzeit, 8.5°)"],
                        ["tzeit72min", "nightfall per Rabbeinu Tam (72 min)"], ["chatzotNight", "midnight (chatzot halayla)"]];
export const MORNING = [["alotHaShachar", "dawn (alot hashachar)"], ["sunrise", "sunrise (netz)"]];


// Where else they might be. "How long till sunset? -- say in Tel Aviv" was
// answered with a sunset the model made up; now the place is looked up like any
// other source. (latitude, longitude, time zone), for Hebcal.
export const IL = "Asia/Jerusalem";
export const PLACES = {
  "Tel Aviv": [32.0853, 34.7818, IL], "Bnei Brak": [32.0807, 34.8338, IL],
  "Haifa": [32.7940, 34.9896, IL], "Beit Shemesh": [31.7470, 34.9881, IL],
  "Modiin": [31.8980, 35.0104, IL], "Petah Tikva": [32.0840, 34.8878, IL],
  "Netanya": [32.3215, 34.8532, IL], "Raanana": [32.1848, 34.8713, IL],
  "Efrat": [31.6537, 35.1500, IL], "Beersheba": [31.2518, 34.7913, IL],
  "Tzfat": [32.9646, 35.4960, IL], "Ashdod": [31.8014, 34.6435, IL],
  "Rehovot": [31.8928, 34.8113, IL], "Herzliya": [32.1624, 34.8447, IL],
  "New York": [40.7128, -74.0060, "America/New_York"], "Brooklyn": [40.6782, -73.9442, "America/New_York"],
  "Lakewood": [40.0821, -74.2097, "America/New_York"], "Teaneck": [40.8976, -74.0160, "America/New_York"],
  "Baltimore": [39.2904, -76.6122, "America/New_York"], "Boston": [42.3601, -71.0589, "America/New_York"],
  "Miami": [25.7617, -80.1918, "America/New_York"], "Chicago": [41.8781, -87.6298, "America/Chicago"],
  "Los Angeles": [34.0522, -118.2437, "America/Los_Angeles"],
  "Toronto": [43.6532, -79.3832, "America/Toronto"], "Montreal": [45.5017, -73.5673, "America/Toronto"],
  "London": [51.5074, -0.1278, "Europe/London"], "Manchester": [53.4808, -2.2426, "Europe/London"],
  "Paris": [48.8566, 2.3522, "Europe/Paris"], "Antwerp": [51.2194, 4.4025, "Europe/Brussels"],
  "Johannesburg": [-26.2041, 28.0473, "Africa/Johannesburg"],
  "Melbourne": [-37.8136, 144.9631, "Australia/Melbourne"], "Sydney": [-33.8688, 151.2093, "Australia/Sydney"],
};
// How people say them.
export const PLACE_NAMES = {
  "jerusalem": "Jerusalem", "ירושלים": "Jerusalem", "tel aviv": "Tel Aviv", "תל אביב": "Tel Aviv",
  "bnei brak": "Bnei Brak", "bnai brak": "Bnei Brak", "בני ברק": "Bnei Brak", "haifa": "Haifa", "חיפה": "Haifa",
  "beit shemesh": "Beit Shemesh", "bet shemesh": "Beit Shemesh", "בית שמש": "Beit Shemesh",
  "modiin": "Modiin", "modi'in": "Modiin", "מודיעין": "Modiin", "petah tikva": "Petah Tikva",
  "petach tikva": "Petah Tikva", "פתח תקווה": "Petah Tikva", "פתח תקוה": "Petah Tikva",
  "netanya": "Netanya", "נתניה": "Netanya", "raanana": "Raanana", "ra'anana": "Raanana", "רעננה": "Raanana",
  "efrat": "Efrat", "אפרת": "Efrat", "beersheba": "Beersheba", "beer sheva": "Beersheba",
  "באר שבע": "Beersheba", "tzfat": "Tzfat", "safed": "Tzfat", "צפת": "Tzfat", "ashdod": "Ashdod",
  "אשדוד": "Ashdod", "rehovot": "Rehovot", "רחובות": "Rehovot", "herzliya": "Herzliya", "הרצליה": "Herzliya",
  "new york": "New York", "ניו יורק": "New York", "brooklyn": "Brooklyn", "ברוקלין": "Brooklyn",
  "lakewood": "Lakewood", "לייקווד": "Lakewood", "teaneck": "Teaneck", "baltimore": "Baltimore",
  "boston": "Boston", "miami": "Miami", "chicago": "Chicago", "los angeles": "Los Angeles", "l.a.": "Los Angeles",
  "toronto": "Toronto", "טורונטו": "Toronto", "montreal": "Montreal", "london": "London", "לונדון": "London",
  "manchester": "Manchester", "paris": "Paris", "פריז": "Paris", "antwerp": "Antwerp", "אנטוורפן": "Antwerp",
  "johannesburg": "Johannesburg", "melbourne": "Melbourne", "sydney": "Sydney",
};
// Hebrew sits its prepositions on the name: בתל אביב, לבני ברק.
export const _PLACE_RE = re(String.raw`(?<![\wא-ת])(?:[ובלמה]{1,2}(?=[א-ת]))?(` +
  sorted(Object.keys(PLACE_NAMES), (k) => k.length, true).map((k) => escape(k)).join("|") +
  String.raw`)(?![\wא-ת])`, "i");


/** The place named in what they said ("say in Tel Aviv"), or None. */
export function place_in(said) {
  const hit = search(_PLACE_RE, said || "");
  return hit ? PLACE_NAMES[hit.group(1).toLowerCase()] : null;
}


export async function _hebcal(date, { place = null } = {}) {
  let where = { "geonameid": place === "Jerusalem" ? "281184" : config.place };
  if (Object.hasOwn(PLACES, place ?? "")) {
    const [lat, lon, tz] = PLACES[place];
    where = { "latitude": lat, "longitude": lon, "tzid": tz };
  }
  const url = fmt("%s?%s", config.zmanim, urlencode({ "cfg": "json", "date": date, ...where }));
  const data = await getJSON(url, { timeout: 8, headers: { "User-Agent": "chavruta/0.3" } });
  return data.times || {};
}


export function _clock(value) {
  // "2026-09-28T18:21:00+03:00" -> "2026-09-28 18:21": the day is kept, since
  // midnight and dawn belong to the next one.
  return value.length >= 16 ? value.slice(0, 10) + " " + value.slice(11, 16) : value;
}


/** The times of the night beginning on the evening of `date` (YYYY-MM-DD),
 * at `place` (a name in PLACES, or Jerusalem) or else the configured PLACE. */
export async function zmanim(date, { place = null } = {}) {
  place = Object.hasOwn(PLACES, place ?? "") || place === "Jerusalem" ? place : null;
  const key = _zkey(date, place);
  if (_ZMANIM.has(key)) {
    return _ZMANIM.get(key);
  }
  let entry = null;
  try {
    const evening = await _hebcal(date, { place });
    if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new RangeError("Invalid isoformat string: " + date);
    const [y, m, d] = date.split("-").map(Number);
    const following = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
    const morning = await _hebcal(following, { place });
    const lines = EVENING.filter(([key_]) => truthy(evening[key_])).map(([key_, label]) => fmt("%s: %s", label, _clock(evening[key_])));
    lines.push(...MORNING.filter(([key_]) => truthy(morning[key_])).map(([key_, label]) => fmt("%s: %s", label, _clock(morning[key_]))));
    if (lines.length) {
      entry = { "ref": fmt("Zmanim for %s, night of %s", place || config.placeName, date),
                "he": lines.join("; ") + ".", "dibur": null, "fetched": true };
    }
  } catch (e) {
    if (!_unreadable(e)) throw e;
    entry = null;
  }
  _ZMANIM.set(key, entry);
  return entry;
}
