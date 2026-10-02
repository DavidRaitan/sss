import { fake, control } from "./harness.mjs";
import { ROOT_DIR } from "./harness.mjs";
import { describe, test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { config } from "../../web/lib/net.js";
import * as store from "../../web/lib/store.js";
import { sum } from "../../web/lib/py.js";
import * as sefaria from "../../web/lib/sefaria.js";
import * as who from "../../web/lib/commentators.js";
import { Pack } from "../../web/lib/pack.js";
import { LLM } from "../../web/lib/llm.js";
import * as ground from "../../web/lib/ground.js";
import * as smalltalk from "../../web/lib/smalltalk.js";
import * as retrieve from "../../web/lib/retrieve.js";
import * as library from "../../web/lib/library.js";
import * as review from "../../web/lib/review.js";
import * as daily from "../../web/lib/daily.js";

void control;
const PACK = await sefaria.build("Berakhot 2a");
const PACK_2B = await sefaria.build("Berakhot 2b");
// Python's `job in jobs`, for tuples.
const has = (jobs, job) => jobs.some((j) => JSON.stringify(j) === JSON.stringify(job));
const plan_jobs = async (pack, n, route) => (await retrieve.plan(pack, n, route)).map(([job]) => job);


describe("Routing", () => {
  const pack = new Pack(PACK);

  test("test_spoken_names", () => {
    const present = new Set(pack.commentators());
    for (const [spoken, want] of [["Rashba", "Rashba"], ['רשב"א', "Rashba"], ["Tosfos", "Tosafot"], ["Nonsense", null]]) {
      assert.equal(retrieve._canonical(spoken, present), want);
    }
  });

  test("test_nothing_extra_by_default", () => {
    assert.deepEqual(retrieve.extras(pack, 1, { "kind": "meaning" }, { depth: "daf" }), []);
  });

  test("test_naming_a_rishon_brings_him", () => {
    const got = retrieve.extras(pack, 3, { "kind": "logic", "names": ["Rashba"] }, { depth: "daf" });
    assert.ok(got.some(([name]) => name === "Rashba"));
  });

  test("test_halacha_brings_the_halachic_sources", () => {
    const got = new Set(retrieve.extras(pack, 1, { "kind": "halacha" }, { depth: "daf" }).map(([name]) => name));
    assert.ok(["Rif", "Meiri"].some((n) => got.has(n)));
  });

  test("test_halacha_opens_where_the_meiri_rules_not_where_he_starts", () => {
    const refs = retrieve.extras(pack, 1, { "kind": "halacha" }, { depth: "daf" }).map(([, e]) => e.ref);
    assert.ok(refs.includes("Meiri on Berakhot 2a:2"));       // "ולענין פסק הלכה"
    assert.ok(!refs.includes("Meiri on Berakhot 2a:1"));
    assert.ok(refs.some((r) => r.startsWith("Rosh on Berakhot")));  // hung on line 12
  });

  test("test_a_mic_check_opens_nothing_whatever_the_depth", async () => {
    assert.deepEqual(retrieve.extras(pack, 1, { "kind": "ping" }, { depth: "rishonim" }), []);
    assert.deepEqual(await retrieve.plan(pack, 1, { "kind": "ping" }), []);
  });

  test("test_halacha_plans_the_codes_from_the_ein_mishpat", async () => {
    const jobs = await plan_jobs(pack, 1, { "kind": "halacha", "names": [] });
    assert.ok(has(jobs, ["text", "Tur, Orach Chayim 235"]));
    assert.ok(has(jobs, ["text", "Shulchan Arukh, Orach Chayim 235:1"]));
    assert.ok(has(jobs, ["text", "Mishneh Torah, Reading the Shema 1:9"]));
    assert.ok(has(jobs, ["follow", "Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"]));
  });

  test("test_a_rishon_off_the_page_is_reached_through_the_rif", async () => {
    const jobs = await plan_jobs(pack, 1, { "kind": "meaning", "names": ["Rabbeinu Yonah"] });
    assert.deepEqual(jobs, [["follow", "Rif Berakhot 1a:1", "Rabbeinu Yonah"]]);
    const [found] = await library.gather(jobs);
    assert.equal(found[0][0], "Rabbeinu Yonah");
  });
});


describe("Library", () => {
  test("test_the_mishnah_berurah_on_this_seif_only", async () => {
    const got = await library.follow("Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah");
    const refs = got.map(([, e]) => e.ref);
    assert.equal(refs[0], "Mishnah Berurah 235:1");
    assert.equal(refs.length, 15);          // not 233:5 or 90:32, which quote it
    assert.ok(refs.every((r) => r.startsWith("Mishnah Berurah 235:")));
  });

  test("test_the_rema_comes_inside_the_shulchan_arukh", async () => {
    assert.ok((await library.text("Shulchan Arukh, Orach Chayim 235:1")).he.includes("הגה"));
  });

  test("test_names_as_people_say_them", () => {
    assert.equal(library.name_of("Tur, Orach Chayim 235"), "Tur");
    assert.equal(library.name_of("Mishnah Berurah 235:4"), "Mishnah Berurah");
    assert.equal(library.name_of("Rabbeinu Yonah on Berakhot 1a:1"), "Rabbeinu Yonah");
  });
});


describe("FourthSitting", () => {
  const pack = new Pack(PACK);

  test("test_the_meiri_is_one_voice_not_the_default", () => {
    const got = retrieve.extras(pack, 1, { "kind": "meaning", "names": [] }, { depth: "acharonim" });
    const names = got.map(([n]) => n);
    assert.ok(got.length <= 3);
    assert.ok(names.filter((n) => n === "Meiri").length <= 1);
    const halacha = retrieve.extras(pack, 1, { "kind": "halacha", "names": [] }, { depth: "acharonim" }).map(([n]) => n);
    assert.equal(halacha.filter((n) => n === "Meiri").length, 1);
  });

  test("test_who_was_just_cited_goes_to_the_back", () => {
    const got = retrieve.extras(pack, 1, { "kind": "meaning", "names": [], "avoid": ["Meiri"] }, { depth: "rishonim" })
      .map(([n]) => n);
    assert.ok(!got.includes("Meiri"));
  });

  test("test_asking_it_to_answer_is_not_small_talk", () => {
    for (const said of ["So go ahead and answer.", "Answer the question I asked you.", "Yeah, so answer."]) {
      assert.equal(smalltalk.reply(said), null, said);
    }
    assert.equal(smalltalk.reply("What?")[0], "again");
    assert.equal(smalltalk.reply("No, I didn't hear you.")[0], "again");
  });

  test("test_a_name_reported_through_a_cited_source_is_covered", () => {
    const known = new Set(["Tur, Orach Chayim 235"]);
    const text = "The Tur [[Tur, Orach Chayim 235]] brings Rashi's view against Rabbeinu Tam's defense.";
    assert.ok(ground.check(text, known).ok);
    assert.ok(!ground.check("Rashi says so. The Tur [[Tur, Orach Chayim 235]] agrees.", known).ok);
  });

  test("test_tonight_in_real_numbers", async () => {
    const jobs = await plan_jobs(pack, 1, { "kind": "halacha", "names": [], "said": "give me numbers, summer and winter" });
    assert.equal(jobs.filter((j) => j[0] === "zmanim").length, 3);
    const entry = await library.zmanim("2026-09-28");
    assert.ok(entry.he.includes("midnight (chatzot halayla): 2026-09-28 23:51"));
    assert.ok(entry.he.includes("dawn (alot hashachar): 2026-09-29 05:04"));
  });
});


describe("Shelf", () => {
  // The map of the sources: which kind of work answers which kind of question.
  const pack = new Pack(PACK);
  const near = (kind, n, names = []) =>
    retrieve.extras(pack, n, { "kind": kind, "names": [...names] }, { depth: "daf" }).map(([name]) => name);

  test("test_a_question_on_tosafot_goes_to_its_explainers", () => {
    const got = near("on_commentary", 1, ["Tosafot"]);
    assert.ok(got.length);
    const allowed = new Set(["Tosafot HaRosh", "Gilyon HaShas", "Penei Yehoshua",
                             "Chiddushei Rabbi Akiva Eiger", "Chidushei Halachot"]);
    assert.ok(got.every((n) => allowed.has(n)), String(got));
  });

  test("test_a_contradiction_goes_to_rabbi_akiva_eiger_first", () => {
    const got = near("conflict", 1);
    assert.ok(["Gilyon HaShas", "Chiddushei Rabbi Akiva Eiger", "Penei Yehoshua", "Petach Einayim"].includes(got[0]));
    assert.ok(got.length <= 3);
  });

  test("test_why_goes_to_the_catalonians", () => {
    const got = near("logic", 1);
    assert.ok(got.some((n) => ["Rashba", "Ritva", "Ra'ah"].includes(n)), String(got));
  });

  test("test_aggadah_has_its_own_ladder", () => {
    assert.ok(retrieve.KINDS.includes("aggadah"));
    const n = pack.segments.find((s) => (s.commentaries["Ben Yehoyada"] || []).length).n;
    assert.ok(near("aggadah", n).includes("Ben Yehoyada"));
  });

  test("test_the_maharsha_is_found_under_the_name_sefaria_files_him", () => {
    const pack2 = new Pack(PACK_2B);
    const n = pack2.segments.find((s) => (s.commentaries["Chidushei Halachot"] || []).length).n;
    const got = retrieve.extras(pack2, n, { "kind": "on_commentary", "names": ["Maharsha"] }, { depth: "daf" });
    assert.ok(got.map(([name]) => name).includes("Chidushei Halachot"));
  });

  test("test_on_berakhot_halacha_brings_rabbeinu_yonah", async () => {
    const jobs = await plan_jobs(pack, 1, { "kind": "halacha", "names": [] });
    assert.ok(has(jobs, ["follow", "Rif Berakhot 1a:1", "Rabbeinu Yonah"]));
  });

  test("test_the_meiri_is_an_overview_not_a_posek", () => {
    assert.ok(!who.WHO["Meiri"].answers.includes("halacha"));
    assert.ok(who.WHO["Meiri"].specialty.includes("light as an authority"));
  });
});


describe("Review", () => {
  // Coming back after a while: what we learned, and questions on it.
  beforeEach(() => {
    review.hooks.LOAD = async (ref) => new Pack(await sefaria.build(ref));
    store.log.clear();          // Python: a fresh CHAVRUTA_SESSIONS for each test
  });

  // Python wrote <date>.jsonl into the sessions folder; here, the same rows in store.log.
  const write = async (date, rows) => {
    for (const row of rows) {
      const { kind, ...fields } = row;
      await store.log.add(kind, { ...fields, at: date + " 12:00:00" });
    }
  };

  test("test_the_last_n_pages_before_this_one", () => {
    const pages = review.which_pages;
    assert.deepEqual(pages("Berakhot 6a", "what were the last two pages about?", [], "2026-09-28"),
                     ["Berakhot 4a", "Berakhot 4b", "Berakhot 5a", "Berakhot 5b"]);
    assert.equal(pages("Berakhot 6a", "remind me of the last six pages", [], "2026-09-28").length, 8);
    assert.deepEqual(pages("Berakhot 6a", "the last three amudim", [], "2026-09-28"),
                     ["Berakhot 4b", "Berakhot 5a", "Berakhot 5b"]);
    assert.equal(pages("Berakhot 30a", "תזכיר לי את שלושת הדפים האחרונים", [], "2026-09-28")[0],
                 "Berakhot 27a");
    assert.equal(pages("Berakhot 40a", "the last twenty pages", [], "2026-09-28").length, 20);   // ten dapim
  });

  test("test_last_time_comes_from_the_sittings", async () => {
    await write("2026-09-27", [{ "kind": "heard", "ref": "Berakhot 4b" }, { "kind": "answer", "ref": "Berakhot 5a" },
                               { "kind": "heard", "ref": "Berakhot 4b" }]);
    await write("2026-09-28", [{ "kind": "heard", "ref": "Berakhot 6a" }]);
    const history = await review.sittings();
    assert.deepEqual(history[0], { "date": "2026-09-28", "refs": ["Berakhot 6a"] });
    assert.deepEqual(review.which_pages("Berakhot 6a", "what did we learn yesterday?", history, "2026-09-28"),
                     ["Berakhot 4b", "Berakhot 5a"]);
  });

  test("test_each_amud_is_recapped_once_and_kept", async () => {
    const entry = await review.recap("Berakhot 2a");
    assert.ok(entry.he.includes("evening Shema"));
    assert.notEqual(await store.kv.get("recaps", review._path("Berakhot 2a")), null);   // Python: the file exists
    assert.ok(await library.cached(["recap", "Berakhot 2a"]));
  });

  const on_disk = () => {
    review.hooks.ON_DISK = async (ref) => (["Berakhot 2a", "Berakhot 2b"].includes(ref) ? new Pack(await sefaria.build(ref)) : null);
  };

  test("test_did_we_learn_this_word", async () => {
    on_disk();
    const learned = [{ "date": "2026-09-27", "refs": ["Berakhot 2a"] }];
    const hits = await review.find_words(review.terms("did we already see «הקטר חלבים»?"), "Berakhot 2b", learned);
    assert.equal(hits[0][0], "Berakhot 2a:5");
    assert.deepEqual(hits[0][2], ["2026-09-27"]);
    assert.deepEqual(await review.find_words(["מילהשלאקיימת"], "Berakhot 2b", learned), []);
  });

  test("test_where_the_page_itself_points", () => {
    const found = review.parallels(new Pack(PACK), 5, [{ "date": "2026-09-20", "refs": ["Berakhot 9a"] }]);
    assert.ok(has(found, ["Berakhot 9a:10", ["2026-09-20"]]));
    assert.ok(found.every(([r]) => !(r.startsWith("Leviticus") || r.startsWith("Mishnah"))));   // the Bavli only
  });

  test("test_the_mishna_pages_back", async () => {
    const mishna = await review.find_mishna("Berakhot 2b", 5, async (ref) => new Pack(await sefaria.build(ref)));
    assert.equal(mishna.ref, "Berakhot 2a:1-5");
    assert.ok(mishna.he.includes("Rabban Gamliel says"));
    assert.equal(mishna.amud, "Berakhot 2a");
  });
});


describe("LearningAlong", () => {
  // Reading onto the next page, notes, progress, the phone link.
  test("test_progress", async () => {
    const today = "2026-09-28";
    const sittings = [{ "date": "2026-09-28", "refs": ["Berakhot 2a", "Berakhot 2b"] },
                      { "date": "2026-09-27", "refs": ["Berakhot 3a"] },
                      { "date": "2026-09-25", "refs": ["Berakhot 3b"] }];
    const p = await daily.progress(sittings, today, { mine: ["Shabbat"] });
    assert.equal(p.streak, 2);                          // the 25th is not in a row
    assert.equal(p.daf_yomi.done, true);                // the fake calendar's daf is Berakhot 2
    assert.deepEqual(Object.fromEntries(p.tractates.map((t) => [t.name, [t.done, t.total]])),
                     { "Berakhot": [4, 125], "Shabbat": [0, 312] });
    // (Python also checked server.progress_text(p, "en"); the server is not this port.)
  });
});


describe("VoiceSettings", () => {
  test("test_only_real_settings_get_through", () => {
    const got = retrieve.settings_changes([
      { "name": "rate", "value": "faster" }, { "name": "language", "value": "fr" },
      { "name": "favor", "value": { "name": "meiri", "value": -1 } },
      { "name": "mine", "value": { "masechta": "Shabbat" } }, { "name": "api_key", "value": "x" },
      { "name": "voices", "value": 9 }]);
    assert.deepEqual(got, [{ "name": "rate", "value": "faster" },
                           { "name": "favor", "value": { "name": "Meiri", "value": -1 } },
                           { "name": "mine", "value": { "masechta": "Shabbat", "add": true } },
                           { "name": "voices", "value": 5 }]);
  });

  test("test_the_router_hands_over_the_changes", async () => {
    const route = await retrieve.classify(new LLM(), "answer in Hebrew from now on and leave out the Meiri");
    assert.equal(route.kind, "settings");
    assert.deepEqual(route.settings.map((c) => c.name), ["language", "favor"]);
  });

  test("test_speed_however_it_is_said", () => {
    for (const said of ["Can you talk a little bit faster?", "go faster", "תדבר קצת יותר מהר בבקשה"]) {
      assert.equal(smalltalk.reply(said)[0], "faster", said);
    }
    assert.equal(smalltalk.reply("what can I say?")[0], "help");
  });
});


describe("FirstRealSession", () => {
  // From the first session on Rosh Hashanah 9a.
  test("test_rosh_hashanah_is_not_the_rosh", () => {
    const known = new Set(["Rosh Hashanah 9a:1"]);
    assert.ok(ground.check("I see it -- Rosh Hashanah 9a, right at the start of this unit.", known).ok);
    assert.ok(ground.check("אנחנו בראש השנה ט ע״א.", known).ok);
    assert.ok(ground.check("Rosh Chodesh is not counted.", known).ok);
    assert.ok(!ground.check("The Rosh says it is the synagogue Shema.", known).ok);
  });

  test("test_the_last_time_i_studied_is_not_a_clock_question", async () => {
    const { search } = await import("../../web/lib/py.js");
    assert.ok(!search(retrieve.CLOCK, "the last time I studied Rosh Hashanah was long ago"));
    assert.ok(search(retrieve.CLOCK, "what's the last time to say shema tonight?"));
  });

  test("test_nine_pages_back_is_outlines_and_the_last_amud_in_full", async () => {
    const pages = review.which_pages("Rosh Hashanah 9a", "a refresher of the last nine pages", [], "2026-10-01");
    assert.deepEqual([pages[0], pages[pages.length - 1]], ["Rosh Hashanah 2a", "Rosh Hashanah 8b"]);
    let jobs = await plan_jobs(new Pack(PACK), 1, { "kind": "review", "pages": pages, "sites": ["dafyomi.co.il"] });
    const recaps = jobs.filter((j) => j[0] === "recap").map((j) => j[1]);
    const outlines = jobs.filter((j) => j[0] === "outline").map((j) => j[2]);
    assert.deepEqual(outlines, [2, 3, 4, 5, 6, 7, 8]);                  // every daf, quickly
    assert.deepEqual(recaps.slice(-2), ["Rosh Hashanah 8a", "Rosh Hashanah 8b"]);
    const kept = [];
    for (const p of pages) kept.push(await review.has_recap(p) ? 1 : 0);
    assert.ok(recaps.length <= 2 + sum(kept));
    // Without the outline site, recaps carry it: the last six amudim.
    jobs = await plan_jobs(new Pack(PACK), 1, { "kind": "review", "pages": pages, "sites": [] });
    assert.equal(jobs.filter((j) => j[0] === "recap").length, 6);
  });
});


describe("CuttingIn", () => {
  // Spoken over an answer still being said: an aside, a correction, a new question, or for later.
  const CUT = { "asked": "was this codified in the Tur?", "said": "The Tur brings the Rosh", "unsaid": "and the Beit Yosef" };

  const judged = async (said, model = null) => {
    const Model = {
      async json(system, messages, { heavy = false } = {}) {
        assert.ok(system.includes("cut_in") && messages[messages.length - 1].content.startsWith("[you were answering"));
        return { "kind": "meaning", ...(model || {}) };
      },
    };
    return (await retrieve.classify(Model, said, { cut: CUT })).cut_in;
  };

  test("test_the_plain_cases_need_no_judgment", async () => {
    assert.equal(await judged("no, I mean in the Rambam", { "cut_in": "new" }), "merge");
    assert.equal(await judged("לא, התכוונתי לרמב״ם"), "merge");
    assert.equal(await judged("and what about the Rama?"), "merge");
    assert.equal(await judged("let's come back to that later", { "cut_in": "aside" }), "later");
    assert.equal(await judged("נחזור לזה אחר כך"), "later");
  });

  test("test_the_rest_is_the_models_call_and_short_means_an_aside", async () => {
    assert.equal(await judged("who was Rabban Gamliel?", { "cut_in": "new" }), "new");
    assert.equal(await judged("wait, what does chatzot mean?"), "aside");
    assert.equal(await judged("so I have a completely separate thing I have been wondering about the " +
                              "structure of the whole tractate and its order"), "new");
  });

  test("test_no_cut_no_judgment", async () => {
    const Model = {
      async json(system, messages, { heavy = false } = {}) {
        assert.ok(!system.includes("cut_in"));
        return { "kind": "meaning" };
      },
    };
    assert.equal((await retrieve.classify(Model, "what does chatzot mean?")).cut_in, null);
  });
});


describe("HeadStart", () => {
  // The answer begins on a guess while the router decides; used only if the router agrees.
  const pack = new Pack(PACK);

  test("test_a_plain_question_about_the_page_gets_a_guess", async () => {
    const g = await retrieve.guess("why does the mishna start with the evening?", pack, 1);
    assert.equal(g.kind, "logic");
    assert.equal((await retrieve.guess("what does chatzot mean here?", pack, 1)).kind, "meaning");
    assert.deepEqual((await retrieve.guess("so what is Rashi saying about the priests?", pack, 1)).names, ["Rashi"]);
    assert.equal((await retrieve.guess("מה פירוש עד סוף האשמורה הראשונה", pack, 1)).language, "he");
  });

  test("test_anything_that_needs_more_waits_for_the_router", async () => {
    for (const said of ["and was this codified in the Tur?", "go to daf 5", "what does the Rashba say here?",
                        "remind me what we learned yesterday", "talk a bit faster please", "can you hear me now?",
                        "I think the gemara contradicts what we saw above"]) {
      assert.equal(await retrieve.guess(said, pack, 1), null, said);
    }
  });

  test("test_used_only_when_the_router_agrees", async () => {
    const g = await retrieve.guess("what does chatzot mean here?", pack, 1);
    assert.ok(retrieve.agrees({ "kind": "meaning", "names": [], "cut_in": null }, g));
    assert.ok(!retrieve.agrees({ "kind": "logic", "names": [], "cut_in": null }, g));
    assert.ok(!retrieve.agrees({ "kind": "meaning", "names": ["Meiri"], "cut_in": null }, g));
    assert.ok(!retrieve.agrees({ "kind": "meaning", "names": [], "cut_in": null, "language": "he" }, g,
                               { auto_language: true }));
  });
});


describe("Server", () => {
  test("test_todays_daf", async () => {
    const found = await daily.daf_yomi({ day: "2026-09-28" });
    assert.equal(found.ref, "Berakhot 2");
    assert.deepEqual(found.amudim, ["Berakhot 2a", "Berakhot 2b"]);
    assert.equal(found.he, "ברכות ב׳");
  });

  test("test_preparing_a_tractate_builds_what_is_missing", async () => {
    const built = [];
    let set_done;
    const done = new Promise((ok) => { set_done = ok; });
    const have = new Set(["Horayot 2a", "Horayot 2b"]);
    const p = new daily.Preparer(async (ref) => { built.push(ref); have.add(ref); }, async (ref) => have.has(ref),
                                 { finish: async (m) => set_done(true), pause: 0 });
    assert.ok(p.start("Horayot"));
    const timer = (s) => new Promise((ok) => setTimeout(() => ok(false), s * 1000).unref());
    assert.ok(await Promise.race([done, timer(5)]));
    assert.ok(!built.includes("Horayot 2a"));
    assert.equal(built[0], "Horayot 3a");
    const s = await p.status("Horayot");
    assert.deepEqual([s.done, s.total], [25, 25]);
    assert.ok(!p.start("Shekalim"));                 // not on Sefaria's Bavli
  });
});


// -- parity with the Python: the same inputs, the same answers -----------------------

describe("Parity", () => {
  // The packs are the ones built here, handed to Python as data, so both sides
  // look at the same page (Python's commentator list is ordered by hash on ties).
  const PACKS = { "Berakhot 2a": PACK, "Berakhot 2b": PACK_2B };
  const today = store.today();

  const ROUTES_EXTRAS = [
    ["Berakhot 2a", 1, { "kind": "meaning", "names": [] }, {}],
    ["Berakhot 2a", 3, { "kind": "logic", "names": ["Rashba"] }, {}],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [] }, { depth: "acharonim" }],
    ["Berakhot 2a", 5, { "kind": "conflict", "names": [] }, { depth: "rishonim" }],
    ["Berakhot 2a", 2, { "kind": "structure", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "on_commentary", "names": ["Tosafot"] }, {}],
    ["Berakhot 2a", 4, { "kind": "on_commentary", "names": ["Rashi"] }, { depth: "acharonim" }],
    ["Berakhot 2a", 9, { "kind": "aggadah", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "meaning", "names": ["Tosfos", "Meiri", "רשב\"א"] }, { budget: 4 }],
    ["Berakhot 2a", 6, { "kind": "meaning", "names": [], "avoid": ["Meiri"], "voices": 2 }, { depth: "rishonim" }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [], "prefer": ["Ritva", "Meiri"], "mute": ["Rif"], "voices": 1 }, {}],
    ["Berakhot 2a", 12, { "kind": "logic", "names": [], "prefer": ["Rashba"], "mute": ["Ritva"] }, { depth: "acharonim" }],
    ["Berakhot 2a", 1, { "kind": "ping" }, { depth: "acharonim" }],
    ["Berakhot 2a", 1, { "kind": "other", "names": ["Rosh"] }, {}],
    ["Berakhot 2a", 1, { "kind": "check_reading", "names": [] }, { depth: "rishonim" }],
    ["Berakhot 2a", 1, { "kind": "people", "names": ["Meiri"] }, {}],
    ["Berakhot 2a", 1, { "kind": "review", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "quiz", "names": [] }, { depth: "acharonim" }],
    ["Berakhot 2a", 1, { "kind": "recall", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "settings", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "reading", "names": [] }, {}],
    ["Berakhot 2a", 1, { "kind": "navigate", "names": [] }, {}],
    ["Berakhot 2b", 3, { "kind": "on_commentary", "names": ["Maharsha"] }, {}],
    ["Berakhot 2b", 7, { "kind": "halacha", "names": ["Meiri"] }, { depth: "rishonim" }],
    ["Berakhot 2b", 2, { "kind": "conflict", "names": [] }, { depth: "acharonim", budget: 3 }],
  ];
  const ROUTES_PLAN = [
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [] }],
    ["Berakhot 2a", 1, { "kind": "meaning", "names": ["Rabbeinu Yonah"] }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [], "said": "give me numbers, summer and winter" }],
    ["Berakhot 2a", 1, { "kind": "meaning", "names": [], "said": "how long till sunset in Tel Aviv?", "place": "Tel Aviv" }],
    ["Berakhot 2a", 1, { "kind": "logic", "names": [], "said": "say in Bnei Brak" }],
    ["Berakhot 2a", 1, { "kind": "structure", "names": [], "said": "what time tonight?" }],
    ["Berakhot 2a", 5, { "kind": "conflict", "names": [] }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": ["Mishnah Berurah", "Beit Yosef", "Kessef Mishneh"] }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [], "prefer": ["Magen Avraham", "Bach", "Lechem Mishneh",
                                                                    "Arukh HaShulchan", "Ra'ah"],
                         "mute": ["Rambam", "Mishnah Berurah"] }],
    ["Berakhot 2a", 1, { "kind": "meaning", "names": ["Arukh HaShulchan", "taz"] }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [], "said": "what does Rav Ovadia say? and the Sha'ar HaTziyun",
                         "sites": ["halachayomit.co.il", "he.wikisource.org", "dafyomi.co.il"] }],
    ["Berakhot 2a", 3, { "kind": "meaning", "names": [], "said": "check online for the mordechai",
                         "sites": ["he.wikisource.org", "halachayomit.co.il"] }],
    ["Berakhot 2a", 1, { "kind": "halacha", "names": [], "said": "is this the practice?", "sites_halacha": true,
                         "sites": ["halachayomit.co.il"] }],
    ["Berakhot 2a", 1, { "kind": "aggadah", "names": [] }],
    ["Berakhot 2a", 1, { "kind": "ping" }],
    ["Berakhot 2a", 1, { "kind": "check_reading" }],
    ["Berakhot 2a", 1, { "kind": "people", "names": ["Meiri", "Rabban Gamliel"] }],
    ["Berakhot 2a", 1, { "kind": "people", "names": [], "avoid": ["Rashba", "Tosafot", "Rashi", "Meiri"] }],
    ["Berakhot 2a", 1, { "kind": "review", "pages": ["Berakhot 5a", "Berakhot 5b", "Berakhot 6a"], "sites": [] }],
    ["Berakhot 2a", 1, { "kind": "review", "pages": ["Berakhot 3a", "Berakhot 3b", "Berakhot 4a", "Berakhot 4b"],
                         "sites": ["dafyomi.co.il"], "parallels": ["Berakhot 9a:10"] }],
    ["Berakhot 2a", 1, { "kind": "recall", "pages": ["Shabbat 3a"], "sites": [] }],
    ["Berakhot 2a", 1, { "kind": "quiz" }],
    ["Berakhot 2a", 1, { "kind": "settings" }],
    ["Berakhot 2a", 1, { "kind": "reading" }],
    ["Berakhot 2a", 1, { "kind": "navigate" }],
    ["Berakhot 2a", 1, { "kind": "other", "names": [] }],
    ["Berakhot 2b", 4, { "kind": "conflict", "names": [] }],
    ["Berakhot 2b", 6, { "kind": "halacha", "names": ["Tur"] }],
  ];
  const GUESSES = [
    ["why does the mishna start with the evening?", 1, null],
    ["what does chatzot mean here?", 1, null],
    ["so what is Rashi saying about the priests?", 1, null],
    ["מה פירוש עד סוף האשמורה הראשונה", 1, null],
    ["and was this codified in the Tur?", 1, null],
    ["I think the gemara contradicts what we saw above", 1, null],
    ["how does this fit with the other mishna?", 3, null],
    ["what is Tosafot asking on this line?", 2, null],
    ["where does this sugya start and end?", 4, null],
    ["what does the Rashba say here?", 1, null],
    ["how long till it gets dark in Tel Aviv", 1, null],
    ["why does the mishna start with the evening?", 1, { "asked": "x", "said": "y", "unsaid": "z" }],
    ["no, I mean why the priests in particular?", 1, { "asked": "x", "said": "y", "unsaid": "z" }],
    ["why would we come back to that question of the priests later on", 1, { "asked": "x" }],
    ["one two three", 1, null],
    ["", 1, null],
  ];
  const AGREES = [
    [{ "kind": "meaning", "names": [], "cut_in": null }, 1, false],
    [{ "kind": "logic", "names": [], "cut_in": null }, 1, false],
    [{ "kind": "meaning", "names": ["Meiri"], "cut_in": null }, 1, false],
    [{ "kind": "meaning", "names": [], "cut_in": null, "language": "he" }, 1, true],
    [{ "kind": "meaning", "names": [], "cut_in": null, "language": "en" }, 1, true],
    [{ "kind": "meaning", "names": [], "navigate": { "daf": 3 } }, 1, false],
    [{ "kind": "meaning", "names": [], "settings": [{ "name": "rate", "value": "faster" }] }, 1, false],
    [{ "kind": "logic", "names": [] }, 0, false],
    [{ "kind": "on_commentary", "names": ["Rashi", "Rashi"] }, 2, false],
  ];
  const SETTINGS = [
    [{ "name": "rate", "value": "faster" }, { "name": "language", "value": "fr" },
     { "name": "favor", "value": { "name": "meiri", "value": -1 } },
     { "name": "mine", "value": { "masechta": "Shabbat" } }, { "name": "api_key", "value": "x" },
     { "name": "voices", "value": 9 }],
    [{ "name": "voices", "value": true }, { "name": "voices", "value": false }, { "name": "voices", "value": 0 },
     { "name": "voices", "value": 4 }],
    [{ "name": "nudges", "value": 1 }, { "name": "checks", "value": 0 }, { "name": "speak", "value": "yes" },
     { "name": "pause", "value": "long" }],
    [{ "name": "favor", "value": { "name": "Tosfos", "value": 1 } },
     { "name": "favor", "value": { "name": "rashba", "value": true } },
     { "name": "favor", "value": { "name": "Nobody", "value": 1 } },
     { "name": "favor", "value": { "name": "Tur", "value": 2 } },
     { "name": "favor", "value": { "name": "Mishnah Berurah", "value": 0 } }],
    [{ "name": "mine", "value": { "masechta": "Berakhot", "add": false } },
     { "name": "mine", "value": { "masechta": "Shekalim" } }, "rate", ["rate", "faster"],
     { "name": "open", "value": "today" }, { "name": "view", "value": "lin" }, { "name": "depth", "value": "acharonim" }],
    { "name": "rate", "value": "faster" },
    null,
    [{ "name": "favor", "value": { "name": "Ritva", "value": false } }, { "name": "language", "value": "auto" }],
  ];
  const NAMES = [...Object.keys(retrieve.ALIASES), ...new Set(Object.values(retrieve.ALIASES)),
                 "Tosfos", 'רשב"א', "Nonsense", "Pnei Yehoshua", "Rabbeinu Tam", "R. Akiva Eiger", "Shulchan Aruch",
                 "Chidushei Halachot", "Maharsha", "TOSAFOT", "Rif", "Steinsaltz", "Mishneh Torah", ""];
  const CLASSIFY = [
    ["what does this mean?", { "kind": "meaning", "claim": 1, "names": ["Rashi", "", "Tosafot", "Rif", "Meiri", "Ran"],
                               "language": "en" }, null],
    ["go to daf 5", { "kind": "navigate", "navigate": { "daf": "5", "amud": "B", "masechta": "Shabbat" } }, null],
    ["go to daf 5", { "kind": "navigate", "navigate": { "daf": 7, "masechta": "Narnia" } }, null],
    ["the daf yomi", { "kind": "navigate", "navigate": { "daf_yomi": 1, "daf": 3 } }, null],
    ["go on", { "kind": "navigate", "navigate": { "daf": "five" } }, null],
    ["can you hear me?", { "kind": "ping", "reply": "Yes, I hear you. ".repeat(20), "language": "he" }, null],
    ["thanks", { "kind": "other", "reply": "You're welcome" }, null],
    ["faster", { "kind": "settings", "settings": [{ "name": "rate", "value": "faster" }, { "name": "x", "value": 1 }] }, null],
    ["huh", { "kind": "weird", "names": "Rashi", "settings": [{ "name": "rate", "value": "faster" }] }, null],
    ["huh", "raise", null],
    ["wait, who is that?", { "kind": "people", "cut_in": "aside" }, { "asked": "who", "said": "  a  b \n c ", "unsaid": "d" }],
    ["wait, who is that?", "raise", { "asked": "who", "said": "a", "unsaid": "d" }],
    ["no, I mean the other one", { "kind": "meaning", "cut_in": "later" }, { "asked": "q" }],
    ["one two three four five six seven eight nine ten eleven twelve thirteen", { "kind": "meaning", "cut_in": "bogus" },
     { "asked": "q" }],
  ];
  const UTTERANCES = [
    ["Berakhot 6a", "what were the last two pages about?", [], "2026-09-28"],
    ["Berakhot 6a", "remind me of the last six pages", [], "2026-09-28"],
    ["Berakhot 6a", "the last three amudim", [], "2026-09-28"],
    ["Berakhot 30a", "תזכיר לי את שלושת הדפים האחרונים", [], "2026-09-28"],
    ["Berakhot 40a", "the last twenty pages", [], "2026-09-28"],
    ["Berakhot 6a", "what did we learn yesterday?",
     [{ "date": "2026-09-28", "refs": ["Berakhot 6a"] }, { "date": "2026-09-27", "refs": ["Berakhot 4b", "Berakhot 5a"] }],
     "2026-09-28"],
    ["Berakhot 6a", "where did we stop last time?", [{ "date": "2026-09-28", "refs": ["Berakhot 6a"] }], "2026-09-28"],
    ["Berakhot 6a", "where did we stop last time?", [], "2026-09-28"],
    ["Berakhot 3b", "summarize so far", [], "2026-09-28"],
    ["Berakhot 3b", "a couple of amudim up to here", [], "2026-09-28"],
    ["Berakhot 2a", "the last few pages", [], "2026-09-28"],
    ["Shabbat 10a", "חזרה על חמשת העמודים", [], "2026-09-28"],
    ["Shabbat 10a", "כמה דפים אחורה עד כאן", [], "2026-09-28"],
    ["Narnia 3a", "the last two pages", [], "2026-09-28"],
    ["Rosh Hashanah 9a", "a refresher of the last nine pages", [], "2026-10-01"],
    ["Bava Batra 100b", "the last 12 sides of the daf", [], "2026-10-01"],
    ["Berakhot 6a", "several pages back, eleven or so", [], "2026-09-28"],
  ];
  const TERMS = ["did we already see «הקטר חלבים»?", 'where did I see "עד שיעלה עמוד השחר" before?',
                 "למדנו את זה כבר אתמול? הקטר חלבים ואיברים", "did we learn this", "“ביאת שמשו” and «טהר יומא»; also «x»",
                 "ראיתי את המילה תרומתן איפשהו", 'רמב"ם ושו"ע'];
  const SITTINGS = [
    [[{ "date": "2026-09-28", "refs": ["Berakhot 2a", "Berakhot 2b"] }, { "date": "2026-09-27", "refs": ["Berakhot 3a"] },
      { "date": "2026-09-25", "refs": ["Berakhot 3b"] }], "2026-09-28", ["Shabbat"]],
    [[{ "date": "2026-09-27", "refs": ["Berakhot 2b", "Eruvin 3a"] }, { "date": "2026-09-26", "refs": ["Berakhot 3a"] }],
     "2026-09-28", []],
    [[], "2026-09-28", ["Berakhot", "Nazir"]],
    [[{ "date": "2026-09-28", "refs": ["Shabbat 2a"] }], "2026-09-28", []],
  ];
  const ASKED = [["Berakhot 2a", 1, {}], ["Berakhot 2a", 5, {}], ["Berakhot 2a", 9, { most: 4 }],
                 ["Berakhot 2a", 13, { words: 12 }], ["Berakhot 2b", 2, {}], ["Berakhot 2b", 8, {}]];
  const SESSIONS = {
    "2026-09-20": [["heard", "Berakhot 2a"], ["note", "Berakhot 9a"], ["answer", "Berakhot 2b"]],
    "2026-09-25": [["answer", ""], ["heard", "Berakhot 3a"], ["heard", "Berakhot 3a"], ["other", "Berakhot 4a"]],
    "2026-09-27": [["heard", "Berakhot 4b"], ["answer", "Berakhot 5a"], ["heard", "Berakhot 4b"]],
    "2026-09-28": [["heard", "Berakhot 6a"]],
  };

  const SCRIPT = String.raw`
import datetime, json, os, sys, tempfile
data = json.load(sys.stdin)
from chavruta import daily, library, retrieve, review, sefaria
from chavruta.pack import Pack
packs = {r: Pack(p) for r, p in data["packs"].items()}

class Model:
    def __init__(self, out):
        self.out = out
    def json(self, system, messages, heavy=False):
        if self.out == "raise":
            raise ValueError("no")
        return self.out

out = {}
out["extras"] = [retrieve.extras(packs[r], n, route, o.get("depth", "daf"), o.get("budget", 7))
                 for r, n, route, o in data["extras"]]
out["plan"] = [retrieve.plan(packs[r], n, route) for r, n, route in data["plan"]]
out["asked_here"] = [retrieve.asked_here(packs[r], n, o.get("most", 12), o.get("words", 36))
                     for r, n, o in data["asked"]]
out["guess"] = [retrieve.guess(s, packs["Berakhot 2a"], n, cut) for s, n, cut in data["guess"]]
out["agrees"] = [retrieve.agrees(real, out["guess"][i], auto) for real, i, auto in data["agrees"]]
out["settings"] = [retrieve.settings_changes(raw) for raw in data["settings"]]
present = set(packs["Berakhot 2a"].commentators())
out["resolve"] = [[retrieve.resolve(nm, present), retrieve._canonical(nm, present), retrieve.resolve(nm, set())]
                  for nm in data["names"]]
out["classify"] = [retrieve.classify(Model(o), s, cut) for s, o, cut in data["classify"]]
out["texts"] = [retrieve.ROUTER_SYSTEM, retrieve.CUT_IN_SYSTEM, review.PROMPT, retrieve.KINDS]
out["cut_in_context"] = [retrieve.cut_in_context(c) for _, _, c in data["classify"] if c]
out["hebrew_number"] = [retrieve.hebrew_number(n) for n in data["numbers"]]
out["wiki_query"] = [retrieve.wiki_query(packs["Berakhot 2a"], n, said, siman) for n, said, siman in data["wiki"]]
out["which_pages"] = [review.which_pages(*u) for u in data["utterances"]]
out["count"] = [review.count(u[1]) for u in data["utterances"]] + [review.count(t) for t in data["terms"]]
out["terms"] = [review.terms(t) for t in data["terms"]]
out["progress"] = [daily.progress(s, datetime.date.fromisoformat(d), mine) for s, d, mine in data["sittings"]]
out["daf_yomi"] = [daily.daf_yomi(datetime.date.fromisoformat(d)) for d in ["2026-09-28", "2026-10-02"]]
out["parallels"] = [review.parallels(packs[r], n, data["sittings"][0][0]) for r, n in [["Berakhot 2a", 5], ["Berakhot 2a", 1], ["Berakhot 2b", 3]]]
review.ON_DISK = lambda ref: packs.get(ref)
out["find_words"] = [review.find_words(review.terms(t), "Berakhot 2b", data["sittings"][0][0]) for t in data["terms"]]
out["find_mishna"] = [review.find_mishna(r, n, lambda ref: packs.get(ref)) for r, n in [["Berakhot 2b", 5], ["Berakhot 2a", 3], ["Berakhot 2b", 1]]]
review.SESSIONS_DIR = tempfile.mkdtemp()
for date, rows in data["sessions"].items():
    with open(os.path.join(review.SESSIONS_DIR, date + ".jsonl"), "w") as f:
        for kind, ref in rows:
            f.write(json.dumps({"kind": kind, "ref": ref}) + "\n")
out["sittings"] = [review.sittings(), review.sittings(2)]
out["library"] = {
    "name_of": [library.name_of(r) for r in data["refs"]],
    "place_in": [library.place_in(s) for s in data["places"]],
    "human": [library._human(s) for s in ["rabbi-yehudah-b-ilai", "rav-(amora)", "shmuel-b-nachmani-(jerusalem)"]],
    "order": [library._order(r) for r in data["refs"]],
    "zmanim": [library.zmanim("2026-09-28"), library.zmanim("2026-06-21", "Tel Aviv"), library.zmanim("2026-12-21", "Nowhere"),
               library.zmanim("2026-09-28", "Jerusalem")],
    "person": [library.person("Meiri", "Meiri on Berakhot", "Berakhot 2a"), library.person("Rashba", "Rashba on Berakhot"),
               library.person("Rabban Gamliel", None, "Berakhot 2a"), library.person("Nobody At All")],
    "text": [library.text("Shulchan Arukh, Orach Chayim 235:1"), library.text("Tur, Orach Chayim 235")],
    "follow": library.follow("Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"),
}
print(json.dumps(out, ensure_ascii=False))
`;

  let python = null, js = null;
  const NUMBERS = [1, 9, 10, 15, 16, 19, 99, 100, 115, 235, 400, 416, 499, 615, "58"];
  const WIKI = [[1, "the sha'ar hatziyun", "235"], [1, "שער הציון", null], [3, "what does the Mordechai say", null],
                [2, "chazon ish", "58"], [1, "something else entirely", "235"]];
  const REFS = ["Tur, Orach Chayim 235", "Mishnah Berurah 235:4", "Rabbeinu Yonah on Berakhot 1a:1",
                "Mishneh Torah, Reading the Shema 1:9", "Shulchan Arukh, Orach Chayim 235:1", "Sefer Mitzvot Gadol 18",
                "Berakhot 9a:10-12", "Meiri on Berakhot 2a:2", "Arukh HaShulchan, Orach Chaim 235", "Rif Berakhot 1a:1"];
  const PLACES_SAID = ["how long till sunset in Tel Aviv?", "say בתל אביב", "לבני ברק", "in L.A. tonight", "NEW YORK",
                       "jerusalem", "the modi'in times", "nowhere special", "", "petach tikva or haifa", "ובירושלים"];

  before(async () => {
    const data = {
      packs: PACKS, extras: ROUTES_EXTRAS, plan: ROUTES_PLAN, asked: ASKED, guess: GUESSES, agrees: AGREES,
      settings: SETTINGS, names: NAMES, classify: CLASSIFY, numbers: NUMBERS, wiki: WIKI, utterances: UTTERANCES,
      terms: TERMS, sittings: SITTINGS, sessions: SESSIONS, refs: REFS, places: PLACES_SAID,
    };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
    const run = promisify(execFile)("python3", ["-c", SCRIPT], {
      cwd: ROOT_DIR, maxBuffer: 1 << 28,
      env: { ...process.env, PYTHONPATH: ROOT_DIR, CHAVRUTA_SEFARIA_API: fake.sefaria, OPENAI_BASE_URL: fake.openai,
             OPENAI_API_KEY: "sk-test", CHAVRUTA_PACKS: tmp, CHAVRUTA_ZMANIM_API: config.zmanim,
             CHAVRUTA_WIKISOURCE_API: config.wikisource, CHAVRUTA_WEB_REWRITE: JSON.stringify(config.web_rewrite),
             CHAVRUTA_SESSIONS: fs.mkdtempSync(path.join(os.tmpdir(), "sessions-")),
             CHAVRUTA_NOTES: path.join(tmp, "notes.jsonl") },
    });
    run.child.stdin.end(JSON.stringify(data));
    python = JSON.parse((await run).stdout);

    // The same, here.
    const packs = Object.fromEntries(Object.entries(PACKS).map(([r, p]) => [r, new Pack(p)]));
    const model = (o) => ({ async json() { if (o === "raise") throw new Error("no"); return o; } });
    const out = {};
    out.extras = ROUTES_EXTRAS.map(([r, n, route, o]) => retrieve.extras(packs[r], n, route, o));
    out.plan = [];
    for (const [r, n, route] of ROUTES_PLAN) out.plan.push(await retrieve.plan(packs[r], n, route));
    out.asked_here = ASKED.map(([r, n, o]) => retrieve.asked_here(packs[r], n, o));
    out.guess = [];
    for (const [s, n, cut] of GUESSES) out.guess.push(await retrieve.guess(s, packs["Berakhot 2a"], n, { cut }));
    out.agrees = AGREES.map(([real, i, auto]) => retrieve.agrees(real, out.guess[i], { auto_language: auto }));
    out.settings = SETTINGS.map((raw) => retrieve.settings_changes(raw));
    const present = new Set(packs["Berakhot 2a"].commentators());
    out.resolve = NAMES.map((nm) => [retrieve.resolve(nm, present), retrieve._canonical(nm, present), retrieve.resolve(nm, new Set())]);
    out.classify = [];
    for (const [s, o, cut] of CLASSIFY) out.classify.push(await retrieve.classify(model(o), s, { cut }));
    out.texts = [retrieve.ROUTER_SYSTEM, retrieve.CUT_IN_SYSTEM, review.PROMPT, retrieve.KINDS];
    out.cut_in_context = CLASSIFY.filter(([, , c]) => c).map(([, , c]) => retrieve.cut_in_context(c));
    out.hebrew_number = NUMBERS.map((n) => retrieve.hebrew_number(n));
    out.wiki_query = WIKI.map(([n, said, siman]) => retrieve.wiki_query(packs["Berakhot 2a"], n, said, siman));
    out.which_pages = UTTERANCES.map((u) => review.which_pages(...u));
    out.count = [...UTTERANCES.map((u) => review.count(u[1])), ...TERMS.map((t) => review.count(t))];
    out.terms = TERMS.map((t) => review.terms(t));
    out.progress = [];
    for (const [s, d, mine] of SITTINGS) out.progress.push(await daily.progress(s, d, { mine }));
    out.daf_yomi = [await daily.daf_yomi({ day: "2026-09-28" }), await daily.daf_yomi({ day: "2026-10-02" })];
    out.parallels = [["Berakhot 2a", 5], ["Berakhot 2a", 1], ["Berakhot 2b", 3]].map(([r, n]) => review.parallels(packs[r], n, SITTINGS[0][0]));
    const saved = review.hooks.ON_DISK;
    review.hooks.ON_DISK = async (ref) => packs[ref] ?? null;
    out.find_words = [];
    for (const t of TERMS) out.find_words.push(await review.find_words(review.terms(t), "Berakhot 2b", SITTINGS[0][0]));
    review.hooks.ON_DISK = saved;
    out.find_mishna = [];
    for (const [r, n] of [["Berakhot 2b", 5], ["Berakhot 2a", 3], ["Berakhot 2b", 1]]) {
      out.find_mishna.push(await review.find_mishna(r, n, async (ref) => packs[ref] ?? null));
    }
    store.log.clear();
    for (const [date, rows] of Object.entries(SESSIONS)) {
      for (const [kind, ref] of rows) await store.log.add(kind, { ref, at: date + " 09:30:00" });
    }
    out.sittings = [await review.sittings(), await review.sittings({ days: 2 })];
    out.library = {
      name_of: REFS.map((r) => library.name_of(r)),
      place_in: PLACES_SAID.map((s) => library.place_in(s)),
      human: ["rabbi-yehudah-b-ilai", "rav-(amora)", "shmuel-b-nachmani-(jerusalem)"].map((s) => library._human(s)),
      order: REFS.map((r) => library._order(r)),
      zmanim: [await library.zmanim("2026-09-28"), await library.zmanim("2026-06-21", { place: "Tel Aviv" }),
               await library.zmanim("2026-12-21", { place: "Nowhere" }), await library.zmanim("2026-09-28", { place: "Jerusalem" })],
      person: [await library.person("Meiri", { book: "Meiri on Berakhot", page: "Berakhot 2a" }),
               await library.person("Rashba", { book: "Rashba on Berakhot" }),
               await library.person("Rabban Gamliel", { page: "Berakhot 2a" }), await library.person("Nobody At All")],
      text: [await library.text("Shulchan Arukh, Orach Chayim 235:1"), await library.text("Tur, Orach Chayim 235")],
      follow: await library.follow("Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"),
    };
    js = JSON.parse(JSON.stringify(out));
  });

  const same = (key) => {
    assert.ok(python && js);
    assert.equal(js[key].length, python[key].length, key);
    js[key].forEach((got, i) => assert.deepStrictEqual(got, python[key][i], key + " #" + i));
  };

  test("the prompts are Python's, character for character", () => same("texts"));
  test("retrieve.extras for every kind of route", () => same("extras"));
  test("retrieve.plan for every kind of route", () => same("plan"));
  test("retrieve.asked_here", () => same("asked_here"));
  test("retrieve.guess and agrees", () => { same("guess"); same("agrees"); });
  test("retrieve.settings_changes", () => same("settings"));
  test("retrieve.resolve on the alias list", () => same("resolve"));
  test("retrieve.classify and cut_in_context", () => { same("classify"); same("cut_in_context"); });
  test("retrieve.hebrew_number and wiki_query", () => { same("hebrew_number"); same("wiki_query"); });
  test("review.which_pages, count and terms", () => { same("which_pages"); same("count"); same("terms"); });
  test("review.parallels, find_words, find_mishna", () => { same("parallels"); same("find_words"); same("find_mishna"); });
  test("review.sittings", () => same("sittings"));
  test("daily.progress and daf_yomi", () => { same("progress"); same("daf_yomi"); });
  test("library: names, places, people, times, texts", () => {
    for (const key of Object.keys(python.library)) {
      assert.deepStrictEqual(js.library[key], python.library[key], key);
    }
  });
});
