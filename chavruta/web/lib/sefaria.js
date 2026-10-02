// Sefaria: fetching an amud and building its pack.
//
// Written against recorded responses from the live API (see tests/), because the
// first version was written from memory and got two things wrong that together
// meant no real page ever loaded: the text endpoint wants `language|versionTitle`,
// not a bare title, and a link's anchor is the segment itself -- trimming its last
// ":n" detached every commentary from every line.
//
// A pack holds everything retrieved about one amud. Nothing in it is generated,
// apart from the argument structure read out of each commentary by sugya.py, and
// that is extracted from the commentary's own words.
//
// Ported from chavruta/sefaria.py. Python's module-level API is `config.sefaria`
// (net.js), read at call time.

import { re, match, sub, split, finditer, escape, strip, rstrip, rsplit, sorted, cmp, str, truthy, or, range } from "./py.js";
import { config, getJSON, HttpError, quote, urlencode } from "./net.js";
import * as sugya from "./sugya.js";
import { WHO, MASECHTOT } from "./commentators.js";

// Python: API = os.environ.get("CHAVRUTA_SEFARIA_API", ...).rstrip("/")
const API = () => rstrip(config.sefaria, "/");

// The vocalized Davidson text carries nikud and punctuation, and the punctuation
// is Steinsaltz's reading of where each clause stops -- which is the judgement a
// learner gets wrong. Fall back to the unvocalized edition, then to whatever
// Sefaria calls the source, rather than fail to open a page.
export const VERSIONS = [
  "hebrew|William Davidson Edition - Vocalized Aramaic",
  "hebrew|William Davidson Edition - Aramaic",
  "source",
];

// Commentary links carry their text; for everything else the reference is
// enough. A single cross-reference like "Berakhot 13a-22a" arrives with nine
// dapim of text attached, and none of it belongs in a pack.
export const KEEP_TEXT = new Set(["Commentary"]);

// Where the learner can go from a line, grouped the way Sefaria's own panel
// groups it. Capped so a heavily quoted line stays readable.
export const RELATED = ["Halakhah", "Talmud", "Tanakh", "Mishnah", "Midrash", "Responsa",
  "Jewish Thought", "Chasidut", "Musar", "Reference"];
export const RELATED_CAP = 30;

export const TAG = re(String.raw`<[^>]+>`);
export const LITERAL_TAG = re(String.raw`</?(?:b|strong)\b[^>]*>`, "i");
export const CLAUSE_END = re(String.raw`[^.?!:]+[.?!:]?`);
export const NIKUD = re(String.raw`[֑-ׇ]`);
// Rishonim bold their lemma, sometimes after a short marker -- "[מתני']:",
// "גמרא:", "(דף ב.)", "הכי גריס רש"י ז"ל:" -- so allow a little before it.
export const BOLD_OPENING = re(String.raw`^.{0,40}?<b>(.{1,220}?)</b>`, "s");
export const DASH_OPENING = re(String.raw`^(.{2,90}?)\s+[–—-]\s+`);

export const _SEEN = new Map();

// Bumped whenever the pack's shape or meaning changes. Older packs on disk are
// rebuilt: version 1 packs had every commentary detached from its line;
// version 5 names who speaks in each move of an argument.
export const PACK_VERSION = 6;      // 6: Steinsaltz keeps which words are the daf's (bold on Sefaria)


export class SefariaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SefariaError";
  }
}


const sleep = (seconds) => new Promise((ok) => setTimeout(ok, seconds * 1000));


export async function get(path, { soft = false, ...params } = {}) {
  // urllib.parse.quote(path, safe="/:,-.|")
  let url = `${API()}/${quote(path).replace(/%3A/g, ":").replace(/%2C/g, ",").replace(/%7C/g, "|")}`;
  if (truthy(params)) {
    const pairs = [];
    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        pairs.push([key, item]);
      }
    }
    url += "?" + pairs.map(([k, v]) => urlencode({ [k]: v })).join("&");
  }
  // A soft call is a probe that is allowed to miss; a real fetch retries.
  const [attempts, timeout] = soft ? [1, 8] : [3, 45];
  let last = null;
  for (const attempt of range(attempts)) {
    try {
      return await getJSON(url, { timeout, headers: { "User-Agent": "chavruta/0.3" } });
    } catch (exc) {
      last = exc;
      if (exc instanceof HttpError) {
        if (soft || exc.status === 400 || exc.status === 404) {
          break;
        }
      } else if (soft) {
        break;
      }
    }
    if (attempt < attempts - 1) {
      await sleep(1.5 * (attempt + 1));
    }
  }
  if (soft) {
    return null;
  }
  throw new SefariaError(`could not reach Sefaria for ${path} (${last && last.message})`);
}


/** Text a person would read, from a string or Sefaria's nested lists. */
export function plain(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map((v) => plain(v)).filter((p) => p).join(" ");
  }
  return strip(sub(re(String.raw`\s+`), " ", sub(TAG, "", str(value))));
}


export function unpointed(text) {
  return sub(NIKUD, "", text);
}


/** Keep Steinsaltz's split between the words on the daf and his expansion. */
export function split_gloss(html) {
  const spans = [];
  split(LITERAL_TAG, html || "").forEach((chunk, index) => {
    const text = plain(chunk);
    if (text) {
      spans.push({ "kind": index % 2 === 0 ? "text" : "daf", "text": text });
    }
  });
  return spans;
}


export const STZ_TAG = re(String.raw`(</?(?:b|strong|small|big)\b[^>]*>)`, "i");


/** Steinsaltz as Sefaria marks him: the daf's own words (bold), his
 * translations of the Aramaic (small, in brackets), section heads (big,
 * "ב גמרא"), and his own words. Spaces kept, so the parts join back up. */
export function steinsaltz_parts(html) {
  const parts = [], state = { "b": false, "small": false, "big": false };
  for (const chunk of split(STZ_TAG, html || "")) {
    const m = match(re(String.raw`<(/?)(b|strong|small|big)\b`, "i"), chunk);
    if (m) {
      const name = m.group(2).toLowerCase();
      const tag = name === "strong" ? "b" : name;
      state[tag] = !truthy(m.group(1));
      continue;
    }
    const text = sub(re(String.raw`\s+`), " ", sub(TAG, "", chunk));
    if (!text) {
      continue;
    }
    const kind = state.big ? "head" : state.small ? "tr" : state.b ? "daf" : "text";
    if (parts.length && parts[parts.length - 1].kind === kind) {
      parts[parts.length - 1].text += text;
    } else {
      parts.push({ "kind": kind, "text": text });
    }
  }
  return parts;
}


/** Break a line at its printed stopping points. */
export function split_clauses(vocalized) {
  const clauses = [];
  for (const m of finditer(CLAUSE_END, vocalized)) {
    const text = strip(m.group(0));
    if (text) {
      const last = text[text.length - 1];
      clauses.push({ "i": clauses.length, "he": text,
        "ends": ".?!:".includes(last) ? last : null });
    }
  }
  return clauses;
}


/** The amud in the vocalized Davidson text and its English, plus where it sits. */
export async function fetch_daf(ref) {
  let source = [], english = [], meta = {};
  for (const version of VERSIONS) {
    const data = await get(`v3/texts/${ref}`, { version: [version, "english"] });
    meta = {};
    for (const k of ["next", "prev", "heRef", "book", "heTitle"]) meta[k] = data[k] ?? null;
    for (const v of data.versions ?? []) {
      let text = or(v.text ?? null, []);
      text = Array.isArray(text) ? text : [text];
      if (v.languageFamilyName === "english" || v.actualLanguage === "en") {
        english = or(english, text);
      } else if (!truthy(source)) {
        [source, meta.version] = [text, v.versionTitle ?? null];
      }
    }
    if (truthy(source)) {
      return [source, english, meta];
    }
  }
  throw new SefariaError(`Sefaria has no Hebrew text for ${ref}`);
}


export async function fetch_links(ref) {
  return or(await get(`links/${ref}`, { with_text: 1 }), []);
}


/** The name a link's commentary goes by, e.g. "Rashi", "Rif", "Tosafot HaRosh". */
export function commentator(link) {
  const name = or(link.collectiveTitle ?? null, {}).en;
  if (truthy(name)) {
    return name;
  }
  const index = or(link.index_title ?? null, "");
  return index.includes(" on ") ? index.split(" on ")[0] : index;
}


/** Which lines of this amud a link hangs off, as integers. */
export function anchors(link, ref) {
  const refs = or(link.anchorRefExpanded ?? null, [or(link.anchorRef ?? null, "")]);
  const lines = [];
  for (const r of refs) {
    const m = match(re("^" + escape(ref) + String.raw`:(\d+)(?:-(\d+))?$`), r || "");
    if (m) {
      const start = parseInt(m.group(1), 10);
      lines.push(...range(start, parseInt(m.group(2) || start, 10) + 1));
    }
  }
  return sorted([...new Set(lines)]);
}


/** The dibur hamatchil: the words on the daf a comment hangs off. */
export function opening_words(name, html, body) {
  if (name === "Steinsaltz") {
    return null;  // a running explanation, not a comment on a lemma
  }
  const raw = typeof html === "string" ? html : "";
  let m = match(BOLD_OPENING, raw);
  if (m) {
    return rstrip(plain(m.group(1)), " .:");
  }
  m = match(DASH_OPENING, body);
  return m ? rstrip(m.group(1), " .:") : null;
}


const weight_of = (name) => (Object.hasOwn(WHO, name) ? WHO[name] : {}).weight ?? 20;


/** Everything retrieved about one amud, ready to learn from. */
export async function build(ref) {
  const [source, english, meta] = await fetch_daf(ref);
  const links = await fetch_links(ref);
  const masechta = rsplit(ref, " ", 1)[0];

  const segments = [];
  source.forEach((html, i) => {
    const n = i + 1;
    const vocalized = plain(html);
    segments.push({
      "ref": `${ref}:${n}`,
      "n": n,
      "he": vocalized,
      "he_plain": unpointed(vocalized),
      "clauses": split_clauses(vocalized),
      "en": split_gloss(n <= english.length ? english[n - 1] : ""),
      "commentaries": {},
      "halacha": [],
      "xrefs": [],
      "related": {},
      "panel": {},
    });
  });
  const by_n = new Map(segments.map((s) => [s.n, s]));

  for (const link of links) {
    const lines = anchors(link, ref).filter((n) => by_n.has(n));
    if (!lines.length) {
      continue;
    }
    const category = or(link.category ?? null, "");
    const first = by_n.get(lines[0]);
    for (const n of lines) {
      const panel = by_n.get(n).panel;
      panel[category] = (Object.hasOwn(panel, category) ? panel[category] : 0) + 1;
    }

    if (KEEP_TEXT.has(category)) {
      // Pinned to this masechta: a daf's links can carry commentary on
      // another tractate that quotes it, and that is not on this page.
      if (!or(link.index_title ?? null, masechta).includes(masechta)) {
        continue;
      }
      const name = commentator(link);
      const body = plain(link.he ?? null);
      if (!body) {
        continue;
      }
      const english_text = link.text ?? null;
      const entry = {
        "ref": link.ref ?? null,
        "dibur": opening_words(name, link.he ?? null, body),
        "weight": weight_of(name),
        "he": body,
        "en": typeof english_text === "string" ? plain(english_text) : null,
        "structure": sugya.structure(link.ref ?? null, body),
      };
      if (name === "Steinsaltz") {
        // Sefaria sets the daf's own words in bold: kept, so the
        // Steinsaltz view shows them as he is printed, not by guess.
        entry.parts = steinsaltz_parts(typeof link.he === "string" ? link.he : "");
      }
      if (lines.length > 1) {
        entry.span = [lines[0], lines[lines.length - 1]];
      }
      (Object.hasOwn(first.commentaries, name) ? first.commentaries[name] : (first.commentaries[name] = [])).push(entry);
    } else if (category === "Halakhah" && link.type === "ein mishpat / ner mitsvah") {
      first.halacha.push(link.ref ?? null);
    } else if (["Talmud", "Tanakh", "Mishnah"].includes(category)) {
      first.xrefs.push(link.ref ?? null);
    }
    if (RELATED.includes(category)) {
      const bucket = Object.hasOwn(first.related, category) ? first.related[category] : (first.related[category] = []);
      if (bucket.length < RELATED_CAP && !bucket.includes(link.ref ?? null)) {
        bucket.push(link.ref ?? null);
      }
    }
  }

  for (const segment of segments) {
    for (const entries of Object.values(segment.commentaries)) {
      entries.sort((a, b) => cmp(a.ref, b.ref));
    }
  }

  // Python sorts a set here, so commentators of equal weight come in whatever
  // order the set iterates (it varies run to run); here, first seen first.
  const present = sorted([...new Set(segments.flatMap((s) => Object.keys(s.commentaries)))],
    (c) => -weight_of(c));
  const weights = {};
  for (const c of present) weights[c] = weight_of(c);
  return {
    "pack_version": PACK_VERSION,
    "ref": ref,
    "he_ref": meta.heRef ?? null,
    "masechta": rsplit(ref, " ", 1)[0],
    "next": meta.next ?? null,
    "prev": meta.prev ?? null,
    "version": meta.version ?? null,
    "commentators": present,
    "weights": weights,
    "built_at": new Date().toISOString().slice(0, 19) + "Z",
    "source": "sefaria.org",
    // Where a learner would start and stop: mishna, gemara, a baraita.
    "sections": sugya.sections(segments),
    "segments": segments,
  };
}


export function parse_range(text) {
  if (!text) {
    return null;
  }
  const chosen = new Set();
  for (const part of text.split(",")) {
    if (part.includes("-")) {
      const [start, end] = part.split("-");
      for (const n of range(Math.trunc(Number(start)), Math.trunc(Number(end)) + 1)) chosen.add(n);
    } else {
      chosen.add(Math.trunc(Number(part)));
    }
  }
  return chosen;
}


/** Every amud of a masechta in order, from commentators.MASECHTOT. */
export function amudim(masechta) {
  const m = MASECHTOT.find((x) => x.name === masechta) ?? null;
  if (!m) {
    return [];
  }
  const out = [];
  for (const n of range(m.first, m.last + 1)) {
    for (const amud of "ab") {
      if (n === m.first && amud === "a" && m.first_amud === "b") {
        continue;
      }
      if (n === m.last && amud === "b" && (m.last_amud ?? "b") === "a") {
        continue;
      }
      if (!(m.missing ?? []).includes(`${n}${amud}`)) {
        out.push(`${masechta} ${n}${amud}`);
      }
    }
  }
  return out;
}
