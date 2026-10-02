// Searching a whole masechta, so the partner can place a page in its tractate.
//
// A pack knows one amud in depth and the rest of the tractate not at all, which
// is the wrong shape for the questions people actually ask -- "haven't we had
// this already", "isn't that the opposite of what it says further on". Answering
// those means knowing where a phrase turns up elsewhere.
//
// Two ways in. A phrase search, for when the learner names the thing. And a
// relatedness pass, for when they only gesture at it: pages are scored by the
// rare words they share with the line in hand, since a word that appears on
// forty amudim tells you nothing and one that appears on three tells you a lot.
//
// Ported from chavruta/masechta_index.py, with pack/build_index.py's builder as
// build_index() at the end. The index file (packs/_index_<masechta>.json) is a
// store.kv entry: ns "index", key = the same <masechta> part of the file name.

import { re, findall, sorted, sum, now, fmt } from "./py.js";
import * as store from "./store.js";
import * as sefaria from "./sefaria.js";
import * as sugya from "./sugya.js";
import { MASECHTOT } from "./commentators.js";

export const WORD = re(String.raw`[א-ת]{3,}`);

// Grammatical furniture. These carry no information about what a page is about.
export const STOP = new Set(`אמר אמרי ליה להו לן לך לו לה הוא היא הם הן אשר אלא אלה ההוא ההיא
מאי מאן היכי הכי הכא התם דהא דלא ולא ואם אבל כאן כאשר משום מפני בכל וכל ככל
רבי רב תנא תניא תנו רבנן דאמר דתנן דכתיב שנאמר קרא לומר כלומר צריך אינו אין
יש הרי אפילו כגון וכן ועוד ומאי דבר דברים זמן שעה יום לילה`.split(/\s+/).filter(Boolean));

// The store key for a masechta's index -- what was "_index_%s.json" on disk.
const index_key = (masechta) => masechta.toLowerCase().replaceAll(" ", "_");


export class Index {
  constructor(data) {
    this.masechta = data.masechta;
    this.pages = data.pages;
    // How many amudim each word appears on -- the basis for calling it rare.
    this.spread = new Map();
    for (const page of Object.values(this.pages)) {
      for (const word of new Set(page.lines.flatMap((line) => findall(WORD, line)))) {
        this.spread.set(word, (this.spread.get(word) ?? 0) + 1);
      }
    }
    this.total = Math.max(Object.keys(this.pages).length, 1);
    // Each line as bare words. The stored text keeps its punctuation, and a
    // ״ or ? between two words would otherwise break every phrase match.
    this.words = {};
    for (const [ref, page] of Object.entries(this.pages)) {
      this.words[ref] = page.lines.map((line) => findall(WORD, line).join(" "));
    }
  }

  // Python: Index.load(packs_dir, masechta) read the file; here the stored
  // index, or null if none was built.
  static async load(masechta) {
    const data = await store.kv.get("index", index_key(masechta));
    if (data === null || data === undefined) {
      return null;
    }
    return new this(data);
  }

  /** Rarer words count for more; ubiquitous ones for nothing. */
  weight(word) {
    if (STOP.has(word)) {
      return 0.0;
    }
    const seen = this.spread.get(word) ?? 0;
    if (!seen || seen > this.total * 0.25) {
      return 0.0;
    }
    return Math.log(this.total / seen);
  }

  /** Where these exact words run together elsewhere in the masechta. */
  phrase(text, { limit = 6, exclude = null } = {}) {
    // Keep the common words in the needle -- dropping one from the middle of
    // a phrase breaks the adjacency being searched for -- but insist on at
    // least two that say something.
    const words = findall(WORD, text).slice(0, 6);
    if (words.filter((w) => !STOP.has(w)).length < 2) {
      return [];
    }
    const needle = words.join(" ");
    const hits = [];
    for (const [ref, lines] of Object.entries(this.words)) {
      if (ref === exclude) {
        continue;
      }
      for (let i = 1; i <= lines.length; i++) {
        const blob = lines[i - 1];
        if (blob.includes(needle)) {
          hits.push({ "ref": `${ref}:${i}`, "text": this.pages[ref].lines[i - 1].slice(0, 160) });
          break;
        }
      }
      if (hits.length >= limit) {
        break;
      }
    }
    return hits;
  }

  /** Which other amudim share this line's uncommon vocabulary. */
  related(text, { limit = 5, exclude = null } = {}) {
    const wanted = new Map();
    for (const w of new Set(findall(WORD, text))) {
      const s = this.weight(w);
      if (s > 0) wanted.set(w, s);
    }
    if (!wanted.size) {
      return [];
    }
    let scored = [];
    for (const [ref, page] of Object.entries(this.pages)) {
      if (ref === exclude) {
        continue;
      }
      const words = new Set(page.lines.flatMap((line) => findall(WORD, line)));
      const shared = [...wanted.keys()].filter((w) => words.has(w));
      if (shared.length < 2) {
        continue;
      }
      scored.push([sum(shared.map((w) => wanted.get(w))), ref, sorted(shared, (w) => -wanted.get(w)).slice(0, 4)]);
    }
    scored = sorted(scored, null, true);
    return scored.slice(0, limit).map(([, ref, shares]) => ({ "ref": ref, "shares": shares }));
  }
}


// --- pack/build_index.py --------------------------------------------------------
//
// Index a whole masechta, so "I'm sure I learned this ten pages back" is answerable.
//
// A pack knows one amud very well and knows nothing about the rest of the
// tractate. That is the wrong shape for the question a learner actually asks --
// "didn't we see this already", "isn't this the opposite of what it says later" --
// because answering it means knowing where else a phrase turns up.
//
// This walks every amud once, stores the bare consonantal text, and leaves an
// entry small enough to search instantly. Text only: no commentary, no
// translation. One request per amud, so it takes a couple of minutes and then
// never again.

// build_index.py's own walk (not sefaria.amudim): it ignores first_amud and missing.
function* amudim(m) {
  for (let n = m.first; n <= m.last; n++) {
    for (const side of ["a", "b"]) {
      if (n === m.last && side !== (m.last_amud ?? "b")) {
        continue;
      }
      yield `${m.name} ${n}${side}`;
    }
  }
}


/** pack/build_index.py's main(): index `masechta` and store it (store.kv "index").
 * `load(ref)` is an async function giving that amud's built pack, or null when
 * there is none -- the Python read packs/<ref>.json when it existed and fetched
 * the text from Sefaria otherwise. Returns what was stored. */
export async function build_index(masechta, load) {
  const m = MASECHTOT.find((x) => x.name === masechta) ?? null;
  if (!m) {
    throw new Error(fmt("no such masechta configured: %s", masechta));
  }

  const pages = {}, started = now();
  const refs = [...amudim(m)];
  for (let i = 1; i <= refs.length; i++) {
    const ref = refs[i - 1];
    let segments;
    try {
      // A built pack already holds the text; only fetch what is not cached.
      const cached = load ? await load(ref) : null;
      if (cached) {
        segments = cached.segments.map((s) => ({ "n": s.n, "he": s.he }));
      } else {
        const [source] = await sefaria.fetch_daf(ref);
        segments = source.map((html, j) => ({ "n": j + 1, "he": sefaria.plain(html) }));
      }
    } catch (exc) {
      if (!(exc instanceof sefaria.SefariaError)) throw exc;
      console.error(fmt("  skipped %s", ref));
      continue;
    }
    pages[ref] = {
      // Unpointed, because that is what a search should match against.
      "lines": segments.map((s) => sugya.bare(s.he)),
      "sections": sugya.sections(segments).map((s) => ({ "label": s.label, "from": s.from, "to": s.to })),
    };
    if (i % 10 === 0 || i === refs.length) {
      console.error(fmt("  %d/%d  %s  (%ss)", i, refs.length, ref, (now() - started).toFixed(0)));
    }
  }

  const data = { "masechta": masechta, "pages": pages };
  await store.kv.set("index", index_key(masechta), data);
  console.error(fmt("%d amudim -> %s (%.1f MB)", Object.keys(pages).length, "index/" + index_key(masechta),
    new TextEncoder().encode(JSON.stringify(data)).length / 1e6));
  return data;
}
