// The server's work, in the page (chavruta/server.py, ported).
//
//   GET  /api/masechtot          what can be opened
//   GET  /api/daf?ref=           an amud's pack (built from Sefaria, then kept)
//   POST /api/hear?ref=&line=    audio in; what was said, and whether it was reading
//   POST /api/heard              the same for words the browser already recognised
//   POST /api/say                a turn of conversation (streamed: a "let me pull
//                                that up" line first when it goes to Sefaria)
//   GET  /api/text?ref=          any text on Sefaria, for the sources panel
//   POST /api/speak              a reply as audio, never the gemara
//   POST /api/voice              the same, prepared: an address an <audio> can play
//                                while the rest is still being made
//   GET  /api/health             what works, and what to fix if it does not
//
// The page asks these exactly as it asked the Python server; `handle(path,
// init)` answers with a Response, streamed where the server streamed. What
// the server kept in files is in store.kv (this device) and store.log (the
// Worker's database, every device).

import { re, search, sub, split, findall, pysplit, rsplit, strip, truthy, deepcopy, now, fmt } from "./py.js";
import { config } from "./net.js";
import * as store from "./store.js";
import * as align from "./align.js";
import * as commentators from "./commentators.js";
import { MASECHTOT } from "./commentators.js";
import * as daily from "./daily.js";
import * as library from "./library.js";
import * as notes from "./notes.js";
import * as retrieve from "./retrieve.js";
import * as review from "./review.js";
import * as sefaria from "./sefaria.js";
import * as smalltalk from "./smalltalk.js";
import { LLM, VOICE_DIRECTION, ModelError, speakable } from "./llm.js";
import { Index, build_index as buildIndexOf } from "./masechta_index.js";
import { Pack } from "./pack.js";
import { READ_TO_ME, Partner, offer_choice, unit_nudge } from "./partner.js";

export const SPOKEN = [];   // the words of what it said last, to know its own voice when it hears it
export const ECHO = 0.6;    // this much of what was "heard" being its own last words means it heard itself

// The voices offered in settings (chosen by the learner from OpenAI's set):
// Cedar, the default, and Verse. Anything else falls back to the default.
export const VOICE_NAMES = ["cedar", "verse"];

/** Words of either language, reduced so a transcript and a script compare. */
export function word_list(text) {
  const plain = sub(align.NIKUD, "", text.toLowerCase()).replace(/[ךםןףץ]/g, (c) => ({ "ך": "כ", "ם": "מ", "ן": "נ", "ף": "פ", "ץ": "צ" })[c]);
  return findall(String.raw`[a-z]+|[א-ת]+`, plain).filter((w) => w.length > 1);
}

/** Whether what was heard is the partner's own voice, picked up by the mic.
 *
 * With speakers instead of earbuds the microphone hears the answer, and in
 * use it transcribed its own answer as the learner's turn and argued with
 * it ("Not 'Ruma'"). English words count as well as Hebrew here. */
export function echo_of_itself(said) {
  const mine = word_list(said);
  if (mine.length < 3) return false;
  for (const spoken of SPOKEN)
    if (spoken && spoken.size && mine.filter((w) => spoken.has(w)).length >= ECHO * mine.length) return true;
  return false;
}

/** One row per turn in the sitting's record -- the whole story of a sitting,
 * so it can be read back afterwards and the partner improved from real use.
 * Never waited for: the record must not slow a turn. */
export function record(kind, fields = {}) {
  store.log.add(kind, fields).catch((exc) => console.info("could not record turn:", exc));
}

const SESSIONS = new Map();
const BUILDING = new Map();
const PAGES = new Map();   // ref -> align.Page, which is worth keeping between turns
const INDEXES = new Map();

/** The whole-tractate index, if preparing the tractate has built it. */
export async function index_for(masechta) {
  if (!INDEXES.get(masechta)) INDEXES.set(masechta, await Index.load(masechta));
  return INDEXES.get(masechta);
}

// -- packs ---------------------------------------------------------------------

/** A real amud of a tractate we can open (commentators.MASECHTOT). */
export function allowed(ref) {
  ref = ref || "";
  return MASECHTOT.some((m) => ref.startsWith(m["name"] + " ")) &&
    new Set(sefaria.amudim(rsplit(ref, " ", 1)[0])).has(ref);
}

const fixtureName = (ref) => ref.toLowerCase().replace(/ /g, "_").replace(/:/g, "_") + ".json";

/** The packs that ship with the app (Berakhot 2a, 2b): only for when Sefaria cannot be reached. */
async function shipped(ref) {
  try {
    const r = await config.fetch("packs/" + fixtureName(ref));
    return r.ok ? new Pack(await r.json()) : null;
  } catch (e) { return null; }
}

/** Kept on this device if we have the real thing; from Sefaria if we do not.
 *
 * A fixture never satisfies a request: it only comes back when Sefaria
 * genuinely cannot be reached, and says so on screen. */
export async function load_pack(ref, { rebuild = false } = {}) {
  let stale = null;
  const kept = rebuild ? null : await Pack.load(ref);
  if (kept) {
    const current = (kept.data["pack_version"] || 0) >= sefaria.PACK_VERSION;
    if (current && !kept.is_fixture) return kept;
    stale = kept;  // served only if Sefaria cannot be reached
  }
  if (BUILDING.has(ref) && !rebuild) return BUILDING.get(ref);   // someone else is building it: wait for theirs
  const work = (async () => {
    let data;
    try {
      data = await sefaria.build(ref);
    } catch (exc) {
      if (exc instanceof sefaria.SefariaError) {
        if (stale !== null) return stale;
        const fixture = await shipped(ref);
        if (fixture) return fixture;
      }
      throw exc;
    }
    await store.kv.set("packs", ref, data);
    PAGES.delete(ref);
    return new Pack(data);
  })();
  BUILDING.set(ref, work);
  try { return await work; } finally { BUILDING.delete(ref); }
}

/** Whether this amud is built and kept here (turning must never wait on the network). */
export async function have_pack(ref) {
  return !!(await store.kv.get("packs", ref));
}

/** Build the neighbours quietly, so the next turn of the page is instant. */
export function prefetch(...refs) {
  (async () => {
    for (const ref of refs) {
      if (ref && allowed(ref) && !(await have_pack(ref))) {
        try { await load_pack(ref); } catch (exc) { console.info("prefetch", ref, exc && exc.message); }
      }
    }
  })();
}

export function page_of(pack) {
  if (!PAGES.has(pack.ref)) PAGES.set(pack.ref, new align.Page(pack.data));
  return PAGES.get(pack.ref);
}

export function session(sid) {
  const key = sid || "default";
  if (!SESSIONS.has(key))
    SESSIONS.set(key, { "history": [], "ref": null, "line": 1, "nudged": new Set(), "language": "auto",
      "recent": [], "spoke": null, "memory": {} });
  return SESSIONS.get(key);
}

export const PROGRESS = re(String.raw`\bhow much (have i|did i|i've) (learn(ed)?|done|covered|finished)\b|\bmy progress\b|` +
  String.raw`\bhow am i doing\b|\bmy streak\b|כמה למדתי|ההתקדמות שלי|כמה ימים ברצף|איך אני מתקדם`, "i");

/** Progress in a sentence or two. */
export function progress_text(p, lang) {
  const he = lang === "he";
  const parts = [];
  if (p["streak"])
    parts.push(he ? fmt("%d ימים ברצף שאתה לומד.", p["streak"]) :
      fmt("%d day%s in a row.", p["streak"], p["streak"] === 1 ? "" : "s"));
  for (const t of p["tractates"].slice(0, 3))
    parts.push(he ? fmt("ב%s: %d מתוך %d עמודים.", t["he"], t["done"], t["total"]) :
      fmt("%s: %d of %d amudim.", t["name"], t["done"], t["total"]));
  const dy = p["daf_yomi"];
  if (dy["ref"])
    parts.push(he ? fmt("הדף היומי (%s): %s.", dy["he"], dy["done"] ? "למדת ✓" : "עוד לא") :
      fmt("Today's daf, %s: %s.", dy["ref"], dy["done"] ? "done" : "not yet"));
  return parts.join(" ") || (he ? "עוד לא למדנו יחד." : "We haven't learned together yet.");
}

// "Put the Rashba on the side", "תפתח את המאירי בצד": the reading desk, by voice.
// Only with a word for where -- "open the Rashba" alone is a question about him.
export const DESK_OPEN = re(
  String.raw`^\W*(?:(?:can you|could you|please|and)\s+)*(?:open|put|add|bring|pin|show)(?: up)?(?: me)? (?P<en>.+?)` +
  String.raw` (?:on|to|onto|in|at|next to|beside|alongside|by)(?: the| my)? (?:screen|side|desk|table)\W*$|` +
  String.raw`^\W*(?:תפתח|פתח|תשים|שים|תוסיף|הוסף|תעלה|תביא|תצמיד)(?: לי)? (?P<he>.+?)` +
  String.raw` (?:על |ב|ל)?ה?(?:מסך|צד|שולחן)\W*$`, "i");
export const DESK_CLOSE = re(String.raw`\b(close|hide|clear)( the| my)? (desk|side screen|screen on the side|side)\b|` +
  String.raw`(סגור|תסגור|תנקה|נקה|תוריד) את (השולחן|המסך בצד|הצד)`, "i");

/** The commentators on this page named in `words` ("the Rashba and the Meiri"). */
export function desk_who(words, pack) {
  const present = pack.commentators();
  const table = {};
  for (const name of present) {
    table[retrieve._key(name)] = name;
    const he = (commentators.WHO[name] || {})["he"];
    if (he) table[retrieve._key(he)] = name;
  }
  for (const [alias, target] of Object.entries(retrieve.ALIASES)) {
    const found = commentators.filed(target, present);
    if (truthy(found) && !(retrieve._key(alias) in table)) table[retrieve._key(alias)] = found[0];
  }
  const out = [];
  for (let piece of split(String.raw`,|\band\b|\s+ו(?=את\b|ה|[א-ת])|\s+גם\s+`, words)) {
    piece = sub(re(String.raw`^\s*(the|את|also)\s+`, "i"), "", strip(piece));
    const key = retrieve._key(piece);
    for (const k of [key, "הול".includes(key.slice(0, 1)) && key ? key.slice(1) : null]) {
      if (k && k in table) {
        if (!out.includes(table[k])) out.push(table[k]);
        break;
      }
    }
  }
  return out;
}

/** {"mode": "desk", ...} for "put the Meiri on the side", or null. */
export function desk_command(said, pack, lang) {
  const he = lang === "he" || (lang === "auto" && search(String.raw`[א-ת]`, said));
  if (search(DESK_CLOSE, said))
    return { "mode": "desk", "close": true, "text": he ? "סגרתי את השולחן." : "Closed the desk." };
  const m = search(DESK_OPEN, said);
  if (!m) return null;
  const names = desk_who(m.group("en") || m.group("he") || "", pack);
  if (!names.length) return null;
  const bare = ["Rashi", "Tosafot", "Steinsaltz"];
  let spoken;
  if (he) {
    const said_names = names.map((n) => (bare.includes(n) || n.startsWith("Rabbeinu") ? "" : "ה") +
      ((commentators.WHO[n] || {})["he"] || n));
    spoken = said_names.length <= 2 ? said_names.join(" ו") : said_names.join(", ");
  } else {
    spoken = names.map((n) => (bare.includes(n) ? "" : "the ") + n).join(" and ");
  }
  return { "mode": "desk", "add": names,
    "text": he ? fmt("פתחתי את %s בצד.", spoken) : fmt("Opened %s on the side.", spoken) };
}

/** [next amud, its reading] when they have read on from the last lines of
 * this amud into the next -- or null. Only a page already built is checked:
 * turning must never wait on the network. */
export async function onto_next_page(pack, said, heard, line) {
  if (line < pack.segments.length - 2 && (heard["line"] || 0) < pack.segments.length - 2) return null;
  const ran_over = heard["mode"] === "reading" && truthy((heard["slips"] || {})["after"]);
  if (heard["mode"] === "reading" && !ran_over) return null;
  const nxt = pack.data["next"];
  if (!nxt || !allowed(nxt) || !(await have_pack(nxt))) return null;
  const there = align.listen(page_of(await load_pack(nxt)), said);
  if (there["line"] && there["line"] <= 3 && (there["matched"] || 0) >= 3 &&
      (there["mode"] === "reading" || (ran_over && there["mode"] === "quoting"))) {
    const out = Object.assign({}, there, { mode: "reading" });
    delete out["slips"];
    return [nxt, out];
  }
  return null;
}

function fresh_page(state, ref) {
  if (state["ref"] !== ref) {
    // The page they are leaving gets its recap, quietly, so "did we learn
    // this?" can be answered from every page they studied.
    if (state["ref"]) Promise.resolve(review.recap_quietly(state["ref"])).catch(() => {});
    // The place they named stays; what was fetched for the last page goes.
    const memory = { "place": (state["memory"] || {})["place"] ?? null };
    Object.assign(state, { history: [], ref, nudged: new Set(), recent: [], spoke: null, memory });
  }
}

/** Whether a reading differed from the page in a way a chavruta would ask about.
 *
 * A swapped word, always. Words that are not on the page, when there are
 * enough of them to be something they said. Never a skipped word on its own:
 * in use "you skipped «אתם»" was the recogniser dropping it, and said as a
 * fact it is exactly the correction the learner asked never to get. */
export function worth_asking(heard) {
  const slips = heard["slips"] || {};
  if (truthy(slips["swapped"]) || truthy(slips["after"])) return true;
  return (slips["added"] || []).length >= 2;
}

/** The words they are about to read, to prime the recogniser. */
export function hint_for(pack, line) {
  const lines = pack.segments.filter((s) => line - 1 <= s["n"] && s["n"] <= line + 3).map((s) => s["he_plain"]);
  return lines.join(" ").slice(0, 600);
}

export const KEYWORDS = ["גמרא", "משנה", "סוגיא", "מחלוקת", "רש\"י", "תוספות", "הרמב\"ם", "רשב\"א",
  "ריטב\"א", "רי\"ף", "מאירי", "Rashi", "Tosafot", "gemara", "sugya",
  "machlokes", "mishna", "tanna", "amora", "halacha"];

// -- the head start ----------------------------------------------------------------

export class Cancelled extends Error {}

/** An answer begun on a guessed route while the router decides.
 *
 * It runs on its own partner and its own copy of the sitting's memory, and
 * holds every sentence it writes until it is told the guess stood
 * (relay), or is dropped (cancel) -- then whatever it wrote is never seen
 * and the real answer starts at once, so a wrong guess costs tokens, never
 * time. In use the router took one to two and a half seconds before a word
 * of the answer was begun. */
export class HeadStart {
  constructor(partner, line, state, said, heard, recent, route, cut) {
    this.out = [];
    this.waiting = null;
    this.cancelled = false;
    if (!state["memory"]) state["memory"] = {};
    this.memory = deepcopy(state["memory"]);
    this.n = line;
    this.args = { history: [...state["history"]], said, heard, route, recent, spoke: state["spoke"] ?? null,
      memory: this.memory, cut: cut && route["cut_in"] ? Object.assign({}, cut, { kind: route["cut_in"] }) : null };
    this.partner = partner;
  }
  put(item) {
    this.out.push(item);
    if (this.waiting) { const w = this.waiting; this.waiting = null; w(); }
  }
  start() {
    const part = (text) => {
      if (this.cancelled) throw new Cancelled();
      this.put(["part", text]);
    };
    const { history, said, ...rest } = this.args;
    Promise.resolve().then(() => this.partner.ask(this.n, history, said, Object.assign({}, rest, { on_part: part })))
      .then((value) => this.put(["done", value]))
      .catch((exc) => { if (!(exc instanceof Cancelled)) this.put(["error", exc]); });
    return this;
  }
  cancel() { this.cancelled = true; }
  async relay(emit) {
    for (;;) {
      while (!this.out.length) await new Promise((ok) => { this.waiting = ok; });
      const [kind, value] = this.out.shift();
      if (kind === "part") emit(value);
      else if (kind === "done") return value;
      else throw value;
    }
  }
}

// -- answering -------------------------------------------------------------------

const json = (payload, status = 200) => new Response(JSON.stringify(payload), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** A short message for the screen; the whole story to the console, and a
 * line to the sitting's record, so a failure shows in the export. */
function fail(path, status, message, exc = null) {
  if (exc !== null) {
    console.error(path, exc);
    record("error", { path: path.split("?")[0], status, error: String((exc && exc.message) || exc).slice(0, 400) });
  }
  return json({ "error": message }, status);
}

async function body_json(init) {
  try {
    const b = init && init.body;
    return typeof b === "string" ? JSON.parse(b || "{}") : {};
  } catch (e) { return {}; }
}

/** Answer a request the page made of /api/...: a Response, as the server gave. */
export async function handle(input, init = {}) {
  const url = new URL(input, "http://page");
  const method = (init.method || "GET").toUpperCase();
  const q = url.searchParams;
  const arg = (k, d = "") => strip(q.get(k) ?? d);
  try {
    if (method === "GET") return await get(url, arg);
    return await post(url, init, q);
  } catch (exc) {
    if (exc instanceof ModelError) return fail(url.pathname, 502, "model: " + exc.message, exc);
    if (exc instanceof sefaria.SefariaError) return fail(url.pathname, 502, "sefaria_unreachable", exc);
    return fail(url.pathname, 500, "internal", exc);
  }
}

async function get(url, arg) {
  const path = url.pathname;
  if (path === "/api/health") return json(await health());
  if (path === "/api/text") {
    const ref = arg("ref");
    if (!ref || ref.length > 200) return fail(path, 400, "need_ref");
    const entry = await library.text(ref);
    if (!entry) return fail(path, 404, "not_on_sefaria");
    return json(entry);
  }
  if (path === "/api/masechtot") return json({ "masechtot": MASECHTOT });
  if (path === "/api/table") return json({ "table": commentators.table() });
  if (path === "/api/progress") {
    const mine = arg("mine").split(",").filter(Boolean);
    return json(await daily.progress(await review.sittings({ days: 400 }), store.today(), { mine }));
  }
  if (path === "/api/notes") return json({ "notes": await notes.on({ ref: arg("ref") }) });
  // What was learned, sitting by sitting -- for "last time you were on ...".
  if (path === "/api/history") return json({ "sittings": (await review.sittings()).slice(0, 10) });
  if (path === "/api/today") {
    const found = await daily.daf_yomi();
    return found ? json(found) : fail(path, 502, "no_daf_yomi");
  }
  if (path === "/api/prepare") return json(await PREPARER.status(arg("masechta")));
  if (path === "/api/daf") {
    const ref = arg("ref");
    if (!allowed(ref)) return fail(path, 400, "not_available");
    let pack;
    try {
      pack = await load_pack(ref, { rebuild: !!arg("rebuild") });
    } catch (exc) {
      if (exc instanceof sefaria.SefariaError) return fail(path, 502, "sefaria_unreachable", exc);
      return fail(path, 500, "pack_failed", exc);
    }
    prefetch(pack.data["next"], pack.data["prev"]);
    return json(pack.data);
  }
  return fail(path, 404, "not_found");
}

async function post(url, init, q) {
  const route = url.pathname;
  if (route === "/api/hear") return hear(init, q);
  if (route === "/api/heard") return heard(await body_json(init));
  if (route === "/api/transcribe") return transcribe(init, q);
  if (route === "/api/say") return say(await body_json(init), init.signal);
  if (route === "/api/speak") return speak(await body_json(init));
  if (route === "/api/forget") return forget(await body_json(init));
  if (route === "/api/voice") return prepare_voice(await body_json(init));
  if (route === "/api/prepare") {
    const masechta = strip((await body_json(init))["masechta"] || "");
    if (!(await PREPARER.start(masechta))) return fail(route, 400, "no_such_masechta");
    return json(await PREPARER.status(masechta));
  }
  return fail(route, 404, "not_found");
}

const UNREADABLE = re(String.raw`corrupt|unsupported|too short|invalid_value`, "i");
const mimeOf = (init) => {
  const h = init.headers || {};
  return (h instanceof Headers ? h.get("Content-Type") : h["Content-Type"] || h["content-type"]) || "audio/webm";
};

/** Audio in. What was said, and whether it was reading or talking.
 *
 * Reading gets followed silently -- the highlight moves and nothing is
 * said -- except once per line, when the reader reaches the hinge of a
 * machlokes. Talking is handed back so the client can show the words
 * at once and then ask for an answer. */
async function hear(init, q) {
  const ref = q.get("ref") || "";
  const line = parseInt(q.get("line") || "1", 10) || 1;
  const sid = q.get("session") || "";
  const language = q.get("language") || "auto";
  const audio = init.body;
  if (!audio || !audio.size || !allowed(ref)) return fail("/api/hear", 400, "no_audio");
  const mime = mimeOf(init);
  const pack = await load_pack(ref);
  let said;
  try {
    said = await new LLM().hear(audio, { hint: hint_for(pack, line), keywords: KEYWORDS, mime });
  } catch (exc) {
    // A scrap of sound too short or broken to decode is nothing said,
    // not a failure to put in front of the learner.
    if (exc instanceof ModelError && search(UNREADABLE, String(exc.message))) {
      console.info("hear: dropped unreadable audio", audio.size, String(exc.message).slice(0, 120));
      return json({ "said": "", "mode": "silence" });
    }
    throw exc;
  }
  const checks = (q.get("checks") || "1") !== "0";
  const overlap = (q.get("overlap") || "0") === "1";
  return after_hearing(pack, ref, line, sid, language, said, checks, overlap);
}

/** One piece of a sentence still being spoken, to words -- nothing else.
 * The page sends each piece as the speaker pauses, so by the time they
 * stop only the last piece is left to hear. */
async function transcribe(init, q) {
  const ref = q.get("ref") || "";
  const line = parseInt(q.get("line") || "1", 10) || 1;
  const audio = init.body;
  if (!audio || !audio.size || !allowed(ref)) return fail("/api/transcribe", 400, "no_audio");
  const started = now();
  let said;
  try {
    said = await new LLM().hear(audio, { hint: hint_for(await load_pack(ref), line), keywords: KEYWORDS, mime: mimeOf(init) });
  } catch (exc) {
    if (exc instanceof ModelError && search(UNREADABLE, String(exc.message))) return json({ "said": "" });
    throw exc;
  }
  return json({ "said": said, "ms": Math.trunc((now() - started) * 1000) });
}

/** The same, for words already turned to text -- by the browser, typed,
 * or heard piece by piece as they were spoken. */
async function heard(body) {
  const ref = strip(body["ref"] || "");
  if (!allowed(ref)) return fail("/api/heard", 400, "not_available");
  return after_hearing(await load_pack(ref), ref, parseInt(body["line"] || 1, 10) || 1,
    body["session"], body["language"] || "auto", strip(body["said"] || ""), body["checks"] !== false,
    !!body["overlap"]);
}

async function after_hearing(pack, ref, line, sid, language, said, checks = true, overlap = false) {
  if (!said) return json({ "said": "", "mode": "silence" });
  // Only what was picked up while it was talking can be its own voice;
  // anything else that sounds like its last answer is the learner
  // repeating it, which is theirs to do.
  if (overlap && echo_of_itself(said)) {
    record("echo", { session: sid, ref, said });
    return json({ "said": said, "mode": "echo" });
  }
  let heard = align.listen(page_of(pack), said);
  const state = session(sid);
  // Read on past the last line: the next amud, turned to without a word.
  const onward = await onto_next_page(pack, said, heard, Math.max(line || 0, state["line"] || 0));
  let turned = null;
  if (onward) {
    [turned, heard] = onward;
    ref = turned;
    pack = await load_pack(turned);
  }
  record("heard", { session: sid, ref, line, said, heard });
  fresh_page(state, ref);
  if (heard["line"]) state["line"] = heard["line"];
  state["heard"] = heard;
  const reply = { "said": said, "mode": heard["mode"], "heard": heard, "line": state["line"] || line };
  if (turned) reply["turn"] = turned;

  // "Note: ..." / "save this" / "what did I note?" -- the learner's own notes.
  if (heard["mode"] === "talking") {
    const lang = ["he", "en"].includes(language) ? language : ((heard["hebrew"] || 0) > 0.5 ? "he" : "en");
    const wanted = notes.taken(said);
    if (wanted !== null && wanted !== undefined) {
      const last = [...state["history"]].reverse().find((m) => m["role"] === "assistant");
      const text = wanted || sub(String.raw`\s*\[\[[^\]]+\]\]`, "", last ? last["content"] : "") || said;
      const entry = await notes.add(ref, state["line"] || line, text, { kind: wanted ? "note" : "answer" });
      reply["note"] = entry;
      reply["quick"] = fmt(lang === "he" ? "רשמתי, בשורה %d." : "Noted, on line %d.", entry["line"]);
      record("answer", { session: sid, ref, line, said, text: reply["quick"], grounded: true,
        trace: { "kind": "note", "quick": true, "seconds": 0 } });
      return json(reply);
    }
    if (search(PROGRESS, said) && pysplit(said).length <= 14) {
      reply["quick"] = progress_text(await daily.progress(await review.sittings({ days: 400 }), store.today(),
        { mine: [pack.data["masechta"] || ""] }), lang);
      record("answer", { session: sid, ref, line, said, text: reply["quick"], grounded: true,
        trace: { "kind": "progress", "quick": true, "seconds": 0 } });
      return json(reply);
    }
    if (search(notes.ASK, said) && pysplit(said).length <= 14) {
      const masechta = pack.data["masechta"] || "";
      let rows;
      if (search(notes.WIDE, said)) rows = await notes.on({ masechta });
      else {
        rows = await notes.on({ ref });
        if (!rows.length) rows = await notes.on({ masechta });
      }
      reply["quick"] = notes.spoken(rows, { language: lang, here: ref });
      record("answer", { session: sid, ref, line, said, text: reply["quick"], grounded: true,
        trace: { "kind": "notes", "quick": true, "seconds": 0 } });
      return json(reply);
    }
  }

  // "Hey", "can you hear me?", "go ahead": answered from the words alone,
  // with no model, before anything else happens.
  const lastSaid = state["spoke"] || (([...state["history"]].reverse().find((m) => m["role"] === "assistant") || {})["content"] || "");
  const asked = lastSaid.trimEnd().endsWith("?");
  let quick = heard["mode"] === "talking" ? smalltalk.reply(said, { language, asked }) : null;
  if (offer_choice((state["memory"] || {})["offered"], said)) quick = null;   // "let's read it" after "read it together, or the gist?"
  if (quick && quick[0] === "filler") {
    // "Um", "okay": heard, shown, and let be.
    record("heard_filler", { session: sid, ref, said });
    reply["ignore"] = true;
    return json(reply);
  }
  if (quick && quick[0] === "skip") {
    reply["skip"] = true;
    return json(reply);
  }
  if (quick && ["faster", "slower"].includes(quick[0])) {
    // Speaking speed is the page's to change; it answers in a word.
    record("answer", { session: sid, ref, line, said, text: "(speed " + quick[0] + ")", grounded: true,
      trace: { "kind": "small talk: " + quick[0], "quick": true, "seconds": 0 } });
    reply["rate"] = quick[0] === "faster" ? 1 : -1;
    return json(reply);
  }
  if (quick && quick[0] === "again") {
    // "What?" -- the page says its last answer again.
    record("answer", { session: sid, ref, line, said, text: "(said again)", grounded: true,
      trace: { "kind": "small talk: again", "quick": true, "seconds": 0 } });
    reply["again"] = true;
    return json(reply);
  }
  if (quick) {
    const [kind, text] = quick;
    state["history"] = [...state["history"], { "role": "user", "content": said },
      { "role": "assistant", "content": text }].slice(-24);
    record("answer", { session: sid, ref, line, said, text, grounded: true,
      trace: { "kind": "small talk: " + kind, "quick": true, "seconds": 0 } });
    reply["quick"] = text;
    return json(reply);
  }

  if (heard["mode"] === "reading") {
    // Followed silently -- and remembered, so "did I read that right?"
    // is answered from what was actually heard.
    state["recent"] = [...state["recent"], { "said": said, "heard": heard }].slice(-4);
    if (checks && worth_asking(heard)) {
      // A different word, not a different accent: the partner asks.
      reply["respond"] = true;
      return json(reply);
    }
    const lang = ["he", "en"].includes(language) ? language : ((heard["hebrew"] || 0) > 0.5 ? "he" : "en");
    const found = unit_nudge(pack, heard, lang, state["nudged"]);
    if (found) {
      const [text, nudge_ref, n] = found;
      state["nudged"].add(ref + "|" + n);
      state["spoke"] = text;
      reply["nudge"] = text; reply["nudge_ref"] = nudge_ref;
    } else if (heard["line"] === pack.segments.length && !state["nudged"].has(ref + "|end")) {
      // The end of the amud: a few questions on it, if they want.
      const text = review.QUIZ_OPENING[lang];
      state["nudged"].add(ref + "|end");
      state["spoke"] = text;
      reply["nudge"] = text; reply["nudge_ref"] = null;
    }
  }
  return json(reply);
}

function partner_for(body, pack, llm, index) {
  const favor = body["favor"] && typeof body["favor"] === "object" && !Array.isArray(body["favor"]) ? body["favor"] : {};
  return new Partner(pack, llm, {
    depth: body["depth"] || "daf", language: body["language"] || "en", index, favor,
    voices: body["voices"] ?? null, sites: Array.isArray(body["sites"]) ? body["sites"] : null,
    sites_halacha: body["sites_halacha"] ?? true });
}

async function say(body, signal) {
  const ref = strip(body["ref"] || ""), said = strip(body["said"] || "");
  if (!allowed(ref) || !said) return fail("/api/say", 400, "need_ref_and_words");
  const state = session(body["session"]);
  if (!state["discarded"]) state["discarded"] = new Set();
  state["discarded"].delete(said);      // asked again: it counts again
  fresh_page(state, ref);
  const line = parseInt(body["line"] || state["line"] || 1, 10) || 1;
  state["line"] = line;
  const pack = await load_pack(ref);
  const llm = new LLM();
  const index = await index_for(pack.data["masechta"] || "");
  let heard = body["heard"] || state["heard"] || null;
  let head = null, router_ms = null;

  const desk = body["about_reading"] ? null : desk_command(said, pack, body["language"] || "en");
  if (desk) {
    record("answer", { session: body["session"], ref, line, said, text: desk["text"], grounded: true,
      trace: { "kind": "desk", "quick": true, "seconds": 0 } });
    return json(desk);
  }
  // A question about one word, not about where they stopped: the
  // next utterance usually carries on the same sentence.
  if (body["about_reading"] && heard) heard = Object.assign({}, heard, { stopped_mid_clause: false });
  let route, recent;
  if (body["about_reading"]) {
    // They were reading and a word came out different: nothing to route.
    route = { "kind": "check_reading", "claim": false, "names": [], "navigate": null,
      "language": ((heard || {})["hebrew"] || 0) > 0.5 ? "he" : null, "reply": null };
    recent = state["recent"].slice(0, -1);  // the last one is this reading itself
  } else if (smalltalk.acknowledges(said) || offer_choice((state["memory"] || {})["offered"], said)) {
    // "Okay" / "yes" to something it offered: a request to go on, and
    // the router, which sees only these words, would call it a ping.
    route = { "kind": "other", "claim": false, "names": [], "navigate": null, "language": null, "reply": null };
    recent = state["recent"];
  } else {
    // Spoken over an answer still being said: the router also says
    // what these words are to that answer (an aside, a correction, a
    // new question, or something for later).
    const cut = body["cut_in"] && typeof body["cut_in"] === "object" ? body["cut_in"] : null;
    recent = state["recent"];
    // A head start: for a plain question about the page, the answer
    // begins on a guess while the router decides (see HeadStart).
    const guessed = body["stream"] ? await retrieve.guess(said, pack, line, { cut }) : null;
    if (guessed)
      head = new HeadStart(partner_for(body, pack, llm, index), line, state, said, heard, recent, guessed, cut).start();
    const t_route = now();
    route = await retrieve.classify(llm, said, { cut });
    router_ms = Math.trunc((now() - t_route) * 1000);
    if (head && !retrieve.agrees(route, guessed, { auto_language: (body["language"] || "en") === "auto" })) {
      head.cancel();
      head = null;
    }
  }
  if (head && (route["cut_in"] === "later" || ["navigate", "settings"].includes(route["kind"]))) {
    head.cancel();
    head = null;
  }
  if (route["cut_in"] === "later") {
    // "Let's come back to that": kept on the page, and on it goes.
    const lang = ["he", "en"].includes(body["language"]) ? body["language"] : route["language"] || "en";
    const text = lang === "he" ? "בסדר, שמרתי את זה לאחר כך." : "Sure — I'll keep that for later.";
    record("answer", { session: body["session"], ref, line, said, text, grounded: true,
      trace: { "kind": "later", "quick": true, "seconds": 0 } });
    return json({ "mode": "later", "keep": said, "text": text });
  }
  const nav = route["navigate"];
  if (route["kind"] === "navigate" && nav) {
    let target;
    if (nav["daf_yomi"]) target = (((await daily.daf_yomi()) || {})["amudim"] || [null])[0];
    else {
      const masechta = nav["masechta"] || pack.data["masechta"] || "Berakhot";
      target = masechta + " " + nav["daf"] + nav["amud"];
    }
    if (target && allowed(target)) {
      record("navigate", { session: body["session"], ref, said, to: target });
      return json({ "mode": "navigate", "ref": target });
    }
  }

  // "Talk faster", "answer in Hebrew", "leave out the Meiri": the page
  // changes its own settings. Turning the voice off is asked first.
  if (route["kind"] === "settings" && truthy(route["settings"])) {
    const changes = route["settings"];
    const confirm = changes.some((c) => c["name"] === "speak" && c["value"] === false);
    record("answer", { session: body["session"], ref, line, said, text: "(settings)", grounded: true,
      trace: { "kind": "settings", "changes": changes, "quick": true, "seconds": 0 } });
    return json({ "mode": "settings", "changes": changes, "confirm": confirm, "language": route["language"] ?? null });
  }

  // Streamed as lines of JSON when the page can take it: a first line
  // to say while Sefaria is asked ("let me pull up the Tur"), then the
  // answer. Silence while fetching sounded like a partner who gave up.
  const stream = !!body["stream"];
  const run = async (emit) => {
    const interim = [];
    const announce = (text) => {
      interim.push(text);
      if (stream) {
        emit({ "mode": "stage", "stage": "sources" });
        emit({ "mode": "interim", "text": text });
      }
    };
    const partner = partner_for(body, pack, llm, index);
    // "Can you read it for me?" -- the page's words may be spoken in full.
    const read_out = !!search(READ_TO_ME, said) || offer_choice((state["memory"] || {})["offered"], said) === "read";
    if (read_out && stream) {
      // Reading a comment together: it opens on the desk, to be read along.
      const offered = (state["memory"] || {})["offered"] || [];
      emit({ "mode": "read", "desk": offered.map(([name, e]) => ({ "name": name, "ref": e["ref"] })) });
    }
    if (route["cut_in"] && stream) emit({ "mode": "cut_in", "kind": route["cut_in"] });
    const started = now();
    if (stream) emit({ "mode": "stage", "stage": "writing" });
    let text, verdict, history, trace;
    if (head) {
      // The router agreed with the guess: the answer already under way is this answer.
      [text, verdict, history, trace] = await head.relay((t) => emit({ "mode": "part", "text": t }));
      state["memory"] = head.memory;
    } else {
      if (!state["memory"]) state["memory"] = {};
      [text, verdict, history, trace] = await partner.ask(line, state["history"], said, {
        heard, route, recent, spoke: state["spoke"] ?? null, announce,
        // Each sentence as it is written, to be spoken while the rest is.
        on_part: stream ? (t) => emit({ "mode": "part", "text": t }) : null,
        memory: state["memory"],
        cut: route["cut_in"] ? Object.assign({}, body["cut_in"], { kind: route["cut_in"] }) : null });
    }
    // Taken back while it was being answered: the conversation goes on
    // as if it had not been said.
    if (!state["discarded"].has(said)) state["history"] = history;
    trace["seconds"] = Math.round((now() - started) * 10) / 10;
    trace["router_ms"] = router_ms;
    trace["head_start"] = !!head;
    if (route["cut_in"]) trace["cut_in"] = route["cut_in"];      // what their words were to the answer they cut into
    trace["interim"] = interim.length ? interim[0] : null;
    record("answer", { session: body["session"], ref, line, said, depth: body["depth"], language: body["language"],
      text, grounded: verdict.ok, trace, models: [llm.heavy, llm.cheap] });
    Object.assign(state, { heard: null, recent: [], spoke: null });
    return { "mode": "answer", "text": text, "grounded": verdict.ok, "read": read_out,
      "problem": verdict.ok ? null : verdict.complaint(), "trace": trace };
  };

  if (!stream) return json(await run(() => {}));
  const enc = new TextEncoder();
  let gone = false;
  const body_ = new ReadableStream({
    async start(controller) {
      // The page stopped waiting (it asked again, together with what was
      // said next): writing on raises, as a closed connection did, and the
      // answer stops being written.
      const emit = (payload) => {
        if (gone || (signal && signal.aborted)) { gone = true; throw new Cancelled(); }
        controller.enqueue(enc.encode(JSON.stringify(payload) + "\n"));
      };
      try {
        emit(await run(emit));
      } catch (exc) {
        if (!(exc instanceof Cancelled)) {
          console.error("say:", exc);
          try { controller.enqueue(enc.encode(JSON.stringify({ "error": exc instanceof ModelError ? "model: " + exc.message : "internal" }) + "\n")); }
          catch (e) {}
        }
      }
      try { controller.close(); } catch (e) {}
    },
    cancel() { gone = true; },
  });
  return new Response(body_, { status: 200, headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
}

/** "Never mind" / ✕: what they said is taken back -- out of the
 * conversation the partner remembers, as if it had not been said. */
function forget(body) {
  const said = strip(body["said"] || "");
  if (!said) return fail("/api/forget", 400, "nothing_to_forget");
  const state = session(body["session"]);
  if (!state["discarded"]) state["discarded"] = new Set();
  state["discarded"].add(said);
  const history = state["history"];
  let removed = false;
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m["role"] === "user" && strip(rsplit(m["content"], "\n", 1).slice(-1)[0]) === said) {
      const end = i + 1 < history.length && history[i + 1]["role"] === "assistant" ? i + 2 : i + 1;
      state["history"] = [...history.slice(0, i), ...history.slice(end)];
      removed = true;
      break;
    }
  }
  record("discarded", { session: body["session"], said });
  return json({ "ok": true, "removed": removed });
}

async function spoken_text(body) {
  let text = speakable(strip(body["text"] || ""));
  const ref = strip(body["ref"] || "");
  if (ref && allowed(ref) && !body["whole"]) {
    // The net under the «» marks: whatever the model did, no long
    // stretch of the page itself reaches the voice.
    text = align.unspeak(text, page_of(await load_pack(ref)));
  }
  return text;
}

/** A sentence ready to be spoken: the address of its audio. The Worker
 * makes it as it is played and keeps it, so the same words are never paid
 * for or waited on twice ("Go ahead." comes back instantly). */
async function prepare_voice(body) {
  const text = await spoken_text(body);
  if (!strip(text, " …")) return fail("/api/voice", 400, "nothing_to_say");
  const llm = new LLM();
  if (VOICE_NAMES.includes(body["voice_name"])) llm.voice = body["voice_name"];
  // What it says, so that hearing it back through the speakers is
  // recognised as its own voice and not taken for the learner's.
  SPOKEN.push(new Set(word_list(text)));
  SPOKEN.splice(0, Math.max(0, SPOKEN.length - 6));
  return json({ "id": null, "url": voice_url(llm, text) });
}

/** The Worker's address for these words in this voice (the same request llm.speak makes). */
export function voice_url(llm, text) {
  const q = new URLSearchParams({ model: llm.tts, voice: llm.voice, input: text.slice(0, 3800),
    instructions: VOICE_DIRECTION, format: "mp3" });
  return (config.voice || "/x/voice") + "?" + q.toString();
}

async function speak(body) {
  const text = await spoken_text(body);
  if (!strip(text, " …")) return fail("/api/speak", 400, "nothing_to_say");
  const [audio, mime] = await new LLM().speak(text);
  return new Response(audio, { headers: { "Content-Type": mime } });
}

// -- health ----------------------------------------------------------------------

const _SEFARIA = { at: 0, ok: null };
const _WORKER = { at: 0, key: null };

export async function health() {
  const llm = new LLM();
  if (now() - _WORKER.at > 120) {
    try {
      const r = await config.fetch(config.who || "/x/who");
      _WORKER.key = r.ok ? (await r.json()).key !== false : false;
    } catch (e) { _WORKER.key = false; }
    _WORKER.at = now();
  }
  if (now() - _SEFARIA.at > 120) {
    _SEFARIA.ok = !!(await sefaria.get("v3/texts/Berakhot 2a:1", { soft: true, version: "source" }));
    _SEFARIA.at = now();
  }
  const cached = await store.kv.keys("packs");
  const key = !!_WORKER.key;
  return { "provider": llm.provider, "heavy": llm.heavy, "cheap": llm.cheap,
    "key": key, "sefaria": _SEFARIA.ok, "can_hear": llm.can_hear && key,
    "can_speak": llm.can_speak && key, "cached": cached.length,
    "index": (await store.kv.keys("index")).length > 0 };
}

// -- preparing a tractate, and the morning ------------------------------------------

/** The whole-tractate index, once every page of it is kept. */
async function build_index(masechta) {
  try {
    await buildIndexOf(masechta, async (ref) => (await load_pack(ref)).data);
    INDEXES.delete(masechta);
  } catch (exc) {
    console.info("index", masechta, exc);
  }
}

review.hooks.LOAD = (ref) => load_pack(ref);
review.hooks.ON_DISK = async (ref) => ((await have_pack(ref)) ? Pack.load(ref) : null);

export const PREPARER = new daily.Preparer(load_pack, have_pack, { finish: build_index });

/** While the app is open: today's daf and tomorrow's, built before they are
 * opened, and again when the date turns over. */
let seen = null;
export async function morning() {
  const today = store.today();
  if (today === seen) return;
  const refs = [];
  for (const offset of [0, 1]) {
    const day = new Date(); day.setDate(day.getDate() + offset);
    const found = await daily.daf_yomi({ day });
    refs.push(...((found || {})["amudim"] || []));
  }
  if (refs.length) {
    prefetch(...refs);
    seen = today;
  }
}
