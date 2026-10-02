// The grounding gate: nothing leaves without a reference behind it.
//
// Two failures matter. Citing a reference the pack never held means the source
// was invented. Naming a commentator without citing him means the attribution is
// floating -- "Tosafot says" with nothing after it is exactly the sentence a
// talmid chacham checks, and we lose on.
//
// It has to work in Hebrew as well as English. The first version only knew the
// English names, so a reply in Hebrew could say "רש״י אומר" with nothing behind
// it and pass -- the gate was blind in the language the learner speaks.

import { re, search, finditer, findall, sub, split, escape, strip, sorted, truthy } from "./py.js";

export const CITE = re(String.raw`\[\[([^\]]+)\]\]`);
// Sentence ends, keeping a citation that follows the full stop with its sentence.
export const SENTENCE = re(String.raw`(?<=[.!?:;])\s+(?!\[\[)|\n+`);
export const QUOTE_MARK = "[\"'״׳’]";
// Hebrew prefixes -- ו ב ל כ ש מ ה ד -- sit directly on a name, and they stack:
// "והרשב״א" is ו + ה + רשב״א.
export const PREFIX = "(?<![א-תA-Za-z])[ובלכשמהד]{0,2}";
export const END = "(?![א-תA-Za-z])";

// name -> (English spellings, Hebrew spellings with ~ for a quote mark,
//          what a citation of him looks like)
export const NAMES = {
  "Rashi": [["Rashi"], ["רש~י"], ["Rashi on"]],
  "Tosafot": [["Tosafot", "Tosafos", "Tosfos"], ["תוספות", "תוס~"], ["Tosafot on"]],
  "Tosafot HaRosh": [["Tosafot HaRosh"], ["תוספות הרא~ש"], ["Tosafot HaRosh"]],
  "Steinsaltz": [["Steinsaltz"], ["שטיינזלץ"], ["Steinsaltz", "Berakhot"]],
  "Rabbeinu Chananel": [["Rabbeinu Chananel"], ["רבינו חננאל", "ר~ח"], ["Rabbeinu Chananel"]],
  "Rif": [["Rif"], ["רי~ף"], ["Rif "]],
  "Rosh": [["Rosh"], ["רא~ש"], ["Rosh on"]],
  "Ramban": [["Ramban"], ["רמב~ן"], ["Ramban"]],
  "Rashba": [["Rashba"], ["רשב~א"], ["Rashba"]],
  "Ritva": [["Ritva"], ["ריטב~א"], ["Ritva"]],
  "Ran": [["Ran"], ["ר~ן"], ["Ran on"]],
  "Meiri": [["Meiri"], ["מאירי"], ["Meiri"]],
  "Maharsha": [["Maharsha"], ["מהרש~א"], ["Maharsha", "Chidushei Halachot", "Chidushei Agadot"]],
  "Rambam": [["Rambam", "Maimonides"], ["רמב~ם"], ["Mishneh Torah"]],
  "Shulchan Arukh": [["Shulchan Arukh", "Shulchan Aruch"], ["שולחן ערוך", "שו~ע"], ["Shulchan Arukh"]],
  "Tur": [["Tur"], ["הטור"], ["Tur,"]],
  "Rabbeinu Tam": [["Rabbeinu Tam"], ["רבינו תם", "ר~ת"], ["Tosafot on"]],
  "Shita Mekubetzet": [["Shita Mekubetzet"], ["שיטה מקובצת"], ["Shita Mekubetzet"]],
  // Past the page, reached through links: the Rema speaks inside the
  // Shulchan Arukh's own text, so a Shulchan Arukh citation stands behind him.
  "Rema": [["Rema", "Rama", "Remah"], ["רמ~א"], ["Shulchan Arukh"]],
  "Mishnah Berurah": [["Mishnah Berurah", "Mishna Berura"], ["משנה ברורה"], ["Mishnah Berurah"]],
  "Rabbeinu Yonah": [["Rabbeinu Yonah"], ["רבינו יונה"], ["Rabbeinu Yonah"]],
  "Beit Yosef": [["Beit Yosef"], ["בית יוסף"], ["Beit Yosef"]],
  // Off Sefaria, through a trusted site only.
  "Rav Ovadia": [["Rav Ovadia", "Rabbi Ovadia", "Ovadia Yosef", "Yalkut Yosef", "Yabia Omer"],
                 ["עובדיה יוסף", "הרב עובדיה", "ילקוט יוסף", "יביע אומר"], ["Halacha Yomit"]],
};

function _pattern(english, hebrew) {
  const parts = english.map((e) => String.raw`\b` + escape(e) + String.raw`\b`);
  // Escape around the placeholder, not through it: re.escape turns "~" into
  // "\~", which would make the quote a literal bracket and match nothing.
  for (const h of hebrew) parts.push(PREFIX + h.split("~").map((p) => escape(p)).join(QUOTE_MARK) + END);
  return re(parts.join("|"));
}

export const PATTERNS = Object.fromEntries(Object.entries(NAMES).map(([name, [en, he]]) => [name, _pattern(en, he)]));
// Names that only look like a commentator's: in use "Rosh Hashanah 9a" was
// taken for the Rosh, and a right answer about the page was sent back.
export const NOT_NAMES = re(String.raw`\bRosh[ -](Ha-?)?Shanah\b|\bRosh[ -]Chodesh\b|\bRosh[ -]Hodesh\b|` +
                            String.raw`ראש[ -]ה?שנה|ראש[ -]חודש`, "i");

/** The name anywhere inside a source's own text, prefixes and all:
 *  Tosafot writes פירש"י and "הקונטרס" for Rashi. */
function _loose(english, hebrew, extra = []) {
  const parts = english.map((e) => String.raw`\b` + escape(e) + String.raw`\b`);
  for (const h of [...hebrew, ...extra]) parts.push(h.split("~").map((p) => escape(p)).join(QUOTE_MARK));
  return re(parts.join("|"));
}

export const MENTIONED = Object.fromEntries(Object.entries(NAMES).map(([name, [en, he]]) =>
  [name, _loose(en, he, name === "Rashi" ? ["קונטרס"] : [])]));
// "No Tosafot here" names no one's view; there is nothing to cite.
export const NEGATED = re(String.raw`(\b(no|not|isn'?t|aren'?t|without|nothing from)\s+(a |any |the )?|(אין|בלי|לא)\s+)$`, "i");

// `x in known_refs`, whether the caller holds a Set (as the partner does) or a list.
const has = (refs, x) => (refs instanceof Set || refs instanceof Map ? refs.has(x)
  : Array.isArray(refs) ? refs.includes(x) : Object.hasOwn(refs, x));

export class Verdict {
  constructor(text, unknown, uncited) {
    this.text = text;
    this.unknown = unknown;      // cited, but not in the pack
    this.uncited = uncited;      // named, but never cited
  }

  get ok() {
    return !truthy(this.unknown) && !truthy(this.uncited);
  }

  complaint() {
    const parts = [];
    if (truthy(this.unknown)) {
      parts.push(
        "These references are not in the material you were given, so they " +
        "cannot be used: " + sorted([...this.unknown]).join(", ") + ". Use only the refs in this prompt and this turn, " +
        "exactly as written; if what you wanted to say is not in them, say " +
        "what they do say.");
    }
    if (truthy(this.uncited)) {
      parts.push(
        "You named " + sorted([...this.uncited]).join(", ") + " without a citation. Put the [[ref]] right after the " +
        "name, or do not attribute it.");
    }
    return parts.join(" ");
  }
}

/** Whether this sentence names him with nothing behind it. */
function _floats(name, pattern, sentence, paragraph, known_refs, texts) {
  const plain = sub(CITE, " ", sentence);
  const hits = [...finditer(pattern, plain)].filter((m) => !search(NEGATED, plain.slice(0, m.start())));
  if (!hits.length) return false;
  // A name reported through a cited source is covered by that citation:
  // "the Tur [[Tur, OC 235]] brings Rashi's view against Rabbeinu Tam" stands
  // on the Tur. In use, the check threw out exactly that answer and sent a
  // useless fallback instead.
  if (findall(CITE, sentence).some((c) => has(known_refs, strip(c)))) return false;
  // So is one reported in a paragraph that ends on the source reporting him:
  // "Tosafot challenges Rashi: ... [[Tosafot on Berakhot 2a:1:1]]", when that
  // Tosafot does quote Rashi. In use, three good answers in a row were sent
  // back to be written again for exactly this.
  for (const ref of findall(CITE, paragraph)) {
    const t = texts || {};
    const body = Object.hasOwn(t, strip(ref)) ? t[strip(ref)] : null;
    if (has(known_refs, strip(ref)) && truthy(body) && search(MENTIONED[name], body)) return false;
  }
  return true;
}

/** `texts` maps refs to their text, for names reported through a source. */
export function check(text, known_refs, { texts = null } = {}) {
  const cited = findall(CITE, text).map((c) => strip(c));
  const unknown = new Set(cited.filter((c) => !has(known_refs, c)));
  const bare = sub(NOT_NAMES, " ", sub(CITE, " ", text));
  const uncited = new Set();
  let paragraphs = split(re(String.raw`\n+`), text).filter((p) => strip(p));
  if (!paragraphs.length) paragraphs = [text];
  for (const [name, pattern] of Object.entries(PATTERNS)) {
    if (!search(pattern, bare)) continue;
    const looks_like = NAMES[name][2];
    if (cited.some((c) => looks_like.some((mark) => c.includes(mark)))) continue;
    for (const paragraph of paragraphs) {
      const sentences = split(SENTENCE, paragraph).filter((s) => strip(s));
      if (sentences.some((s) => _floats(name, pattern, s, paragraph, known_refs, texts))) {
        uncited.add(name);
        break;
      }
    }
  }
  // "Tosafot HaRosh" also matches "Tosafot"; if the longer name is cited,
  // the shorter one is not a separate floating claim.
  if (uncited.has("Tosafot") && cited.some((c) => c.includes("Tosafot HaRosh")) &&
      !search(re(String.raw`\bTosafot\b(?! HaRosh)`), bare)) {
    uncited.delete("Tosafot");
  }
  return new Verdict(text, unknown, uncited);
}

/** For a transcript: keep the reference, drop the machine markers. */
export function render(text) {
  return sub(CITE, (m) => "(" + strip(m.group(1)) + ")", text);
}
