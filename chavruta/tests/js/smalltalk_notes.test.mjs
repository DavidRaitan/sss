import { fake, control } from "./harness.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as smalltalk from "../../web/lib/smalltalk.js";
import * as notes from "../../web/lib/notes.js";
import * as align from "../../web/lib/align.js";
import { search } from "../../web/lib/py.js";
import * as store from "../../web/lib/store.js";

void control;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Run Python against the same stand-in: `input` arrives as JSON on stdin, the script prints JSON. */
function py(script, input = null) {
  const out = execFileSync("python3", ["-c", script], {
    cwd: ROOT, input: JSON.stringify(input), maxBuffer: 1 << 28,
    env: { ...process.env, CHAVRUTA_SEFARIA_API: fake.sefaria,
           CHAVRUTA_NOTES: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "notes-")), "notes.jsonl") },
  });
  return JSON.parse(out.toString("utf8"));
}

// -- the Python tests, ported ---------------------------------------------------------

describe("SmallTalk", () => {
  test("test_small_talk_is_answered_without_a_model", () => {
    assert.equal(smalltalk.reply("Hey, what's up?")[0], "hello");
    assert.equal(smalltalk.reply("Okay, so I'm gonna read, okay?")[0], "reading");
    assert.equal(smalltalk.reply("Can you hear me?")[0], "hear_me");
    assert.ok(smalltalk.reply("What time is it?")[1].includes(":"));
    assert.ok(["כן, שומע אותך.", "כאן, שומע."].includes(smalltalk.reply("שומע אותי?", { language: "he" })[1]));
  });

  test("test_a_question_is_not_small_talk", () => {
    assert.equal(smalltalk.reply("Hey, what's the summary here?"), null);
    assert.equal(smalltalk.reply("Can you hear me? What does Rashi say?"), null);
    assert.equal(smalltalk.reply("so he's saying you read shema whenever you go to sleep"), null);
  });

  test("test_a_question_around_a_reading_is_answered", () => {
    const PACK = py('import json; from chavruta import sefaria; print(json.dumps(sefaria.build("Berakhot 2a")))');
    const page = new align.Page(PACK);
    const asked = align.listen(page, "Are you sure? Let me read it again. מאימתי קורין את שמע בערבית? " +
                                     "משעה שהכהנים נכנסים לאכול בתרומתן.");
    assert.equal(asked["mode"], "quoting");
    const plain = align.listen(page, "Okay, so I'm gonna read again. מאימתי קורין את שמע בערבית? " +
                                     "משעה שהכהנים נכנסים לאכול בתרומתן.");
    assert.equal(plain["mode"], "reading");   // the page's own question is not theirs
  });
});

describe("LearningAlong", () => {
  test("test_notes_by_voice", async () => {
    store.useMemory();
    assert.equal(notes.taken("Note: Rashi reads it as a third of the night"), "Rashi reads it as a third of the night");
    assert.equal(notes.taken("save this"), "");
    assert.equal(notes.taken("תרשום: רבן גמליאל חולק"), "רבן גמליאל חולק");
    assert.equal(notes.taken("Notes are important here, why?"), null);
    assert.ok(search(notes.ASK, "what did I note on this page?"));
    await notes.add("Berakhot 2a", 5, "the fence is for Shema, not the fats");
    await notes.add("Berakhot 3b", 2, "David's harp");
    assert.deepEqual((await notes.on({ ref: "Berakhot 2a" })).map((n) => n["line"]), [5]);
    assert.equal((await notes.on({ masechta: "Berakhot" })).length, 2);
    assert.ok(notes.spoken(await notes.on({ ref: "Berakhot 2a" }), { language: "en", here: "Berakhot 2a" }).includes("line 5: the fence"));
  });
});

// -- parity with the Python: the same inputs, the same answers -----------------------

const SAID = [
  // from tests/test_units.py
  "Hey, what's up?", "Okay, so I'm gonna read, okay?", "Can you hear me?", "What time is it?", "שומע אותי?",
  "Hey, what's the summary here?", "Can you hear me? What does Rashi say?",
  "so he's saying you read shema whenever you go to sleep",
  // skip
  "skip", "ok, skip it", "Next.", "enough", "that's enough!", "thats enough", "stop", "move on", "okay skip",
  "די", "דלג", "הבא", "מספיק", "תפסיק!", "skip the Meiri",
  // faster / slower
  "faster", "Can you talk a little bit faster?", "speed it up", "speed up", "speak a bit faster please", "say it faster",
  "תדבר קצת יותר מהר", "יותר מהר", "מהר יותר", "תקרא מהר", "slower", "slow down", "slow it down", "go a little slower",
  "read slower", "תדבר לאט", "קצת יותר לאט", "לאט יותר", "can you please speak a little bit slower for me now",
  // again
  "What?", "what", "huh", "sorry?", "pardon", "say that again", "Say it again please", "repeat that", "repeat yourself",
  "I didn't hear you", "I did not catch that", "I couldn't catch that", "i cant hear it", "I don't hear that",
  "come again?", "מה?", "מה", "לא שמעתי", "תחזור על זה", "תגיד שוב", "עוד פעם",
  // cant_hear / hear_me
  "I can't hear you", "I don't hear you", "אני לא שומע אותך", "Do you hear me?", "are you there?", "are you with me",
  "hello?", "אתה שומע אותי?", "אתה שומע?", "אתה שם?", "אתה איתי",
  // time
  "what's the time", "whats the time?", "מה השעה?", "מה השעה עכשיו",
  // reading
  "I'm going to read", "im gonna read now", "let me read", "hear me read", "listen to me read", "go ahead", "Go ahead.",
  "ok go ahead", "yes, go ahead!", "so go ahead", "אני קורא", "אני אקרא", "אני הולך לקרוא", "תקשיב לי", "בוא נקרא",
  "let's continue", "let's keep going", "lets go on", "let's move on", "נמשיך", "בוא נמשיך", "I'm gonna read -- מאימתי קורין",
  // thanks
  "thanks", "Okay, thank you!", "ok thanks", "thank you so much", "תודה", "תודה רבה",
  // help
  "what can I say?", "what can you do", "what do you do", "what do you know how to do", "help", "voice commands",
  "מה אפשר להגיד", "מה אתה יודע לעשות", "מה אפשר לבקש", "עזרה",
  // hello
  "hi", "hello", "yo", "good morning", "good evening", "how are you?", "how's it going", "hows it going",
  "היי", "הי", "שלום", "בוקר טוב", "ערב טוב", "מה נשמע", "מה קורה", "מה שלומך", "hey there my friend how are you",
  // filler, acknowledgement, hesitation
  "Um.", "Okay.", "okay", "right", "got it", "I see", "uh huh", "mhm", "hmm...", "אממ", "אה", "אוקיי", "הבנתי", "כן",
  "yes", "ok cool great nice alright", "so", "go ahead and", "okay okay okay okay", "yeah sure", "סבבה, הבנתי", "good",
  // never small talk
  "", "   ", "this is a long sentence of more than nine words that goes on and on",
  "so go ahead and answer", "answer the question I asked", "why?", "explain this", "תסביר לי", "למה?",
  "hey, can you tell me about Rashi", "מי אמר את זה", "where are we", "which line is it", "what time is it in Jerusalem",
  "say that again, why?", "let's continue, why?", "tell me a story", "שאלה", "איך זה עובד?", "מתי קוראים?",
  "ok what's up with Tosafot here", "hello hello hello hello", "Shabbat shalom",
];

const NOTED = [
  "Note: Rashi reads it as a third of the night", "save this", "תרשום: רבן גמליאל חולק", "Notes are important here, why?",
  "note that the mishna starts at night", "ok, note this - it's important", "So note down: three watches",
  "please make a note: the fence", "please note the time", "take a note this is big", "add a note: hello",
  "write this down", "write down", "write that down — the kohanim", "save that", "save this as a note",
  "Okay save that as a note please", "תרשום לי שזה חשוב", "תכתוב: הכהנים", "תכתוב לי", "תשמור את זה", "תשמור",
  "הערה: חכמים עשו סייג", "הערות", "הערה", "noted", "note-taking is fun", "note — the dash", "  Note:\nline one\nline two  ",
  "save these", "...Note: dots first", "okay note this", "תשמורו את זה", "note", "Note:", "so, note that",
  "what did I note on this page?", "read me my notes", "any notes on the masechta?", "my notes for everything",
  "מה רשמתי במסכת", "ההערות שלי", "מה כתבתי כאן", "יש לי הערות בכל הש״ס?", "notebook", "all tractate notes",
];

describe("Parity with the Python", () => {
  test("smalltalk.reply, acknowledges and hesitation agree with Python", () => {
    const settings = [["en", false], ["he", false], ["auto", false], ["en", true], ["auto", true], ["he", true]];
    const want = py(`
import json, sys, random, re
from chavruta import smalltalk
random.choice = lambda xs: xs[0]
d = json.load(sys.stdin)
hhmm = lambda r: None if r is None else [r[0], re.sub(r"\\d\\d:\\d\\d", "HH:MM", r[1])]
print(json.dumps({"reply": [[hhmm(smalltalk.reply(s, lang, asked)) for lang, asked in d["settings"]] for s in d["said"]],
                  "acknowledges": [smalltalk.acknowledges(s) for s in d["said"]],
                  "hesitation": [smalltalk.hesitation(s) for s in d["said"]],
                  "words": [smalltalk.words(s) for s in d["said"]],
                  "fixed": smalltalk.FIXED}))`, { said: SAID, settings });
    const random = Math.random;
    Math.random = () => 0;          // random.choice -> the first, on both sides
    let got;
    try {
      const hhmm = (r) => (r === null ? null : [r[0], r[1].replace(/\d\d:\d\d/g, "HH:MM")]);
      got = {
        reply: SAID.map((s) => settings.map(([language, asked]) => hhmm(smalltalk.reply(s, { language, asked })))),
        acknowledges: SAID.map((s) => smalltalk.acknowledges(s)),
        hesitation: SAID.map((s) => smalltalk.hesitation(s)),
        words: SAID.map((s) => smalltalk.words(s)),
        fixed: smalltalk.FIXED,
      };
    } finally {
      Math.random = random;
    }
    SAID.forEach((s, i) => {
      assert.deepEqual(got.reply[i], want.reply[i], "reply: " + s);
      assert.equal(got.acknowledges[i], want.acknowledges[i], "acknowledges: " + s);
      assert.equal(got.hesitation[i], want.hesitation[i], "hesitation: " + s);
      assert.deepEqual(got.words[i], want.words[i], "words: " + s);
    });
    assert.deepEqual(got.fixed, want.fixed);
    // Every kind is reached, and so is "not small talk".
    const kinds = new Set(got.reply.flat().map((r) => (r ? r[0] : null)));
    for (const k of ["skip", "faster", "slower", "again", "cant_hear", "hear_me", "time", "reading", "thanks", "help",
                     "hello", "filler", null]) assert.ok(kinds.has(k), String(k));
  });

  test("the other reply, when random.choice picks the last", () => {
    const want = py(`
import json, sys, random
from chavruta import smalltalk
random.choice = lambda xs: xs[-1]
print(json.dumps([smalltalk.reply(s, l) for s, l in json.load(sys.stdin)]))`,
      [["hi", "en"], ["hi", "he"], ["שלום", "auto"], ["can you hear me", "en"], ["אתה שומע אותי", "auto"], ["let me read", "he"]]);
    const random = Math.random;
    Math.random = () => 0.999999;
    try {
      assert.deepEqual([["hi", "en"], ["hi", "he"], ["שלום", "auto"], ["can you hear me", "en"], ["אתה שומע אותי", "auto"],
                        ["let me read", "he"]].map(([s, language]) => smalltalk.reply(s, { language })), want);
    } finally {
      Math.random = random;
    }
  });

  test("notes.taken, ASK and WIDE agree with Python", () => {
    const want = py(`
import json, sys
from chavruta import notes
d = json.load(sys.stdin)
print(json.dumps([[notes.taken(s), bool(notes.ASK.search(s)), bool(notes.WIDE.search(s))] for s in d]))`, NOTED);
    const got = NOTED.map((s) => [notes.taken(s), Boolean(search(notes.ASK, s)), Boolean(search(notes.WIDE, s))]);
    NOTED.forEach((s, i) => assert.deepEqual(got[i], want[i], s));
    assert.ok(got.some((g) => g[0] === null) && got.some((g) => g[0] === "") && got.some((g) => g[0]));
    assert.ok(got.some((g) => g[1]) && got.some((g) => g[2]));
  });

  test("notes.add, on and spoken agree with Python", async () => {
    const adds = [
      ["Berakhot 2a", 5, "the fence is for Shema, not the fats", "note"],
      ["Berakhot 3b", 2, "David's harp", "note"],
      ["Berakhot 2a", 0, "  a saved answer, padded  ", "answer"],
      ["Berakhot 2a", "7", "line given as text", "note"],
      ["Shabbat 30a", null, "x".repeat(1200), "note"],
      ["Berakhot 2b", 3.7, "רבן גמליאל חולק", "note"],
      ["Berakhot 2a", 9, "📝 ".repeat(600), "note"],
      ["Rosh Hashanah 9a", 1, "a two-word tractate", "note"],
      ["Berakhot 2a", 11, "ninth", "note"], ["Berakhot 2a", 12, "tenth", "note"],
    ];
    const queries = [{ ref: "Berakhot 2a" }, { masechta: "Berakhot" }, { masechta: "Rosh Hashanah" }, { ref: "Nedarim 2a" },
                     {}, { ref: null, masechta: "Shabbat" }, { ref: "Berakhot 3b", masechta: "Shabbat" }];
    const voices = [["en", "Berakhot 2a"], ["he", "Berakhot 2a"], ["en", null], ["he", null], ["en", "Berakhot 3b"]];
    const want = py(`
import json, sys
from chavruta import notes
d = json.load(sys.stdin)
added = [notes.add(ref, line, text, kind) for ref, line, text, kind in d["adds"]]
found = [notes.on(**q) for q in d["queries"]]
print(json.dumps({"added": added, "all": notes.all_notes(), "found": found,
                  "spoken": [[notes.spoken(rows, lang, here) for lang, here in d["voices"]] for rows in found]}))`,
      { adds, queries, voices });
    store.useMemory();
    const added = [];
    for (const [ref, line, text, kind] of adds) added.push(await notes.add(ref, line, text, { kind }));
    const found = [];
    for (const q of queries) found.push(await notes.on(q));
    const got = { added, all: await notes.all_notes(), found,
                  spoken: found.map((rows) => voices.map(([language, here]) => notes.spoken(rows, { language, here }))) };
    // The minute a note was taken is the clock's, not the port's: same shape, then set aside.
    const minute = (rows) => rows.map((r) => {
      assert.match(r.at, /^\d{4}-\d\d-\d\d \d\d:\d\d$/);
      const { at, ...rest } = r;
      return rest;
    });
    assert.deepEqual(minute(got.added), minute(want.added));
    assert.deepEqual(minute(got.all), minute(want.all));
    assert.deepEqual(got.found.map(minute), want.found.map(minute));
    assert.deepEqual(got.spoken, want.spoken);
    // In the log, each is a row of kind "note".
    const rows = await store.log.list({ kinds: ["note"] });
    assert.equal(rows.length, adds.length);
  });

  test("notes.spoken agrees with Python on empty and single lists", () => {
    const lists = [[], [{ ref: "Berakhot 2a", line: 1, text: "one", kind: "note", at: "2026-10-02 10:00" }]];
    const want = py(`
import json, sys
from chavruta import notes
print(json.dumps([[notes.spoken(rows, lang, here) for lang in ("en", "he", "auto") for here in (None, "Berakhot 2a")]
                  for rows in json.load(sys.stdin)]))`, lists);
    assert.deepEqual(lists.map((rows) => ["en", "he", "auto"].flatMap((language) =>
      [null, "Berakhot 2a"].map((here) => notes.spoken(rows, { language, here })))), want);
  });
});
