// The learner's own notes, pinned to a line.
//
// "Note: Rashi here reads the watch as a third of the night." "Save this." "What
// did I note on this perek?" -- said aloud mid-sitting, kept on disk, one line of
// JSON each, and shown as 📝 on the line they belong to.
//
// In the browser "on disk" is store.log: each note is a row of kind "note"
// (Python's notes.jsonl, CHAVRUTA_NOTES and its lock have no counterpart here).
// The note's own kind ("note", or "answer" for a saved answer) is kept in the
// row as `note_kind`, since the log's `kind` names the row; all_notes() gives
// back the entries exactly as Python wrote them: {ref, line, text, kind, at}.

import { re, match, strip, rsplit, fmt, truthy, or } from "./py.js";
import * as store from "./store.js";

// "note: ...", "save this", "remember that ..." -- and in Hebrew.
export const TAKE = re(String.raw`^\W*(?:(?:ok(?:ay)?|so),?\s+)?(?:(?:please\s+)?(?:make a |take a |add a )?note(?: that| this| down)?|` +
                       String.raw`write (?:this |that )?down|save (?:this|that)(?: as a note)?|` +
                       String.raw`תרשום(?: לי)?|תכתוב(?: לי)?|תשמור(?: את זה)?|הערה)(?![\wא-ת])[\s:,\-–—]*(.*)$`,
                       "is");
export const ASK = re(String.raw`\b(my notes|what did i (note|write|save)|read (me )?my notes|any notes)\b|` +
                      String.raw`ההערות שלי|מה רשמתי|מה כתבתי|מה שמרתי|יש לי הערות`, "i");
export const WIDE = re(String.raw`\b(masechta|tractate|everything|all)\b|במסכת|בכל|כל ההערות`, "i");


/** What they asked to note ("" = save the last answer), or null if this is not a note. */
export function taken(said) {
  const m = match(TAKE, strip(said));
  if (!m) return null;
  return strip(m.group(1));
}

export async function add(ref, line, text, { kind = "note" } = {}) {
  const entry = { "ref": ref, "line": Math.trunc(Number(or(line, 1))), "text": Array.from(strip(text)).slice(0, 1000).join(""),
                  "kind": kind, "at": store.stamp().slice(0, 16) };   // time.strftime("%Y-%m-%d %H:%M")
  await store.log.add("note", { "ref": entry.ref, "line": entry.line, "text": entry.text, "note_kind": entry.kind, "at": entry.at });
  return entry;
}

export async function all_notes() {
  let rows;
  try {
    rows = (await store.log.list({ kinds: ["note"] })).map((r) => (
      { "ref": r.ref, "line": r.line, "text": r.text, "kind": r.note_kind ?? "note", "at": r.at }));
  } catch (e) {
    return [];
  }
  return rows;
}

/** Notes on one amud, or on a whole tractate, in page order. */
export async function on({ ref = null, masechta = null } = {}) {
  let rows = await all_notes();
  if (ref) {
    rows = rows.filter((r) => r["ref"] === ref);
  } else if (masechta) {
    rows = rows.filter((r) => rsplit(r["ref"], " ", 1)[0] === masechta);
  }
  return rows;
}

/** Notes read back in a few sentences. */
export function spoken(rows, { language = "en", here = null } = {}) {
  const he = language === "he";
  if (!truthy(rows)) return he ? "אין לך הערות כאן עדיין." : "You have no notes here yet.";
  const out = [];
  for (const r of rows.slice(-8)) {
    const where = r["ref"] === here ? fmt("שורה %d", r["line"]) : (he ? fmt("%s שורה %d", r["ref"], r["line"])
                                                                     : fmt("%s line %d", r["ref"], r["line"]));
    out.push(fmt("%s: %s", he ? where : where.replaceAll("שורה", "line"), r["text"]));
  }
  const lead = he ? fmt("יש לך %d הערות. ", rows.length) : fmt("You have %d note%s. ", rows.length, rows.length === 1 ? "" : "s");
  return lead + out.join(" · ");
}
