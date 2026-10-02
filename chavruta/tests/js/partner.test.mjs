import { fake, control } from "./harness.mjs";
import { ROOT_DIR, stores } from "./harness.mjs";
import { describe, test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as store from "../../web/lib/store.js";
import { search } from "../../web/lib/py.js";
import * as sefaria from "../../web/lib/sefaria.js";
import { Pack } from "../../web/lib/pack.js";
import * as align from "../../web/lib/align.js";
import * as ground from "../../web/lib/ground.js";
import * as library from "../../web/lib/library.js";
import * as retrieve from "../../web/lib/retrieve.js";
import * as review from "../../web/lib/review.js";
import * as smalltalk from "../../web/lib/smalltalk.js";
import * as who from "../../web/lib/commentators.js";
import * as partner from "../../web/lib/partner.js";
import { LLM } from "../../web/lib/llm.js";
import { Index as Ix, build_index } from "../../web/lib/masechta_index.js";

void stores;
const PACK = await sefaria.build("Berakhot 2a");

/** A model stand-in whose say_stream yields these pieces (Python: iter([...])). */
const streaming = (pieces) => ({ * say_stream() { yield* pieces; } });


describe("Index", () => {
  let index;
  before(async () => {
    // As setUpClass ran pack/build_index.py: every amud built once, then the index read back.
    const load = async (ref) => {
      let data = await store.kv.get("packs", ref);
      if (data === null) {
        data = await sefaria.build(ref);
        await store.kv.set("packs", ref, data);
      }
      return data;
    };
    await build_index("Berakhot", load);
    index = await Ix.load("Berakhot");
  });

  test("test_elsewhere_leads_are_citable_in_a_turn", async () => {
    const pack = new Pack(PACK);
    const p = new partner.Partner(pack, new LLM(), { index });
    const [text, verdict, , trace] = await p.ask(6, [], "didn't we learn something like this elsewhere? explain the structure");
    assert.ok("elsewhere" in trace);
    assert.ok(verdict.ok, text);
  });
});


describe("Partner", () => {
  const pack = new Pack(PACK);

  test("test_whole_amud_in_view", () => {
    const ctx = partner.amud_context(pack);
    assert.equal(ctx.split("=== LINE").length - 1, 14);
    assert.ok(ctx.includes("[[Tosafot on Berakhot 2a:1:1]]"));
  });

  test("test_never_correct_their_accent_but_ask_about_a_different_word", () => {
    assert.ok(partner.CONSTITUTION.includes("never comment on how a word was pronounced"));
    assert.ok(partner.CONSTITUTION.includes("never \"yes\" when it shows a swapped word"));
  });

  test("test_a_mic_check_gets_a_few_words_and_no_thinking", async () => {
    await control("/control/reset", {});
    const [text, , , trace] = await new partner.Partner(pack, new LLM()).ask(1, [], "can you hear me?");
    assert.equal(text, "Yes, I hear you.");
    assert.ok(trace["quick"]);
    const log = await control("/control/log");
    assert.deepEqual(log.filter((e) => e["path"] === "chat").map((e) => e["model"]), ["gpt-5.6-luna", "gpt-5.6-luna"]);
  });

  test("test_did_i_read_it_right_is_answered_from_what_was_heard", async () => {
    const page = new align.Page(PACK);
    const said = "מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול מעשר עד סוף האשמורה השנייה";
    const heard = align.listen(page, said);
    const [text] = await new partner.Partner(pack, new LLM()).ask(
      1, [], "did I read it correctly?", { recent: [{ "said": said, "heard": heard }] });
    assert.ok(text.includes("מעשר?"));
    assert.ok(text.includes("בתרומתן"));
  });

  test("test_a_halacha_question_goes_and_gets_the_codes", async () => {
    const said_meanwhile = [];
    const [text, verdict, , trace] = await new partner.Partner(pack, new LLM()).ask(
      1, [], "was this codified in the Tur or Shulchan Aruch or the Rama?", { announce: (s) => said_meanwhile.push(s) });
    assert.ok(verdict.ok, text);
    assert.ok(text.includes("[[Tur, Orach Chayim 235]]"));
    assert.ok(trace["fetched"].includes("Tur, Orach Chayim 235"));
    assert.ok(trace["fetched"].includes("Shulchan Arukh, Orach Chayim 235:1"));
    assert.ok(trace["fetched"].some((r) => r.startsWith("Mishnah Berurah 235:")));
    assert.ok(said_meanwhile[0].includes("the Tur"));
  });

  test("test_the_fallback_names_what_it_checked_and_passes_the_gate", () => {
    const entry = { "ref": "Tur, Orach Chayim 235", "he": "x" };
    const text = partner.fallback([["Tur", entry]], "en");
    assert.ok(text.includes("the Tur [[Tur, Orach Chayim 235]]"));
    assert.ok(ground.check(text, new Set(["Tur, Orach Chayim 235"])).ok);
    assert.ok(!text.includes("look it up"));
  });

  test("test_the_nudge_waits_for_the_end_of_the_unit", () => {
    assert.equal(partner.unit_nudge(pack, { "line": 1 }, "en", new Set()), null);
    const [text, , n] = partner.unit_nudge(pack, { "line": 5 }, "en", new Set());
    assert.ok(text.includes("Rashi"));
    assert.equal(n, 1);
    assert.equal(partner.unit_nudge(pack, { "line": 5 }, "en", new Set([pack.ref + "|" + 1])), null);
  });

  test("test_tosafot_voices_are_kept_apart", () => {
    const line = partner.argument_line(PACK["segments"][0]["commentaries"]["Tosafot"][0]["structure"]);
    assert.ok(line.includes("position (by רש״י) -> difficulty x4 -> alternative (by ר״ת)"));
    assert.ok(line.includes("alternative (by ר״י)"));
  });

  test("test_nudge_only_at_the_real_machlokes", () => {
    assert.ok(partner.nudge(pack, 1, { language: "en" })[0].includes("Rashi"));
    assert.equal(partner.nudge(pack, 7, { language: "en" }), null);
  });

  test("test_a_turn_is_grounded", async () => {
    const [text, verdict, history] = await new partner.Partner(pack, new LLM()).ask(1, [], "so he's saying you read shema at bedtime");
    assert.ok(verdict.ok, text);
    assert.equal(history.length, 2);
  });

  test("test_an_ungrounded_answer_is_retried", async () => {
    const [text, verdict] = await new partner.Partner(pack, new LLM()).ask(1, [], "UNGROUNDED please");
    assert.ok(verdict.ok, text);
  });
});


describe("FifthRound", () => {
  const pack = new Pack(PACK);

  test("test_when_did_he_live_uses_whoever_was_just_cited", async () => {
    const jobs = (await retrieve.plan(pack, 4, { "kind": "people", "names": [],
                                                "avoid": ["Meiri", "Rashba"] })).map(([j]) => j);
    assert.deepEqual(jobs, [["person", "Meiri", "Meiri on Berakhot", "Berakhot 2a"],
                            ["person", "Rashba", "Rashba on Berakhot", "Berakhot 2a"]]);
    const [found] = await library.gather(jobs);
    const text = found.map(([, e]) => e["he"]).join(" ");
    assert.ok(text.includes("lived 1249–1315"));
    assert.ok(text.includes("lived 1235–1310"));
    assert.ok(text.includes("student of Ramban"));
  });

  test("test_a_sage_off_the_page_is_found_by_name", async () => {
    const entry = await library.person("Rabban Gamliel");
    assert.ok(entry["he"].includes("tanna (sage of the Mishnah era), generation 3"));
    assert.ok(entry["he"].includes("teachers: Rabban Yochanan ben Zakkai"));
    assert.ok(entry["he"].includes("students: Rabbi Yehudah ben Ilai"));
  });

  test("test_answer_it_finds_the_question", () => {
    const history = [{ "role": "user", "content": "[note]\nHow come it's okay to pray Arvit before nightfall? What is the basis?" },
                     { "role": "assistant", "content": "..." },
                     { "role": "user", "content": "[note]\nWhat was my previous question?" },
                     { "role": "assistant", "content": "You asked why early Arvit is allowed." }];
    assert.ok(partner.pending_question(history, "So go ahead and answer.").includes("pray Arvit before nightfall"));
    assert.equal(partner.pending_question(history, "What does chatzot mean?"), null);
  });

  test("test_turns_are_short_by_default", () => {
    assert.ok(partner.SIZE["meaning"].includes("25-45 words"));
    assert.ok(partner.CONSTITUTION.includes("It is a conversation: short turns"));
  });
});


describe("Streaming", () => {
  const pack = new Pack(PACK);

  test("test_an_answer_is_spoken_sentence_by_sentence", async () => {
    const parts = [];
    const [text, verdict, , trace] = await new partner.Partner(pack, new LLM()).ask(
      1, [], "so he's saying you read shema whenever you go to sleep", { on_part: (s) => parts.push(s) });
    assert.ok(verdict.ok);
    assert.equal(parts.length, 2);
    assert.equal(parts.join(" "), text);
    assert.deepEqual([trace["streamed"], trace["retried"], trace["unsaid"]], [2, false, ""]);
    assert.equal(trace["effort"], "minimal");          // a meaning question thinks briefly
  });

  test("test_a_citation_after_the_full_stop_stays_with_its_sentence", async () => {
    const p = new partner.Partner(pack, new LLM());
    p.llm = streaming(["Rashi reads it as a third. ", "[[Rashi on Berakhot 2a:1:2]] ", "And that is all."]);
    const parts = [];
    await p.stream([], null, null, pack.refs(), (s) => parts.push(s));
    assert.deepEqual(parts, ["Rashi reads it as a third. [[Rashi on Berakhot 2a:1:2]]", "And that is all."]);
  });

  test("test_what_is_held_back_is_said_at_the_end", async () => {
    const p = new partner.Partner(pack, new LLM());
    p.llm = streaming(["The night has three watches. ", "Rashi says a third.\n", "Tosafot [[Tosafot on Berakhot 2a:1:1]] asks. ",
                       "Rashi [[Rashi on Berakhot 2a:1:2]] answers."]);
    const parts = [];
    await p.stream([], null, null, pack.refs(), (s) => parts.push(s));
    assert.deepEqual(parts, ["The night has three watches."]);   // stops at the unsourced Rashi
    assert.ok(p.unsaid.startsWith("Rashi says a third."));
  });

  test("test_speed_by_voice", () => {
    assert.equal(smalltalk.reply("Talk a bit faster please")[0], "faster");
    assert.equal(smalltalk.reply("תדבר יותר לאט")[0], "slower");
    assert.equal(smalltalk.reply("why is he faster than the other"), null);
    assert.equal(smalltalk.reply("Okay, enough.")[0], "skip");
    assert.equal(smalltalk.reply("די")[0], "skip");
  });

  // Not in the Python: the server's head start cancels a turn by raising from on_part.
  test("an exception thrown from on_part comes out of ask", async () => {
    class Dropped extends Error {}
    const p = new partner.Partner(pack, new LLM());
    await assert.rejects(p.ask(1, [], "so he's saying you read shema whenever you go to sleep",
                               { route: { "kind": "meaning", "names": [] }, on_part: () => { throw new Dropped("dropped"); } }),
                         Dropped);
  });
});


describe("SixthSitting", () => {
  const pack = new Pack(PACK);

  test("test_sunset_in_a_named_place_is_fetched_not_guessed", async () => {
    assert.equal(library.place_in("Let's say in Tel Aviv."), "Tel Aviv");
    assert.equal(library.place_in("ומה בבני ברק?"), "Bnei Brak");
    assert.equal(library.place_in("Rabbi Eliezer says until the first watch"), null);
    let jobs = (await retrieve.plan(pack, 1, { "kind": "other", "names": [],
                                              "said": "How long till sunset?" })).map(([j]) => j);
    assert.deepEqual(jobs.map((j) => j[0]), ["zmanim"]);
    jobs = (await retrieve.plan(pack, 1, { "kind": "other", "names": [], "place": "Tel Aviv",
                                          "said": "Let's say in Tel Aviv." })).map(([j]) => j);
    assert.equal(jobs[0][2], "Tel Aviv");
    const [found] = await library.gather(jobs);
    assert.ok(found[0][1]["ref"].includes("Zmanim for Tel Aviv"));
    assert.ok(found[0][1]["he"].includes("sunset"));
  });

  test("test_the_place_is_remembered", async () => {
    const memory = {};
    const p = new partner.Partner(pack, new LLM());
    await p.ask(1, [], "Let's say in Tel Aviv.", { route: { "kind": "other", "names": [] }, memory });
    assert.equal(memory["place"], "Tel Aviv");
    assert.ok(memory["fetched"][0][1]["ref"].includes("Zmanim for Tel Aviv"));
  });

  test("test_a_name_many_people_share_brings_all_of_them", async () => {
    const entry = await library.person("Rabban Gamliel");
    assert.ok(entry["he"].includes("Several people are called Rabban Gamliel"));
    assert.ok(entry["he"].includes("Rabban Gamliel haZaken (I)"));
    assert.ok(entry["he"].includes("Rabban Gamliel of Yavneh (II)"));
    assert.ok(!entry["he"].includes("Shimon"));
    const one = await library.person("Rabbi Eliezer");
    assert.ok(!one["he"].includes("Several"));
    assert.ok(one["he"].includes("Hyrcanus"));
  });

  test("test_sefaria_says_which_namesake_is_on_this_page", async () => {
    const entry = await library.person("Rabban Gamliel", { page: "Berakhot 2a" });
    assert.ok(entry["he"].includes("Sefaria ties this page (Berakhot 2a:4-5)"));
    assert.ok(entry["he"].includes("Yavneh"));
    assert.ok(!entry["he"].includes("haZaken"));
    // On a page Sefaria ties to neither, both stay and the partner decides.
    assert.ok((await library.person("Rabban Gamliel", { page: "Berakhot 40a" }))["he"].includes("haZaken"));
  });

  test("test_an_empty_stub_is_not_a_person", async () => {
    assert.equal(await library._topic("rashba"), null);
  });

  test("test_what_was_fetched_a_turn_ago_is_still_citable", async () => {
    const seen = [];
    const Model = { effort: null,
                    say(system, messages) {
                      seen.push(messages[messages.length - 1]["content"]);
                      return "Rabban Gamliel [[About Rabban Gamliel]] led Yavneh.";
                    } };
    const memory = {};
    const p = new partner.Partner(pack, new LLM());
    p.llm = Model;
    await p.ask(1, [], "when did Rabban Gamliel live?", { route: { "kind": "people", "names": ["Rabban Gamliel"] },
                                                          memory });
    const [, verdict, , trace] = await p.ask(1, [], "so which came first?", { route: { "kind": "other", "names": [] },
                                                                            memory });
    assert.ok(verdict.ok, JSON.stringify(trace["first_try"]));
    assert.ok(seen[seen.length - 1].includes("fetched earlier in this conversation"));
  });

  test("test_lets_continue_is_not_answer_it", () => {
    const history = [{ "role": "user", "content": "[note]\nHow about the time they lived, maybe it's chronological?" },
                     { "role": "assistant", "content": "No -- the order is not their ages. Rabban Gamliel was of " +
                                                       "Yavneh and Rabbi Eliezer his contemporary and brother-in-law." }];
    assert.equal(partner.pending_question(history, "Okay, so let's continue."), null);
    assert.equal(partner.pending_question(history, "continue"), null);
    const stub = [...history.slice(0, 1), { "role": "assistant", "content": "Good question." }];
    assert.ok(partner.pending_question(stub, "continue").includes("time they lived"));
    assert.ok(partner.pending_question(history, "you didn't answer my question").includes("time they lived"));
  });

  test("test_um_and_okay_get_no_reply", () => {
    assert.deepEqual(smalltalk.reply("Um."), ["filler", ""]);
    assert.deepEqual(smalltalk.reply("Okay."), ["filler", ""]);
    assert.deepEqual(smalltalk.reply("אוקיי"), ["filler", ""]);
    assert.equal(smalltalk.reply("Okay.", { asked: true }), null);          // a yes to "want it?"
    assert.equal(smalltalk.reply("Go ahead.", { asked: true }), null);
    assert.equal(smalltalk.reply("Okay, so let's continue.")[0], "reading");
    assert.equal(smalltalk.reply("Can you hear me?")[0], "hear_me");
    assert.equal(smalltalk.reply("Okay, now I have a different question."), null);
  });

  test("test_saying_there_is_no_tosafot_needs_no_citation", () => {
    const known = pack.refs();
    assert.ok(ground.check("Right -- no Tosafot here.", known).ok);
    assert.ok(!ground.check("Tosafot says it is the synagogue Shema.", known).ok);
  });

  test("test_rashi_reported_inside_the_tosafot_that_quotes_him", () => {
    const known = pack.refs();
    const p = new partner.Partner(pack, new LLM());
    const text = ("Tosafot challenges Rashi: then people should say all three paragraphs at bedtime. " +
                  "Rabbeinu Tam says the synagogue Shema is primary. [[Tosafot on Berakhot 2a:1:1]]");
    assert.ok(!ground.check(text, known).ok);
    assert.ok(ground.check(text, known, { texts: p.texts }).ok);
    // ...but not across a paragraph.
    assert.ok(!ground.check("Rashi says it is bedtime.\n\nTosafot [[Tosafot on Berakhot 2a:1:1]] asks.",
                            known, { texts: p.texts }).ok);
  });

  test("test_a_sentence_waits_for_the_citation_at_the_end_of_its_paragraph", async () => {
    const p = new partner.Partner(pack, new LLM());
    p.llm = streaming(["Tosafot challenges Rashi: why only one paragraph at bedtime? ",
                       "Rabbeinu Tam says the synagogue Shema is primary. ", "[[Tosafot on Berakhot 2a:1:1]]"]);
    const parts = [];
    await p.stream([], null, null, pack.refs(), (s) => parts.push(s), { texts: p.texts });
    assert.equal(parts.length, 1);
    assert.equal(p.unsaid, "");
  });

  test("test_what_we_have_not_come_to_yet", () => {
    const note = partner.covered_note(pack, 5, [
      { "role": "assistant", "content": "Rashi [[Rashi on Berakhot 2a:1:2]] says a third." }]);
    assert.ok(note.includes("Rashi on Berakhot 2a:1:2]] (cited in this conversation)"));
    assert.ok(note.includes("Tosafot on Berakhot 2a:1:1]] (not cited yet)"));
    assert.ok(search(partner.SO_FAR, "is there a Rashi or Tosfot until now that we didn't read?"));
  });

  test("test_read_it_for_me", () => {
    assert.ok(search(partner.READ_TO_ME, "Can you read it for me?"));
    assert.ok(search(partner.READ_TO_ME, "תקרא לי את השורה"));
    assert.ok(!search(partner.READ_TO_ME, "I'm gonna read the Mishnah"));
  });
});


describe("TheirQuestion", () => {
  // The learner asks what a commentator asks: say whose it is, and offer to read it or tell it.
  const pack = new Pack(PACK);
  const TZELACH = "Tziyyun LeNefesh Chayyah on Berakhot 2a:6";

  test("test_every_commentary_near_the_line_is_scanned_for_its_question", () => {
    const asked = retrieve.asked_here(pack, 1);
    const refs = asked.map(([, e]) => e["ref"]);
    assert.ok(refs.includes(TZELACH));
    const q = asked.find(([, e]) => e["ref"] === TZELACH)[2];
    assert.ok(q.includes("למה הוצרך לומר הכהנים"));
    assert.ok(!new Set(asked.map(([name]) => name)).has("Steinsaltz"));
    // The gemara's own question, quoted, is not the commentator's.
    assert.ok(!search(retrieve.ASKS, "אם כן למה קורין אותה בבית הכנסת"));
    // Nor is the name of a Tosafot: "בתד"ה קשיא".
    const rashash = asked.find(([, e]) => e["ref"] === "Rashash on Berakhot 2a:1")[2];
    assert.ok(rashash.includes('ק"ל דמאי יענה'));
  });

  test("test_it_offers_then_does_what_they_chose", async () => {
    const seen = [];
    const answers = [
      `That's a real question -- it's the Tzelach's [[${TZELACH}]]. Read it together, or the gist?`,
      `«לכאורה יש לדקדק למה הוצרך לומר הכהנים» -- he asks why the priests are named [[${TZELACH}]]. ` +
      "What do you make of it?"][Symbol.iterator]();
    const Model = { effort: null,
                    say(system, messages) {
                      seen.push(messages[messages.length - 1]["content"]);
                      return answers.next().value;
                    } };
    const memory = {};
    const p = new partner.Partner(pack, new LLM());
    p.llm = Model;
    const [, verdict, history, trace] = await p.ask(1, [], "why does the mishna need to say the priests at all?",
                                                    { route: { "kind": "meaning", "names": [] }, memory });
    assert.ok(verdict.ok);
    assert.ok(seen[seen.length - 1].includes("questions the commentaries around this line raise"));
    assert.deepEqual(trace["offered"], [TZELACH]);
    assert.equal(partner.offer_choice(memory["offered"], "let's read it together"), "read");
    assert.equal(partner.offer_choice(memory["offered"], "just give me the gist"), "gist");
    assert.equal(partner.offer_choice(memory["offered"], "no need to read it, just tell me"), "gist");
    assert.equal(partner.offer_choice(memory["offered"], "בוא נקרא ביחד"), "read");
    assert.equal(partner.offer_choice(memory["offered"], "yes please"), "yes");
    assert.equal(partner.offer_choice(memory["offered"], "what does Rashi say about midnight?"), null);
    const [, verdict2, , trace2] = await p.ask(1, history, "let's read it together", { route: { "kind": "other", "names": [] },
                                                                                       memory });
    assert.ok(verdict2.ok);
    assert.equal(trace2["chose"], "read");
    assert.ok(seen[seen.length - 1].includes("chose to read it together"));
    assert.ok(seen[seen.length - 1].includes(`[[${TZELACH}]] Tzelach`));       // the whole comment, opened
    assert.ok(!("offered" in memory));                                          // asked once, answered once
  });

  // test_the_desk_by_voice needs server.desk_command: ported with the server.

  test("test_no_offer_when_it_just_answers", async () => {
    const memory = {};
    const p = new partner.Partner(pack, new LLM());
    p.llm = { effort: null, say: (s, m) => "Rashi [[Rashi on Berakhot 2a:1:1]] reads it as the evening." };
    const [, , , trace] = await p.ask(1, [], "what does the evening mean here?", { route: { "kind": "meaning", "names": [] },
                                                                                   memory });
    assert.deepEqual(trace["offered"], []);
    assert.ok(!("offered" in memory));
  });
});


describe("Table", () => {
  // Settings: who the learner seats at the table, and how many voices a turn opens.
  const pack = new Pack(PACK);
  const route = (kind, favor = null, voices = 3, names = []) => {
    const [prefer, mute] = who.seats(favor || {});
    return { "kind": kind, "names": [...names], "prefer": prefer, "mute": mute, "voices": voices };
  };

  test("test_a_favourite_comes_when_he_has_something_here", () => {
    const got = retrieve.extras(pack, 1, route("meaning", { "Ritva": 1 }), { depth: "daf" }).map(([n]) => n);
    assert.ok(got.includes("Ritva"));
  });

  test("test_one_left_out_stays_out_unless_named", () => {
    let got = retrieve.extras(pack, 1, route("structure", { "Meiri": -1 }), { depth: "rishonim" }).map(([n]) => n);
    assert.ok(!got.includes("Meiri"));
    got = retrieve.extras(pack, 1, route("structure", { "Meiri": -1 }, 3, ["Meiri"]), { depth: "rishonim" }).map(([n]) => n);
    assert.ok(got.includes("Meiri"));
  });

  test("test_voices_caps_what_opens_unasked", () => {
    const got = retrieve.extras(pack, 1, route("logic", null, 1), { depth: "acharonim" });
    assert.equal(got.length, 1);
  });

  const has = (jobs, job) => jobs.some((j) => JSON.stringify(j) === JSON.stringify(job));

  test("test_codes_follow_the_table", async () => {
    const jobs = (await retrieve.plan(pack, 1, route(
      "halacha", { "Mishnah Berurah": -1, "Magen Avraham": 1, "Rambam": -1 }))).map(([j]) => j);
    assert.ok(!has(jobs, ["follow", "Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"]));
    assert.ok(has(jobs, ["follow", "Shulchan Arukh, Orach Chayim 235:1", "Magen Avraham"]));
    assert.ok(!jobs.some((j) => j[0] === "text" && j[1].startsWith("Mishneh Torah")));
  });

  test("test_the_whole_halachic_shelf_is_reachable", async () => {
    let jobs = (await retrieve.plan(pack, 1, route(
      "halacha", { "Kessef Mishneh": 1, "Darkhei Moshe": 1, "Peri Megadim": 1, "Arukh HaShulchan": 1 }))).map(([j]) => j);
    assert.ok(has(jobs, ["follow", "Mishneh Torah, Reading the Shema 1:9", "Kessef Mishneh"]));
    assert.ok(has(jobs, ["follow", "Tur, Orach Chayim 235", "Darkhei Moshe"]));
    assert.ok(has(jobs, ["follow", "Shulchan Arukh, Orach Chayim 235:1", "Peri Megadim"]));
    assert.ok(has(jobs, ["text", "Arukh HaShulchan, Orach Chaim 235"]));
    // Named, not seated: "what does the Raavad say?" reaches him too.
    jobs = (await retrieve.plan(pack, 1, route("meaning", null, 3, ["Raavad"]))).map(([j]) => j);
    assert.ok(has(jobs, ["follow", "Mishneh Torah, Reading the Shema 1:9", "Hasagot HaRaavad"]));
  });

  test("test_sefarias_other_names_are_matched", () => {
    assert.deepEqual(who.filed("Maharshal", new Set(["Chokhmat Shlomo"])), ["Chokhmat Shlomo"]);
    assert.deepEqual(who.filed("Tzelach", new Set(["Tziyyun LeNefesh Chayyah"])), ["Tziyyun LeNefesh Chayyah"]);
    assert.ok(who.note_for("Berakhot").includes("the Ritva"));
  });

  test("test_the_partner_is_told", async () => {
    const seen = [];
    const Model = { effort: null,
                    say(system, messages) {
                      seen.push(messages[messages.length - 1]["content"]);
                      return "The gemara says so.";
                    } };
    const p = new partner.Partner(pack, new LLM(), { favor: { "Ritva": 1, "Meiri": -1 } });
    p.llm = Model;
    await p.ask(1, [], "what does this mean?", { route: { "kind": "meaning", "names": [] } });
    assert.ok(seen[0].includes("they like to hear from Ritva"));
    assert.ok(seen[0].includes("leave out Meiri"));
  });
});


describe("Review", () => {
  // Coming back after a while: what we learned, and questions on it.
  beforeEach(() => {
    review.hooks.LOAD = async (ref) => new Pack(await sefaria.build(ref));
    store.log.clear();                         // Python: a fresh review.SESSIONS_DIR
  });

  // Python wrote sessions/<date>.jsonl; here the rows go to store.log on that day.
  const write = async (date, rows) => {
    for (const row of rows) await store.log.add(row["kind"], { ...row, "at": date + " 12:00:00" });
  };
  const on_disk = () => {
    review.hooks.ON_DISK = async (ref) => (["Berakhot 2a", "Berakhot 2b"].includes(ref) ? new Pack(await sefaria.build(ref)) : null);
  };

  test("test_the_review_is_told_page_by_page_and_cited", async () => {
    const p = new partner.Partner(new Pack(await sefaria.build("Berakhot 2b")), new LLM());
    const [text, verdict, , trace] = await p.ask(1, [], "remind me what the last page was about",
                                                 { route: { "kind": "review", "names": [] } });
    assert.ok(verdict.ok, text);
    assert.ok(text.includes("[[Berakhot 2a]]"));
    assert.deepEqual(trace["fetched"], ["Berakhot 2a", "D.A.F. outline: Berakhot 2"]);
  });

  test("test_did_we_learn_this_is_answered_from_what_was_learned", async () => {
    on_disk();
    await write("2026-09-27", [{ "kind": "heard", "ref": "Berakhot 2a" }]);
    const p = new partner.Partner(new Pack(await sefaria.build("Berakhot 2b")), new LLM());
    const [, , , trace] = await p.ask(5, [], "did we learn «הקטר חלבים» yesterday?",
                                      { route: { "kind": "recall", "names": [] } });
    assert.ok(trace["fetched"].includes("Berakhot 2a:5"));
    assert.ok(trace["fetched"].includes("Berakhot 2a"));          // its recap
  });

  test("test_remind_me_of_the_mishna", async () => {
    const p = new partner.Partner(new Pack(await sefaria.build("Berakhot 2b")), new LLM());
    const [, , , trace] = await p.ask(5, [], "remind me what the mishna was", { route: { "kind": "review", "names": [] } });
    assert.deepEqual(trace["fetched"].slice(0, 2), ["Berakhot 2a:1-5", "Berakhot 2a"]);
  });

  test("test_questions_one_at_a_time", () => {
    assert.ok(partner.SIZE["quiz"].includes("one question"));
    assert.ok(retrieve.KINDS.includes("quiz"));
    assert.deepEqual(retrieve.extras(new Pack(PACK), 1, { "kind": "quiz", "names": [] }, { depth: "acharonim" }), []);
  });
});


describe("VoiceSettings", () => {
  test("test_what_they_ask_now_beats_the_settings", () => {
    assert.ok(partner.CONSTITUTION.includes("What they ask for now beats every setting"));
    assert.ok(partner.CONSTITUTION.includes("ראשי תיבות"));
    assert.ok(!partner.sources_note([], { fetched: [["Tur", { "ref": "Tur, Orach Chayim 235", "he": "x" }]] }).includes("Sefaria"));
  });
});


describe("TrustedSites", () => {
  const pack = new Pack(PACK);

  test("test_the_answer_quotes_the_site", async () => {
    const p = new partner.Partner(pack, new LLM(), { sites: ["halachayomit.co.il"], sites_halacha: true });
    const [text, verdict, , trace] = await p.ask(1, [], "what's the halacha, and what does Rav Ovadia hold?",
                                                 { route: { "kind": "halacha", "names": [] } });
    assert.ok(verdict.ok, text);
    assert.ok(text.includes("Halacha Yomit"));
    assert.ok(trace["fetched"].includes("Halacha Yomit: זמן קריאת שמע של ערבית"));
  });
});


describe("FirstRealSession", () => {
  test("test_no_good_question_for_a_statement", () => {
    assert.ok(!partner.fetching_line(["Recap"], "en").includes("Good question"));
  });
});


describe("CuttingIn", () => {
  // Spoken over an answer still being said: an aside, a correction, a new question, or for later.
  const CUT = { "asked": "was this codified in the Tur?", "said": "The Tur brings the Rosh", "unsaid": "and the Beit Yosef" };

  test("test_the_partner_is_told_how_far_it_got", async () => {
    const seen = [];
    const p = new partner.Partner(new Pack(PACK), new LLM());
    p.llm = { effort: null, say: (s, m) => { seen.push(m[m.length - 1]["content"]); return "Midnight [[Rashi on Berakhot 2a:1:1]]."; } };
    await p.ask(1, [], "what does chatzot mean?", { route: { "kind": "meaning", "names": [] },
                                                    cut: { ...CUT, kind: "aside" } });
    assert.ok(seen[seen.length - 1].includes("quick aside"));
    assert.ok(seen[seen.length - 1].includes("The Tur brings the Rosh"));
    assert.ok(seen[seen.length - 1].includes("one or two sentences"));
    await p.ask(1, [], "no, I mean in the Rambam", { route: { "kind": "meaning", "names": [] },
                                                     cut: { ...CUT, kind: "merge" } });
    assert.ok(seen[seen.length - 1].includes("did not hear: «and the Beit Yosef»"));
  });
});


// -- the same turns, through the Python partner and this one ---------------------------

/** A stand-in for OpenAI that records every request body and passes it on to the fake. */
function recorder() {
  const seen = [];
  const target = new URL(fake.openai);
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => {
      const raw = Buffer.concat(parts);
      const type = (req.headers["content-type"] || "").split(";")[0];
      seen.push([req.method, req.url, type === "application/json" ? JSON.parse(raw.toString("utf8")) : null]);
      const headers = { ...req.headers, host: target.host, "content-length": String(raw.length) };
      const out = http.request({ host: target.hostname, port: target.port, method: req.method, path: req.url, headers },
        (up) => { res.writeHead(up.statusCode, up.headers); up.pipe(res); });
      out.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
      out.end(raw);
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    ok({ seen, url: "http://127.0.0.1:" + server.address().port + "/v1", server });
  }));
}

/** Run a Python script with the turns on stdin; its stdout parsed as JSON. Async: the recorder runs in this process. */
function python(code, input, env) {
  return new Promise((ok, fail) => {
    const child = spawn("python3", ["-c", code], { cwd: ROOT_DIR, env: { ...process.env, PYTHONPATH: ROOT_DIR, ...env },
                                                  stdio: ["pipe", "pipe", "pipe"] });
    const chunks = [];
    let err = "";
    child.stdout.on("data", (d) => { chunks.push(d); });         // decoded whole: a chunk can end mid-letter
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      const out = Buffer.concat(chunks).toString("utf8");
      if (code !== 0) return fail(new Error("python failed: " + err));
      try { ok(JSON.parse(out)); } catch (e) { fail(new Error("python said: " + out + err)); }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

const DAYS = [["2026-09-27", [{ "kind": "heard", "ref": "Berakhot 2a" }, { "kind": "heard", "ref": "Berakhot 2a" }]],
              ["2026-09-28", [{ "kind": "answer", "ref": "Berakhot 2b" }]]];

const READ_SLIP = "מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול מעשר עד סוף האשמורה השנייה";
const TURNS = [
  { "said": "can you hear me?", "n": 1 },
  { "said": "so he's saying you read shema at bedtime", "n": 1 },
  { "said": "what does the Rashba say about this?", "n": 4 },
  { "said": "was this codified in the Tur or Shulchan Aruch or the Rama?", "n": 1 },
  { "said": "did I read it correctly?", "n": 1, "read": READ_SLIP },
  { "said": "what did we learn last time?", "n": 1 },
  { "said": "what does chatzot mean?", "n": 1, "route": { "kind": "meaning", "names": [] },
    "cut": { "asked": "was this codified in the Tur?", "said": "The Tur brings the Rosh", "unsaid": "and the Beit Yosef",
             "kind": "aside" } },
  { "said": "when did Rabban Gamliel live?", "n": 5, "route": { "kind": "people", "names": ["Rabban Gamliel"] } },
  { "said": "why does the mishna need to say the priests at all?", "n": 1, "route": { "kind": "meaning", "names": [] } },
  { "said": "let's read it together", "n": 1, "route": { "kind": "other", "names": [] } },
  { "said": "מה פירוש עד סוף האשמורה הראשונה?", "n": 1, "partner": "he" },
  { "said": "UNGROUNDED please", "n": 1, "stream": true },
  { "said": "did we skip any Rashi so far?", "n": 3, "route": { "kind": "on_commentary", "names": ["Rashi"] } },
  { "said": "so he's saying you read shema whenever you go to sleep", "n": 1, "stream": true },
  { "said": "did we learn «הקטר חלבים» yesterday?", "n": 5, "route": { "kind": "recall", "names": [] } },
  { "said": "So go ahead and answer.", "n": 1, "route": { "kind": "other", "names": [] } },
];

const PY_TURNS = String.raw`
import json, os, sys
from chavruta import align, partner, review, sefaria
from chavruta.llm import LLM
from chavruta.pack import Pack
spec = json.load(sys.stdin)
for date, rows in spec["days"]:
    with open(os.path.join(os.environ["CHAVRUTA_SESSIONS"], date + ".jsonl"), "w") as f:
        for row in rows:
            f.write(json.dumps(row) + "\n")
# The same pack the JavaScript builds: Python orders commentators of equal weight
# as a set of strings iterates, which changes from run to run.
data = spec["pack"]
pack = Pack(data)
review.LOAD = lambda ref: Pack(sefaria.build(ref))
review.ON_DISK = lambda ref: Pack(sefaria.build(ref)) if ref in ("Berakhot 2a", "Berakhot 2b") else None
page = align.Page(data)
partners = {"en": partner.Partner(pack, LLM()), "he": partner.Partner(pack, LLM(), language="he")}
history, memory, out = [], {}, []
for t in spec["turns"]:
    kw = {}
    if t.get("route"):
        kw["route"] = t["route"]
    if t.get("read"):
        kw["recent"] = [{"said": t["read"], "heard": align.listen(page, t["read"])}]
    if t.get("cut"):
        kw["cut"] = t["cut"]
    parts = []
    if t.get("stream"):
        kw["on_part"] = parts.append
    text, verdict, history, trace = partners[t.get("partner", "en")].ask(t["n"], history, t["said"], memory=memory, **kw)
    trace.pop("fetch_seconds", None)
    out.append({"text": text, "ok": verdict.ok, "trace": trace, "parts": parts, "history": history,
                "place": memory.get("place"), "offered": [e["ref"] for _, e in memory.get("offered") or []],
                "carried": [[name, e["ref"], left] for name, e, left in memory.get("fetched", [])]})
print(json.dumps(out, ensure_ascii=False))
`;

async function js_turns(data) {
  store.log.clear();
  for (const [date, rows] of DAYS) {
    for (const row of rows) await store.log.add(row["kind"], { ...row, "at": date + " 12:00:00" });
  }
  const pack = new Pack(data);
  review.hooks.LOAD = async (ref) => new Pack(await sefaria.build(ref));
  review.hooks.ON_DISK = async (ref) => (["Berakhot 2a", "Berakhot 2b"].includes(ref) ? new Pack(await sefaria.build(ref)) : null);
  const page = new align.Page(data);
  const partners = { "en": new partner.Partner(pack, new LLM()), "he": new partner.Partner(pack, new LLM(), { language: "he" }) };
  let history = [];
  const memory = {}, out = [];
  for (const t of TURNS) {
    const kw = { memory };
    if (t.route) kw.route = structuredClone(t.route);
    if (t.read) kw.recent = [{ "said": t.read, "heard": align.listen(page, t.read) }];
    if (t.cut) kw.cut = t.cut;
    const parts = [];
    if (t.stream) kw.on_part = (s) => parts.push(s);
    let text, verdict, trace;
    [text, verdict, history, trace] = await partners[t.partner || "en"].ask(t.n, history, t.said, kw);
    delete trace["fetch_seconds"];
    out.push({ "text": text, "ok": verdict.ok, "trace": trace, "parts": parts, "history": history,
               "place": memory.place ?? null, "offered": (memory.offered || []).map(([, e]) => e.ref),
               "carried": (memory.fetched || []).map(([name, e, left]) => [name, e.ref, left]) });
  }
  return JSON.parse(JSON.stringify(out));
}

/** What the partner sent the model: its own calls and the router's (not recaps or searches, which caches decide). */
const thinking = (seen) => seen.filter(([, url, body]) => url.endsWith("/chat/completions") && body &&
  (body.response_format || body.messages[0].content.startsWith("You are a chavruta"))).map(([, , body]) => body);

describe("Parity", () => {
  test("every prompt, word list and spoken line is the Python's, character for character", async () => {
    const names = ["BACKBONE_IN_PROMPT", "CONSTITUTION", "SIZE", "LANGUAGE", "SPOKEN", "EFFORT", "CUT_NOTE", "CUT_SIZE",
                   "ASKING", "CHOSE", "CHOSE_SIZE", "NUDGE", "NUDGE_PLAIN", "HE_NAMES", "TARGETS"];
    const py = await python("import json, sys\nfrom chavruta import partner\n" +
                            "print(json.dumps({n: getattr(partner, n) for n in json.load(sys.stdin)}, ensure_ascii=False))",
                            names, { CHAVRUTA_SEFARIA_API: fake.sefaria });
    for (const n of names) assert.deepEqual(JSON.parse(JSON.stringify(partner[n])), py[n], n);
    // ...and what the helpers say, in both languages.
    const lines = await python("import json, sys\nfrom chavruta import partner\n" +
      "e = {'ref': 'Tur, Orach Chayim 235', 'he': 'x'}\n" +
      "out = [partner.fetching_line(l, g) for l in json.load(sys.stdin) for g in ('en', 'he')]\n" +
      "out += [partner.fallback(s, g) for s in ([], [('Tur', e)], [('Tur', e), ('Rambam', e), ('Rif', e), ('Ran', e)]) for g in ('en', 'he')]\n" +
      "print(json.dumps(out, ensure_ascii=False))",
      [[], ["Tur"], ["Tur", "Shulchan Arukh", "Mishnah Berurah"], ["Recap", "Recap", "D.A.F. outline"], ["Zmanim"], ["About Rashba"], ["Berakhot 2a"]],
      { CHAVRUTA_SEFARIA_API: fake.sefaria });
    const e = { "ref": "Tur, Orach Chayim 235", "he": "x" };
    const js = [];
    for (const l of [[], ["Tur"], ["Tur", "Shulchan Arukh", "Mishnah Berurah"], ["Recap", "Recap", "D.A.F. outline"], ["Zmanim"], ["About Rashba"], ["Berakhot 2a"]]) {
      for (const g of ["en", "he"]) js.push(partner.fetching_line(l, g));
    }
    for (const s of [[], [["Tur", e]], [["Tur", e], ["Rambam", e], ["Rif", e], ["Ran", e]]]) {
      for (const g of ["en", "he"]) js.push(partner.fallback(s, g));
    }
    assert.deepEqual(js, lines);
  });

  test("nudges, notes and the amud's context on every line agree with the Python", async () => {
    const data = await sefaria.build("Berakhot 2a");
    const history = [{ "role": "assistant", "content": "Rashi [[Rashi on Berakhot 2a:1:2]] says a third." }];
    const py = await python(String.raw`
import json, sys
from chavruta import partner
from chavruta.pack import Pack
spec = json.load(sys.stdin)
pack = Pack(spec["pack"])
out = {"context": partner.amud_context(pack), "lines": []}
for n in range(1, len(pack.segments) + 1):
    out["lines"].append([partner.nudge(pack, n, "en"), partner.nudge(pack, n, "he"), partner.nudge(pack, n),
                         partner.unit_nudge(pack, {"line": n}, "en", set()),
                         partner.unit_nudge(pack, {"line": n}, "he", {(pack.ref, 1)}),
                         partner.covered_note(pack, n, spec["history"]),
                         partner.listener_note(pack, n, {"mode": "reading", "line": n, "from_line": max(1, n - 1)},
                                               spoke="hello"),
                         partner.section_of(pack, n)])
print(json.dumps(out, ensure_ascii=False))
`, { "pack": data, history }, { CHAVRUTA_SEFARIA_API: fake.sefaria });
    const pack = new Pack(data);
    assert.equal(partner.amud_context(pack), py["context"]);
    pack.segments.forEach((seg, i) => {
      const n = i + 1;
      const js = [partner.nudge(pack, n, { language: "en" }), partner.nudge(pack, n, { language: "he" }), partner.nudge(pack, n),
                  partner.unit_nudge(pack, { "line": n }, "en", new Set()),
                  partner.unit_nudge(pack, { "line": n }, "he", new Set([pack.ref + "|" + 1])),
                  partner.covered_note(pack, n, history),
                  partner.listener_note(pack, n, { "mode": "reading", "line": n, "from_line": Math.max(1, n - 1) }, { spoke: "hello" }),
                  partner.section_of(pack, n)];
      assert.deepEqual(js, py["lines"][i], "line " + n);
    });
  });

  test("the Python partner and this one send the model the same prompts and come back with the same turns", async () => {
    const rec = await recorder();
    const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
    const site = fake.sefaria.slice(0, -4);
    const env = {
      CHAVRUTA_SEFARIA_API: fake.sefaria, OPENAI_BASE_URL: rec.url, OPENAI_API_KEY: "sk-test",
      CHAVRUTA_PACKS: tmp("packs-"), CHAVRUTA_SESSIONS: tmp("sessions-"),
      CHAVRUTA_NOTES: path.join(tmp("notes-"), "notes.jsonl"),
      CHAVRUTA_ZMANIM_API: site + "/zmanim", CHAVRUTA_WIKISOURCE_API: site + "/w/api.php",
      CHAVRUTA_WEB_REWRITE: JSON.stringify({ "https://halachayomit.co.il": site + "/hy", "https://www.dafyomi.co.il": site + "/daf" }),
    };
    const { config } = await import("../../web/lib/net.js");
    const saved = config.openai;
    try {
      const data = await sefaria.build("Berakhot 2a");
      const py = await python(PY_TURNS, { "days": DAYS, "turns": TURNS, "pack": data }, env);
      const py_sent = thinking(rec.seen.splice(0));
      config.openai = rec.url;
      const js = await js_turns(data);
      const js_sent = thinking(rec.seen.splice(0));

      if (process.env.PARITY_DUMP) {
        fs.writeFileSync(process.env.PARITY_DUMP + "/py.json", JSON.stringify({ turns: py, sent: py_sent }, null, 1));
        fs.writeFileSync(process.env.PARITY_DUMP + "/js.json", JSON.stringify({ turns: js, sent: js_sent }, null, 1));
      }
      assert.equal(js.length, TURNS.length);
      js.forEach((turn, i) => assert.deepEqual(turn, py[i], "turn " + i + ": " + TURNS[i].said));
      assert.equal(js_sent.length, py_sent.length);
      js_sent.forEach((body, i) => assert.deepEqual(body, py_sent[i], "request " + i));
      // The proof covers what it should: every kind of turn reached the model.
      const kinds = py.map((t) => t.trace.kind);
      for (const k of ["ping", "meaning", "halacha", "check_reading", "review", "people", "other", "on_commentary", "recall"]) {
        assert.ok(kinds.includes(k), k);
      }
      assert.ok(py.some((t) => t.trace.chose === "read"));
      assert.ok(py.some((t) => t.trace.first_try));
      assert.ok(py.some((t) => t.parts.length));
      assert.ok(py_sent.some((b) => b.messages.some((m) => typeof m.content === "string" && m.content.includes("quick aside"))));
    } finally {
      config.openai = saved;
      rec.server.close();
    }
  });
});
