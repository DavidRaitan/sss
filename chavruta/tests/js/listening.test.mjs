import { fake, control } from "./harness.mjs";
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as align from "../../web/lib/align.js";
import * as ground from "../../web/lib/ground.js";

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

// The pack builder is ported elsewhere; the Berakhot 2a pack is built by the Python code against the same fake.
const PACK = py('import json; from chavruta import sefaria; print(json.dumps(sefaria.build("Berakhot 2a")))');

describe("Following", () => {
  const page = new align.Page(PACK);
  const listen = (text) => align.listen(page, text);

  test("test_reading_is_followed", () => {
    const r = listen("מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן");
    assert.deepEqual([r["mode"], r["line"], r["stopped_mid_clause"]], ["reading", 1, false]);
  });

  test("test_asr_spelling_does_not_break_it", () => {
    assert.equal(listen("מאימתי קורים את שמע בערבים משעה שהכהנים נכנסים לאכל")["line"], 1);
  });

  test("test_stopping_mid_clause_is_noticed", () => {
    const r = listen("עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד");
    assert.ok(r["stopped_mid_clause"]);
    assert.deepEqual([r["line"], r["words_left_in_clause"]], [3, 3]);
  });

  test("test_talking_is_not_reading", () => {
    assert.equal(listen("so he's saying you read shema before bed")["mode"], "talking");
  });

  test("test_an_english_sentence_quoting_aramaic_points_at_its_line", () => {
    const r = listen("so when he says תנא אקרא קאי he means the tanna stands on the verse");
    assert.deepEqual([r["mode"], r["line"]], ["quoting", 8]);
  });
});

describe("Grounding", () => {
  const known = new Set(["Rashi on Berakhot 2a:1:2", "Tosafot on Berakhot 2a:1:1", "Mishneh Torah, Reading the Shema 1:9"]);
  const ok = (text) => ground.check(text, known).ok;

  test("test_cited", () => {
    assert.ok(ok("רש״י [[Rashi on Berakhot 2a:1:2]] אומר שזה שליש הלילה"));
    assert.ok(ok("Tosafot [[Tosafot on Berakhot 2a:1:1]] asks four questions."));
    assert.ok(ok("הרמב״ם [[Mishneh Torah, Reading the Shema 1:9]] פוסק כחכמים"));
  });

  test("test_floating_names_in_hebrew", () => {
    for (const text of ["רש״י אומר שזה שליש הלילה", "ולפי תוספות זה לא מסתדר", 'והרשב"א חולק', "ולרש״י זה ברור"]) {
      assert.equal(ok(text), false, text);
    }
  });

  test("test_invented_reference", () => {
    assert.equal(ok("Rashi [[Rashi on Berakhot 9a:1:1]] says so"), false);
  });

  test("test_words_that_merely_contain_a_name", () => {
    assert.ok(ok("המאירים והרנים שמרים"));
  });
});

// -- parity with the Python: the same inputs, the same answers -----------------------

const UTTERANCES = [
  "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן",
  "מאימתי קורים את שמע בערבים משעה שהכהנים נכנסים לאכל",
  "עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד",
  "so he's saying you read shema before bed",
  "so when he says תנא אקרא קאי he means the tanna stands on the verse",
  "הם מוכרים עד חצות",
  "Are you sure? Let me read it again. מאימתי קורין את שמע בערבית? משעה שהכהנים נכנסים לאכול בתרומתן.",
  "Okay, so I'm gonna read again. מאימתי קורין את שמע בערבית? משעה שהכהנים נכנסים לאכול בתרומתן.",
  "מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו את שמע",
  "מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו",
  "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול במעשר",
  "עד סוף האשמורה השנייה",
  "תנא היכא קאי דקתני מאימתי ואני חושב שזה מעניין מאוד באמת",
  "אני לא מבין למה הוא אומר את זה בכלל",
  "מה הפירוש של זה? אני לא מבין מה הוא רוצה",
  "ואי בעית אימא יליף מברייתו של עולם דכתיב ויהי ערב ויהי בקר יום אחד",
  "ואי בעית אימא יליף מברייתו עולם דכתיב ויהי ערב ויהי בוקר יום",
  "תנא פתח בערבית והדר תני בשחרית עד דקאי בשחרית פריש מילי דשחרית",
  "אמר מר משעה שהכהנים נכנסים לאכול בתרומתן מכדי כהנים אימת קא אכלי תרומה",
  "מלתא אגב אורחיה קמשמע לן כהנים אימת קא אכלי בתרומה משעת צאת הכוכבים",
  "וממאי דהאי ובא השמש ביאת השמש והאי וטהר טהר יומא",
  "the gemara asks מאי שנא דתני בערבית ברישא why not start with the morning",
  "What does Rashi say about עד חצות here?",
  "",
  "מְאֵימָתַי קוֹרִין אֶת שְׁמַע בְּעַרְבִין מִשָּׁעָה שֶׁהַכֹּהֲנִים",
  "הקטר חלבים ואברים מצותן עד שיעלה עמוד השחר וכל הנאכלים ליום אחד מצותן עד שיעלה",
  "רבן גמליאל אומר עד שיעלה עמוד השחר. so he disagrees with both, right?",
  "אי הכי סיפא דקתני בשחר מברך שתים לפניה ואחת לאחריה בערב מברך שתים לפניה ושתים לאחריה לתני דערבית ברישא",
  "ותו מאי שנא דתני בערבית ברישא לתני דשחרית ברישא",
  "בלה בלה בלה שלום עליכם מה נשמע",
  "וחכמים אומרים עד חצות",
  "מעשה ובאו בניו המשתה אמרו לו לא קרינו את שמע אמר להם",
  "מאימתי קורין את שמע בלילה בערבין משעה שהכהנים נכנסים לאכול בתרומתן",
  "הקטר חלבים ואברים מצותן עד שיעלה השחר וכל הנאכלים ביום אחד מצותן עד",
  "דברי רבי אליעזר וחכמים אומרים עד חצות ורבן גמליאל אומר עד שיעלה עמוד השחר ומה זה אומר לנו על הזמן",
];

const UNSPOKEN = [
  ["It says מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה, so the mishna starts at night.", {}],
  ["The mishna: «מאימתי קורין את שמע בערבין? משעה שהכהנים נכנסים לאכול בתרומתן.»", {}],
  ["Short quote: «עד חצות» is the sages' fence.", {}],
  ["מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו את שמע אמר להם אם לא עלה עמוד השחר חייבין אתם לקרות", {}],
  ["מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו את שמע", { run: 5, keep: 2 }],
  ["תנא אקרא קאי דכתיב בשכבך ובקומך והכי קתני זמן קריאת שמע דשכיבה אימת", { run: 6, keep: 3 }],
  ["", {}],
  ["nothing from the page at all here", {}],
];

const GROUNDED = [
  "רש״י [[Rashi on Berakhot 2a:1:2]] אומר שזה שליש הלילה",
  "Tosafot [[Tosafot on Berakhot 2a:1:1]] asks four questions.",
  "הרמב״ם [[Mishneh Torah, Reading the Shema 1:9]] פוסק כחכמים",
  "רש״י אומר שזה שליש הלילה",
  "ולפי תוספות זה לא מסתדר",
  'והרשב"א חולק',
  "Rashi [[Rashi on Berakhot 9a:1:1]] says so",
  "המאירים והרנים שמרים",
  "There is no Tosafot here on this line.",
  "Tosafot challenges Rashi: the watch is a third. [[Tosafot on Berakhot 2a:1:1]]",
  "Tosafot challenges Rashi here.\n\nThe Meiri adds a point. [[Meiri on Berakhot 2a:1]]",
  "The Tur [[Tur, Orach Chayim 235]] brings Rashi's view against Rabbeinu Tam.",
  "Tosafot HaRosh [[Tosafot HaRosh on Berakhot 2a:1]] agrees with Tosafot.",
  "See Rosh Hashanah 9a for more; the Rosh himself is silent.",
  "Rosh Hashanah is a different case.",
  "The Rambam and the Shulchan Arukh both rule like the sages. [[Mishneh Torah, Reading the Shema 1:9]]",
  "Maimonides says so. Rav Ovadia Yosef too.",
  "אין רש״י כאן. ולפי הרמב״ם [[Mishneh Torah, Reading the Shema 1:9]] זה ברור.",
  "Rashi says [[Rashi on Berakhot 2a:1:2]]: the watch.\nTosafot asks.\n[[Zevachim 3a]]",
];
const KNOWN = ["Rashi on Berakhot 2a:1:2", "Tosafot on Berakhot 2a:1:1", "Mishneh Torah, Reading the Shema 1:9",
               "Tur, Orach Chayim 235"];
const TEXTS = { "Tosafot on Berakhot 2a:1:1": 'פירש"י דהיינו שליש הלילה', "Rashi on Berakhot 2a:1:2": "עד סוף האשמורה" };

describe("Parity with the Python", () => {
  const page = new align.Page(PACK);

  test("listen, locate, differences and describe agree with Python", () => {
    const want = py(`
import json, sys
from chavruta import align
d = json.load(sys.stdin)
page = align.Page(d["pack"])
out = []
for t in d["said"]:
    hit = page.locate(t)
    slips = align.differences(page, hit) if hit else None
    out.append({"listen": align.listen(page, t), "locate": hit, "slips": slips,
                "describe": align.describe(slips) if slips is not None else None,
                "share": align.hebrew_share(t), "words": align.words(t), "tokens": align.tokens(t)})
print(json.dumps(out))`, { pack: PACK, said: UTTERANCES });
    const got = UTTERANCES.map((t) => {
      const hit = page.locate(t);
      const slips = hit ? align.differences(page, hit) : null;
      return { listen: align.listen(page, t), locate: hit, slips,
               describe: slips !== null ? align.describe(slips) : null,
               share: align.hebrew_share(t), words: align.words(t), tokens: align.tokens(t) };
    });
    assert.equal(got.length, want.length);
    got.forEach((g, i) => assert.deepEqual(g, want[i], UTTERANCES[i]));
    // The set covers every mode, and slips of each kind.
    const modes = new Set(got.map((g) => g.listen.mode));
    assert.deepEqual([...modes].sort(), ["quoting", "reading", "talking"]);
    const kinds = new Set(got.flatMap((g) => Object.keys(g.slips || {})));
    for (const k of ["swapped", "skipped", "added", "after"]) assert.ok(kinds.has(k), k);
  });

  test("describe agrees with Python on hand-made slips", () => {
    const slips = [
      {}, { swapped: [["מעשר", "בתרומתן"]] }, { skipped: ["האשמורה", "הראשונה"] }, { added: ["בכלל"] },
      { after: "ואני חושב שזה" },
      { swapped: [["א", "ב"], ["ג", "ד"]], skipped: ["ה"], added: ["ו", "ז"], after: "ח ט" },
      { swapped: [], skipped: [], added: [], after: "" },
    ];
    const want = py(`
import json, sys
from chavruta import align
print(json.dumps([align.describe(s) for s in json.load(sys.stdin)]))`, slips);
    assert.deepEqual(slips.map((s) => align.describe(s)), want);
  });

  test("the page and its similarity agree with Python", () => {
    const pairs = [["קורין", "קורים"], ["בערבין", "בערבית"], ["מעשר", "בתרומתן"], ["השנייה", "הראשונה"],
                   ["קוראים", "קורין"], ["אבג", "אבג"], ["אבגדה", "אגבדה"], ["שמע", "שמעון"], ["א", "ב"]];
    const want = py(`
import json, sys
from difflib import SequenceMatcher
from chavruta import align
d = json.load(sys.stdin)
page = align.Page(d["pack"])
print(json.dumps({"words": page.words, "where": page.where, "at": page.at, "surface": page.surface,
                  "sim": [page.sim(a, b) for a, b in d["pairs"]],
                  "ratio": [SequenceMatcher(None, a, b).ratio() for a, b in d["pairs"] + d["more"]],
                  "light": sorted(align.LIGHT), "grams": len(page.grams(3))}))`,
      { pack: PACK, pairs, more: [["abxcd", "abcd"], ["", ""], ["a".repeat(250) + "b", "ab".repeat(130)], ["kitten", "sitting"]] });
    assert.deepEqual(
      { words: page.words, where: page.where, at: page.at, surface: page.surface,
        sim: pairs.map(([a, b]) => page.sim(a, b)),
        ratio: [...pairs, ["abxcd", "abcd"], ["", ""], ["a".repeat(250) + "b", "ab".repeat(130)], ["kitten", "sitting"]]
          .map(([a, b]) => new align.SequenceMatcher(null, a, b).ratio()),
        light: [...align.LIGHT].sort(), grams: page.grams(3).size },
      want);
  });

  test("unspeak agrees with Python", () => {
    const want = py(`
import json, sys
from chavruta import align
d = json.load(sys.stdin)
page = align.Page(d["pack"])
print(json.dumps([align.unspeak(t, page, **kw) for t, kw in d["texts"]]))`, { pack: PACK, texts: UNSPOKEN });
    const got = UNSPOKEN.map(([t, kw]) => align.unspeak(t, page, kw));
    assert.deepEqual(got, want);
    assert.ok(got[0].includes("…"));
    assert.ok(!got[2].includes("…"));
  });

  test("ground.check and render agree with Python", () => {
    const want = py(`
import json, sys
from chavruta import ground
d = json.load(sys.stdin)
out = []
for t in d["texts"]:
    for texts in (None, d["bodies"]):
        v = ground.check(t, set(d["known"]), texts)
        out.append({"ok": v.ok, "unknown": sorted(v.unknown), "uncited": sorted(v.uncited),
                    "complaint": v.complaint(), "render": ground.render(t)})
print(json.dumps(out))`, { texts: GROUNDED, known: KNOWN, bodies: TEXTS });
    const got = [];
    for (const t of GROUNDED) {
      for (const texts of [null, TEXTS]) {
        const v = ground.check(t, new Set(KNOWN), { texts });
        got.push({ ok: v.ok, unknown: [...v.unknown].sort(), uncited: [...v.uncited].sort(),
                   complaint: v.complaint(), render: ground.render(t) });
      }
    }
    got.forEach((g, i) => assert.deepEqual(g, want[i], GROUNDED[Math.floor(i / 2)]));
    assert.ok(got.some((g) => g.ok) && got.some((g) => !g.ok));
  });
});
