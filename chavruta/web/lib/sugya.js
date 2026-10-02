// Read the argument structure a commentary already states about itself.
//
// The sugya map -- where the question is posed, which move is the hard one, who
// disagrees with whom, what the page leans on elsewhere -- looked like it had to
// be generated. Mostly it does not. Tosafot says all of it out loud, in fixed
// phrases that barely vary across shas:
//
//     פירש רש"י …      here is the position being discussed
//     תימה / ועוד קשה   here is what is wrong with it
//     ויש לומר          here is the answer
//     לכן פירש ר"ת      here is the alternative
//     על כן אומר ר"י    here is where it lands
//     (לקמן דף ה.)      here is what it depends on elsewhere
//
// Extracting those beats them being invented. What comes out is retrieved
// structure: it can be shown to the learner with the words that produced it, it
// can be checked, and when the parse fails it fails visibly instead of turning
// into a confident paraphrase. Anything this misses is left for a model to
// propose, marked as generated, and never merged in silently.
//
// Ported from chavruta/sugya.py.

import { re, match, search, sub, finditer, findall, strip, sorted, or } from "./py.js";

// Hebrew abbreviations and elisions are written with ASCII quotes, gershayim
// and geresh interchangeably, so every marker has to accept all of them. The
// patterns below spell a quote as ~ and this expands it, which also keeps the
// class from nesting inside another character class.
export const QUOTE = "[\"״″'׳]";


function _p(pattern) {
  return re(pattern.replaceAll("~", QUOTE));
}


// A comment opens with its dibur hamatchil -- the words it hangs off -- then a
// dash. Those words are quoted gemara, not the commentator's argument, so they
// are stripped before anything here looks for a move.
export const OPENING = re(String.raw`^.{0,80}?\s[–—-]\s+`);

// Ordered: the first pattern matching a clause decides its role, so specific
// phrasings come before general ones. Each is anchored to the clause opening,
// because these markers announce a move -- they do not appear mid-sentence.
// (Unanchored, "תימא לפירושו" reads as a position rather than the objection
// to one, which inverts the argument.)
export const MOVES = [
  ["position", _p(String.raw`(?:פ~?ר~?ש|פירש|פי~|פירוש)\s*(?:רש~י|ר~ת|ר~י|הקונטרס)?`),
    "states the reading under discussion"],
  ["alternative", _p(String.raw`(?:לכן|ולכן|על כן|ע~כ|אלא)\s*(?:פי|פירש|נראה|אומר|אומרים)`),
    "offers a different reading"],
  ["difficulty", _p(String.raw`(?:ועוד קשה|ועוד|תימה|תימא|וקשה|קשה|קשיא|ואם תאמר|וא~ת|ואי תימא)`),
    "raises a difficulty"],
  ["answer", _p(String.raw`(?:ויש לומר|יש לומר|וי~ל|ותירץ|ומתרץ|ותירצו)`),
    "answers it"],
  ["conclusion", _p(String.raw`(?:ומכאן נראה|והלכך|לפיכך|הלכך|ומכאן|נמצא)`),
    "draws the practical conclusion"],
];

// "(לקמן ברכות דף ס:)" / "(דף ג.)" -- what this page leans on elsewhere.
export const CITATION = re(String.raw`\(([^()]{0,60}?דף[^()]{0,20}?)\)`);
// Who is named. Deliberately narrow: a name we cannot resolve is worse than none.
export const NAMED = _p(String.raw`(רש~י|ר~ת|ר~י|ריב~א|הרי~ף|הרמב~ם|רבינו תם|ר~ יוחנן|רבי יוחנן` +
  String.raw`|ריב~ל|רבי יהושע בן לוי|רבי יהודה|רבנן|הקונטרס|הירושלמי)`);

// Clauses end at a full stop; the printed colon closes a comment.
export const CLAUSE = re(String.raw`[^.:]+[.:]?`);


/** Walk a comment clause by clause, labelling the ones that declare a move. */
export function moves(body) {
  const found = [];
  let offset = 0;
  const opening = match(OPENING, body);
  if (opening) {
    [offset, body] = [opening.end(), body.slice(opening.end())];
  }
  for (const m of finditer(CLAUSE, body)) {
    const clause = strip(m.group(0));
    if (clause.length < 8) {
      continue;
    }
    for (const [kind, pattern, gloss] of MOVES) {
      const hit = match(pattern, clause);
      if (!hit) {
        continue;
      }
      found.push({
        "kind": kind,
        "gloss": gloss,
        // The words that produced the label, so a learner can check it.
        "marker": hit.group(0),
        "at": offset + m.start(),
        "text": clause,
        "names": sorted([...new Set(findall(NAMED, clause))]),
        "by": speaker(kind, clause),
      });
      break;
    }
  }
  return found;
}


// Who a reading belongs to, when the clause says so in its opening words:
// "פי' רש"י", "לכן פי' ר"ת", "על כן אומר ר"י". A Tosafot is often three voices --
// Rashi's reading, Rabbeinu Tam's, the Ri's -- and they must not be run together.
export const SPEAKERS = [[_p(String.raw`רש~י|הקונטרס`), "רש״י"], [_p(String.raw`ר~ת|רבינו תם`), "ר״ת"], [_p(String.raw`ר~י(?!ף)`), "ר״י"],
  [_p(String.raw`ריב~א`), "ריב״א"], [_p(String.raw`ר~ח|רבינו חננאל`), "ר״ח"]];


export function speaker(kind, clause) {
  if (!["position", "alternative", "conclusion"].includes(kind)) {
    return null;
  }
  const head = clause.slice(0, 30);
  for (const [pattern, name] of SPEAKERS) {
    if (search(pattern, head)) {
      return name;
    }
  }
  return null;
}


/** Where the comment sends you, in its own words. */
export function citations(body) {
  return sorted([...new Set([...finditer(CITATION, body)].map((m) => strip(m.group(1))))]);
}


/** The argument shape of one comment, or null if it does not declare one. */
export function structure(ref, body) {
  const found = moves(body);
  if (!found.length) {
    return null;
  }
  const counts = {};
  for (const move of found) {
    counts[move.kind] = (counts[move.kind] ?? 0) + 1;
  }
  return {
    "ref": ref,
    "moves": found,
    "counts": counts,
    "cites": citations(body),
    "names": sorted([...new Set(found.flatMap((m) => m.names))]),
    // A comment that states a position and then attacks it is a machlokes,
    // and that is the thing worth volunteering to the learner unprompted.
    "is_machlokes": (counts.difficulty ?? 0) >= 1 && (
      (counts.position ?? 0) >= 1 || (counts.alternative ?? 0) >= 1),
  };
}


/** One line a person can read, built only from what was matched. */
export function summarize(struct) {
  if (!struct) {
    return "no declared structure";
  }
  const order = struct.moves.map((m) => m.kind).join(" → ");
  const who = or(struct.names.join(", "), "unattributed");
  return `${order} | ${who} | cites: ${or(struct.cites.join(", "), "none")}`;
}


// --- where one unit of learning ends and the next begins ----------------------

// The daf announces its own structure. These openers are how a printed gemara
// says a new unit has started, and they are what a person means by "let's finish
// this piece" -- not a line number. Matched against text with the nikud removed,
// because the pointing varies and the consonants do not.
export const NIKUD = re(String.raw`[֑-ׇ]`);

export const OPENERS = [
  ["gemara",    String.raw`^גמ[׳']`, "גמרא"],
  ["mishna",    String.raw`^מתני[׳']|^מתניתין`, "משנה"],
  ["baraita",   String.raw`^תנו רבנן|^ת[\"״]ר\b`, "תנו רבנן"],
  ["baraita",   String.raw`^תניא\b`, "תניא"],
  ["statement", String.raw`^איתמר\b`, "איתמר"],
  ["objection", String.raw`^מיתיבי\b`, "מיתיבי"],
  ["question",  String.raw`^איבעיא להו`, "איבעיא להו"],
  ["said",      String.raw`^אמר מר\b`, "אמר מר"],
].map(([kind, pat, label]) => [kind, re(pat), label]);


/** The consonants only, so pointing never decides whether a marker matches. */
export function bare(text) {
  return strip(sub(NIKUD, "", text || ""));
}


/** If this segment starts a new unit, say which kind and how it is named. */
export function opener(text) {
  const head = bare(text).slice(0, 24);
  for (const [kind, pattern, label] of OPENERS) {
    if (search(pattern, head)) {
      return { "kind": kind, "label": label };
    }
  }
  return null;
}


/** Split an amud into the units a learner would start and stop on.
 *
 * Whatever precedes the first marker is its own section: an amud usually
 * carries on a sugya from the page before, and the mishna at the head of a
 * perek is not labelled -- the גמרא that follows it is what marks it.
 */
export function sections(segments) {
  const found = [];
  let current = null;
  for (const seg of segments) {
    const mark = opener("he" in seg ? seg.he : "");
    if (mark || current === null) {
      current = {
        "kind": mark ? mark.kind : "opening",
        "label": mark ? mark.label : "",
        "from": seg.n, "to": seg.n,
      };
      found.push(current);
    } else {
      current.to = seg.n;
    }
  }
  // An unlabelled opening that runs into the gemara marker is the mishna.
  if (found.length > 1 && found[0].kind === "opening" && found[1].kind === "gemara") {
    Object.assign(found[0], { kind: "mishna", label: "משנה" });
  } else if (found.length && found[0].kind === "opening") {
    found[0].label = "המשך";
  }
  return found;
}
