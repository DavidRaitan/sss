// Where on the page is the learner?
//
// The spec's central technical bet: reading aloud is not a transcription problem.
// The text of the amud is already known, so what we are doing is finding a noisy
// string inside a known one. Speech recognition garbles Aramaic, but garbled
// Aramaic still lines up with the page far better than it lines up with anything
// else, and that is enough to know which line they are on, whether they are
// reading or talking, and where they stopped.
//
// That last one feeds the only correction the partner is allowed to make about
// someone's reading: not which words they said -- we cannot hear that reliably and
// must never pretend to -- but where they broke the sentence, which is printed.

import { re, sub, search, findall, pysplit, strip, pyround, zip, range, all, or, truthy } from "./py.js";

// Python: re.compile(r"[֑-ׇ]") -- the nikud and cantillation marks, U+0591 to U+05C7.
export const NIKUD = re(String.raw`[֑-ׇ]`);
export const NOT_LETTER = re(String.raw`[^א-ת]+`);
export const HEBREW_CHAR = re(String.raw`[א-ת]`);
export const LATIN_CHAR = re(String.raw`[A-Za-z]`);
// Python: str.maketrans("ךםןףץ", "כמנפצ"), as {final letter: ordinary letter}.
export const FINALS = maketrans("ךםןףץ", "כמנפצ");

export const MATCH = 2.0, MISMATCH = -1.0, GAP = -1.0;
export const SIMILAR = 0.72;

/** str.maketrans(x, y) as a plain object, character to character. */
export function maketrans(x, y) {
  const from = Array.from(x), to = Array.from(y), table = {};
  from.forEach((c, i) => { table[c] = to[i]; });
  return table;
}
/** str.translate(table) with a table from maketrans(). */
export function translate(s, table) {
  return Array.from(s).map((c) => (Object.hasOwn(table, c) ? table[c] : c)).join("");
}

/** A word reduced to its letters, so ASR spelling does not decide a match. */
export function norm(word) {
  return translate(sub(NOT_LETTER, "", sub(NIKUD, "", word)), FINALS);
}

export function words(text) {
  return pysplit(text).map((t) => norm(t)).filter((w) => w);
}

/** The heard words as said (for quoting back) beside their reduced form. */
export function tokens(text) {
  const out = [];
  for (const t of pysplit(text)) {
    const k = norm(t);
    if (k) out.push([strip(t, ".,;:?!\"'()[]«»—-"), k]);
  }
  return out;
}

export function hebrew_share(text) {
  const he = findall(HEBREW_CHAR, text).length, la = findall(LATIN_CHAR, text).length;
  return he + la ? he / (he + la) : 0.0;
}

// -- difflib.SequenceMatcher, the parts Page.sim uses (isjunk=None, autojunk=True) --
// Ported line for line so ratio() is the same number Python gets.

class SequenceMatcher {
  constructor(isjunk = null, a = "", b = "", autojunk = true) {
    this.isjunk = isjunk;
    this.autojunk = autojunk;
    // set_seqs(a, b); the sequences as Python indexes them: by code point.
    this.a = Array.from(a);
    this.b = Array.from(b);
    this.matching_blocks = null;
    this.__chain_b();
  }

  __chain_b() {
    const b = this.b;
    const b2j = this.b2j = new Map();
    b.forEach((elt, i) => {
      if (!b2j.has(elt)) b2j.set(elt, []);
      b2j.get(elt).push(i);
    });
    // Purge junk elements
    const junk = this.bjunk = new Set();
    const isjunk = this.isjunk;
    if (isjunk) {
      for (const elt of b2j.keys()) if (isjunk(elt)) junk.add(elt);
      for (const elt of junk) b2j.delete(elt);
    }
    // Purge popular elements that are not junk
    const popular = this.bpopular = new Set();
    const n = b.length;
    if (this.autojunk && n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of b2j) if (idxs.length > ntest) popular.add(elt);
      for (const elt of popular) b2j.delete(elt);
    }
  }

  find_longest_match(alo = 0, ahi = null, blo = 0, bhi = null) {
    const a = this.a, b = this.b, b2j = this.b2j, isbjunk = (x) => this.bjunk.has(x);
    if (ahi === null) ahi = a.length;
    if (bhi === null) bhi = b.length;
    let besti = alo, bestj = blo, bestsize = 0;
    let j2len = new Map();
    const nothing = [];
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map();
      for (const j of b2j.get(a[i]) || nothing) {
        // a[i] matches b[j]
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) { besti = i - k + 1; bestj = j - k + 1; bestsize = k; }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti--; bestj--; bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !isbjunk(b[bestj + bestsize]) &&
           a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    while (besti > alo && bestj > blo && isbjunk(b[bestj - 1]) && a[besti - 1] === b[bestj - 1]) {
      besti--; bestj--; bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && isbjunk(b[bestj + bestsize]) &&
           a[besti + bestsize] === b[bestj + bestsize]) bestsize++;
    return [besti, bestj, bestsize];
  }

  get_matching_blocks() {
    if (this.matching_blocks !== null) return this.matching_blocks;
    const la = this.a.length, lb = this.b.length;
    const queue = [[0, la, 0, lb]];
    const matching_blocks = [];
    while (queue.length) {
      const [alo, ahi, blo, bhi] = queue.pop();
      const x = this.find_longest_match(alo, ahi, blo, bhi);
      const [i, j, k] = x;
      if (k) {   // if k is 0, there was no matching block
        matching_blocks.push(x);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matching_blocks.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
    let i1 = 0, j1 = 0, k1 = 0;
    const non_adjacent = [];
    for (const [i2, j2, k2] of matching_blocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) non_adjacent.push([i1, j1, k1]);
        [i1, j1, k1] = [i2, j2, k2];
      }
    }
    if (k1) non_adjacent.push([i1, j1, k1]);
    non_adjacent.push([la, lb, 0]);
    this.matching_blocks = non_adjacent;
    return this.matching_blocks;
  }

  ratio() {
    const matches = this.get_matching_blocks().reduce((s, triple) => s + triple[triple.length - 1], 0);
    const length = this.a.length + this.b.length;
    return length ? 2.0 * matches / length : 1.0;
  }
}
export { SequenceMatcher };

/** Every word on the amud, with where it sits: line, clause, place in clause. */
export class Page {
  constructor(pack) {
    this.words = []; this.where = []; this.at = []; this.surface = [];
    for (const segment of pack["segments"]) {
      const clauses = or(segment["clauses"], [{ "i": 0, "he": segment["he"] }]);
      let place = 0;  // the word's place in its line, counted the way the page counts
      for (const clause of clauses) {
        const said = tokens(sub(NIKUD, "", clause["he"]));
        const ws = said.map(([, k]) => k);
        ws.forEach((w, k) => {
          this.surface.push(said[k][0]);
          this.words.push(w);
          this.where.push([segment["n"], clause["i"], k, ws.length]);
          this.at.push(place);
          place += 1;
        });
      }
    }
    this._sim = new Map();
    this.vocabulary = new Set(this.words);
  }

  /** Every run of n consecutive words on the amud, for spotting quotation.
   *  (Python: a set of tuples; here a Set of the words joined by spaces.) */
  grams(n) {
    const key = "_grams" + n;
    if (this[key] === undefined) {
      this[key] = new Set(range(this.words.length - n + 1).map((i) => this.words.slice(i, i + n).join(" ")));
    }
    return this[key];
  }

  sim(a, b) {
    if (a === b) return 1.0;
    const key = a + "|" + b;
    if (!this._sim.has(key)) {
      const A = Array.from(a), B = Array.from(b);
      // Cheap filters first: most pairs are nowhere near each other.
      if (Math.abs(A.length - B.length) > 2 || (A[0] !== B[0] && A[A.length - 1] !== B[B.length - 1])) {
        this._sim.set(key, 0.0);
      } else {
        this._sim.set(key, new SequenceMatcher(null, a, b).ratio());
      }
    }
    return this._sim.get(key);
  }

  /** Best local alignment of what was heard against the page.
   *
   *  Smith-Waterman over words: the heard words need not be complete or in
   *  perfect order, and whatever they said before or after the reading does
   *  not count against the match. Also returns the alignment itself, so the
   *  places where what was said and what is printed part ways can be named.
   */
  locate(transcript) {
    const said = tokens(transcript);
    const heard = said.map(([, k]) => k);
    if (!heard.length || !this.words.length) return null;
    const rows = heard.length, cols = this.words.length;
    let prev = new Array(cols + 1).fill(0.0);
    let best = 0.0, best_at = null;
    const trace = new Map();   // "i|j" -> 0 diagonal, 1 up, 2 left
    for (let i = 1; i <= rows; i++) {
      const cur = new Array(cols + 1).fill(0.0);
      for (let j = 1; j <= cols; j++) {
        const s = this.sim(heard[i - 1], this.words[j - 1]);
        const diag = prev[j - 1] + (s >= SIMILAR ? MATCH * s : MISMATCH);
        const up = prev[j] + GAP, left = cur[j - 1] + GAP;
        const score = Math.max(0.0, diag, up, left);
        cur[j] = score;
        if (score > 0) trace.set(i + "|" + j, score === diag ? 0 : (score === up ? 1 : 2));
        if (score > best) { best = score; best_at = [i, j]; }
      }
      prev = cur;
    }
    if (!best_at) return null;
    // Walk back: where the matched run began, how much matched, and each
    // step of the alignment -- same, swapped, said-but-not-printed, or
    // printed-but-not-said.
    let [i, j] = best_at;
    const end_i = i, end_j = j - 1;
    let matched = 0, start_j = j - 1, start_i = i - 1;
    const ops = [];
    while (i > 0 && j > 0 && trace.has(i + "|" + j)) {
      const step = trace.get(i + "|" + j);
      if (step === 0) {
        const same = this.sim(heard[i - 1], this.words[j - 1]) >= SIMILAR;
        matched += same ? 1 : 0;
        ops.push([same ? "same" : "swap", i - 1, j - 1]);
        start_j = j - 1; start_i = i - 1;
        i -= 1; j -= 1;
      } else if (step === 1) {
        ops.push(["added", i - 1, null]);
        i -= 1;
      } else {
        ops.push(["skipped", null, j - 1]);
        j -= 1;
      }
    }
    ops.reverse();
    return { "score": best, "matched": matched, "heard": heard.length,
             "start": start_j, "end": end_j, "start_heard": start_i, "end_heard": end_i,
             "ops": ops, "said": said };
  }

  printed(j) {
    return j < this.surface.length ? this.surface[j] : this.words[j];
  }
}

/** Decide what a stretch of speech was, and where it leaves the learner.
 *
 *  reading  -- they were reading the page aloud; follow, and stay quiet
 *  quoting  -- they talked, and quoted the page while doing it
 *  talking  -- nothing on the page matched; this is conversation
 */
export function listen(page, transcript) {
  const share = hebrew_share(transcript);
  // Gate on how many Hebrew words there are, not their share: "so when he
  // says תנא אקרא קאי he means..." is mostly English and still points at a line.
  const hebrew_words = pysplit(transcript).filter((t) => search(HEBREW_CHAR, t)).length;
  const hit = hebrew_words >= 3 ? page.locate(transcript) : null;
  // A short line needs fewer words to be recognised: «הם מוכרים עד חצות» is
  // «וחכמים אומרים עד חצות» misheard, not talk.
  const need = hebrew_words <= 4 ? 2 : 3;
  if (!hit || hit["matched"] < need) return { "mode": "talking", "hebrew": pyround(share, 2) };

  const coverage = hit["matched"] / Math.max(hit["heard"], 1);
  const [n, clause, k, size] = page.where[hit["end"]];
  const start_n = page.where[hit["start"]][0];
  const left = size - (k + 1);
  const result = {
    "mode": (share >= 0.6 && coverage >= 0.55) ? "reading" : "quoting",
    "line": n,
    "from_line": start_n,
    "clause": clause,
    "coverage": pyround(coverage, 2),
    "matched": hit["matched"],
    "hebrew": pyround(share, 2),
    // Only claim a mid-clause stop when the match is strong enough that a
    // wrong claim is unlikely -- a false "you stopped early" is exactly
    // the kind of correction that makes a learner stop trusting this.
    "stopped_mid_clause": Boolean(left >= 2 && coverage >= 0.7 && hit["matched"] >= 4),
    // So the page can show how far it followed -- position, never a verdict.
    "from_word": page.at[hit["start"]],
    "word": page.at[hit["end"]],
    "words_left_in_clause": left,
  };
  const slips = differences(page, hit);
  if (truthy(slips)) result["slips"] = slips;
  // "Are you sure? Let me read it again. מאימתי..." -- a question wrapped
  // around a reading. The reading is followed, and the question answered.
  if (result["mode"] === "reading" && asks(page, transcript)) {
    result["mode"] = "quoting";
    result["asked"] = true;
  }
  return result;
}

export const QUESTION = re(String.raw`[^.?!]*\?`);

/** Whether they asked something of their own, not a question the page asks. */
export function asks(page, transcript) {
  for (const sentence of findall(QUESTION, transcript)) {
    const latin = findall(re(String.raw`[A-Za-z]+`), sentence).length;
    const hebrew = pysplit(sentence).filter((t) => search(HEBREW_CHAR, t)).map((t) => norm(t));
    const on_page = hebrew.filter((w) => page.vocabulary.has(w)).length;
    if (latin >= 2 && latin > hebrew.length) return true;
    if (hebrew.length && on_page < 0.5 * hebrew.length) return true;
  }
  return false;
}

// Small words the recogniser drops or invents all the time. Never worth a word.
export const LIGHT = new Set(pysplit("את של על ד ו ה לא הוא היא ליה להו אי מאי הכי נמי קא וכו כי אם עד כל זה").map((w) => norm(w)));
// Below this, two words are different words rather than two spellings or two
// pronunciations of one: מעשר/בתרומתן, השנייה/הראשונה -- but not
// בערבית/בערבין or קוראים/קורין, which is how people say it and none of our business.
export const DIFFERENT = 0.66;

/** Where what was said and what is printed part ways -- in meaning, not accent.
 *
 *  A swapped word, a word that carries meaning left out, words that are not
 *  on the page at all. These are the things a chavruta across the table
 *  would hear and ask about ("מעשר? it says תרומה"), as opposed to how a
 *  word was pronounced, which is none of the partner's business and which
 *  speech recognition cannot hear anyway.
 */
export function differences(page, hit) {
  const said = hit["said"], ops = hit["ops"];
  const swapped = [], skipped = [], added = [];
  const len = (s) => Array.from(s).length;
  for (const [op, i, j] of ops) {
    if (op === "swap") {
      const a = said[i][1], b = page.words[j];
      if (page.sim(a, b) < DIFFERENT && len(b) >= 3 && len(a) >= 2 && !LIGHT.has(a)) {
        swapped.push([said[i][0], page.printed(j)]);
      }
    } else if (op === "skipped") {
      if (len(page.words[j]) >= 3 && !LIGHT.has(page.words[j])) skipped.push(page.printed(j));
    } else if (op === "added") {
      if (len(said[i][1]) >= 3 && !LIGHT.has(said[i][1])) added.push(said[i][0]);
    }
  }
  // What came after the last word that lined up. One or two words are the
  // end of the reading said differently ("...האשמורה השנייה"); more is
  // something else they said, in Hebrew, that is not on the page.
  const tail = said.slice(hit["end_heard"]);
  let after = "";
  if (tail.length && tail.some(([w]) => search(HEBREW_CHAR, w))) {
    if (tail.length <= 2) {
      tail.forEach(([word, key], k) => {
        const j = hit["end"] + 1 + k;
        if (j < page.words.length && page.sim(key, page.words[j]) < DIFFERENT &&
            len(page.words[j]) >= 3 && !LIGHT.has(key)) {
          swapped.push([word, page.printed(j)]);
        }
      });
    } else if (tail.filter(([, key]) => page.vocabulary.has(key)).length < 0.6 * tail.length) {
      // Mostly words the amud does not have. (Mostly words it does have
      // is reading that skipped ahead, which is theirs to do.)
      after = tail.map(([w]) => w).join(" ");
    }
  }
  const out = {};
  if (swapped.length) out["swapped"] = swapped.slice(0, 4);
  if (skipped.length) out["skipped"] = skipped.slice(0, 4);
  if (added.length) out["added"] = added.slice(0, 4);
  if (after) out["after"] = after;
  return out;
}

/** The comparison in a sentence the partner can use. */
export function describe(slips) {
  const parts = [];
  for (const [said, printed] of slips["swapped"] || []) {
    parts.push("said «" + said + "» where the page has «" + printed + "»");
  }
  if (truthy(slips["skipped"])) parts.push("did not say «" + slips["skipped"].join("», «") + "»");
  if (truthy(slips["added"])) parts.push("added «" + slips["added"].join("», «") + "», which is not on the page");
  if (truthy(slips["after"])) parts.push("then went on, not from the page: «" + slips["after"] + "»");
  return parts.join("; ");
}

/** Keep the voice from reading the gemara back to them.
 *
 *  Short quotes are how a chavruta points ("it says «עד חצות»") and are
 *  spoken. A stretch of nine or more of the page's own words in a row is the
 *  machine reading the daf aloud, which is the learner's job: the first few
 *  words are kept, so the sentence still points somewhere, and the rest
 *  becomes a pause.
 */
export function unspeak(text, page, { run = 9, keep = 5 } = {}) {
  const tokens = pysplit(text);
  const keys = tokens.map((t) => norm(t));
  const grams = page.grams(run);
  const silence = new Array(tokens.length).fill(false);
  for (const i of range(tokens.length - run + 1)) {
    const window = keys.slice(i, i + run);
    if (all(window) && grams.has(window.join(" "))) {
      for (const j of range(i + keep, i + run)) silence[j] = true;
    }
  }
  const out = [];
  let quiet = false;
  for (const [token, hush] of zip(tokens, silence)) {
    if (hush) {
      if (!quiet) out.push("…");
      quiet = true;
    } else {
      out.push(token);
      quiet = false;
    }
  }
  return out.join(" ");
}
