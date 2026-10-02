import { fake, control } from "./harness.mjs";
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import * as store from "../../web/lib/store.js";
import * as sefaria from "../../web/lib/sefaria.js";
import * as align from "../../web/lib/align.js";
import * as daily from "../../web/lib/daily.js";
import { Pack } from "../../web/lib/pack.js";
import * as server from "../../web/lib/api.js";

// The server's own tests from tests/test_units.py, against its port (web/lib/api.js).
const PACK = await sefaria.build("Berakhot 2a");

describe("Voice", () => {
  test("test_it_knows_its_own_voice", () => {
    server.SPOKEN.splice(0, server.SPOKEN.length, new Set(server.word_list(
      "בערבין? I have «בערבין» here—the Mishnah opens with the evening Shema, and only later asks about the morning.")));
    // Heard back through the speakers, as in the third sitting.
    assert.ok(server.echo_of_itself(
      "בערבין. I have. בערבין. Here, the Mishnah opens with the evening Shema and only later asks about the morning."));
    assert.ok(!server.echo_of_itself("so what does Rashi say about the first watch?"));
  });
});

describe("VoiceSettings", () => {
  test("test_the_desk_by_voice", () => {
    const pack = new Pack(PACK);
    const cmd = (said, lang = "auto") => server.desk_command(said, pack, lang);
    assert.deepEqual(cmd("put the Rashba on the side")["add"], ["Rashba"]);
    assert.deepEqual(cmd("can you open the Meiri and the Tzelach on the screen")["add"], ["Meiri", "Tzelach"]);
    const got = cmd('תשים את המאירי ואת הצל"ח על המסך');
    assert.deepEqual(got["add"], ["Meiri", "Tzelach"]);
    assert.equal(got["text"], 'פתחתי את המאירי והצל"ח בצד.');
    assert.deepEqual(cmd('תוסיף את הרש"ש לשולחן')["add"], ["Rashash"]);
    assert.ok(cmd("close the desk")["close"]);
    assert.equal(cmd("open the Rashba"), null);                 // a question about him, not the desk
    assert.equal(cmd("put the Ramban on the side"), null);      // not on this page
  });
});

describe("LearningAlong", () => {
  test("test_reading_on_turns_the_page", async () => {
    const two_a = await server.load_pack("Berakhot 2a"), two_b = await server.load_pack("Berakhot 2b");
    assert.ok(two_b);
    const said = "דילמא ביאת אורו הוא ומאי וטהר טהר גברא";
    let heard = align.listen(server.page_of(two_a), said);
    const turned = await server.onto_next_page(two_a, said, heard, 13);
    assert.equal(turned[0], "Berakhot 2b");
    assert.deepEqual([turned[1]["mode"], turned[1]["line"]], ["reading", 1]);
    // Across the break in one breath: the end of 2a, then the start of 2b.
    const across = "וממאי דהאי ובא השמש ביאת השמש והאי וטהר טהר יומא דילמא ביאת אורו הוא ומאי וטהר טהר גברא";
    heard = align.listen(server.page_of(two_a), across);
    assert.equal(((await server.onto_next_page(two_a, across, heard, 14)) || [null])[0], "Berakhot 2b");
    // Not from the middle of the page.
    const middle = "אמר רבה בר רב שילא אם כן לימא קרא ויטהר";
    assert.equal(await server.onto_next_page(two_a, middle, align.listen(server.page_of(two_a), middle), 4), null);
    assert.equal((await server.onto_next_page(two_a, middle, align.listen(server.page_of(two_a), middle), 14))[0],
      "Berakhot 2b");
  });

  test("progress_text", () => {
    const p = { streak: 2, tractates: [{ name: "Berakhot", he: "ברכות", done: 4, total: 125 }],
      daf_yomi: { ref: "Berakhot 2", he: "ברכות ב׳", done: true } };
    assert.match(server.progress_text(p, "en"), /2 days in a row/);
  });
});

describe("HeadStart", () => {
  test("test_it_holds_its_words_until_told_and_a_dropped_one_is_never_heard", async () => {
    let go;
    const gate = () => new Promise((ok) => { go = ok; });
    class Writer {
      constructor() { this.wait = gate(); }
      async ask(n, history, said, { on_part = null } = {}) {
        await this.wait;
        on_part("First sentence.");
        on_part("Second sentence.");
        return ["First sentence. Second sentence.", null, [], {}];
      }
    }
    const state = { "history": [], "memory": { "place": "Jerusalem" } };
    const head = new server.HeadStart(new Writer(), 1, state, "q", null, [], { "kind": "meaning", "cut_in": null }, null).start();
    const heard = [];
    go();
    assert.equal((await head.relay((t) => heard.push(t)))[0], "First sentence. Second sentence.");
    assert.deepEqual(heard, ["First sentence.", "Second sentence."]);
    assert.notEqual(head.memory, state["memory"]);                     // its own copy until used
    const dropped = new server.HeadStart(new Writer(), 1, state, "q", null, [], { "kind": "meaning", "cut_in": null }, null).start();
    dropped.cancel();
    go();
    await new Promise((ok) => setTimeout(ok, 200));
    assert.equal(dropped.out.length, 0);                               // nothing it wrote got out
  });
});

describe("TakingItBack", () => {
  test("test_forgotten_by_the_partner", async () => {
    const state = server.session("forget-test");
    state["history"] = [{ "role": "user", "content": "[note]\nwhat does chatzot mean?" },
      { "role": "assistant", "content": "Midnight." },
      { "role": "user", "content": "[note]\nwho is talking to you?" },
      { "role": "assistant", "content": "You are." }];
    const out = await (await server.handle("/api/forget", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ "session": "forget-test", "said": "who is talking to you?" }) })).json();
    assert.ok(out["removed"]);
    assert.deepEqual(state["history"].map((m) => m["content"]), ["[note]\nwhat does chatzot mean?", "Midnight."]);
    assert.ok(state["discarded"].has("who is talking to you?"));
  });
});

describe("Server", () => {
  test("test_all_of_shas_and_nothing_else", () => {
    assert.ok(server.allowed("Berakhot 64a"));
    assert.ok(!server.allowed("Berakhot 64b"));
    assert.ok(server.allowed("Shabbat 2a"));
    assert.ok(server.allowed("Bava Batra 176b"));
    assert.ok(!server.allowed("Shabbat 158a"));
    assert.ok(server.allowed("Tamid 25b"));
    assert.ok(!server.allowed("Tamid 25a"));       // Tamid opens on 25b
    assert.ok(!server.allowed("Nazir 33b"));       // Sefaria has no 33b
    assert.ok(!server.allowed("../../etc/passwd"));
    assert.equal(sefaria.amudim("Shabbat").length, 312);
  });

  test("test_packs_from_older_code_are_rebuilt", async () => {
    await store.kv.set("packs", "Berakhot 2b", { "ref": "Berakhot 2b", "segments": [{ "n": 1, "ref": "Berakhot 2b:1",
      "he": "x", "commentaries": {} }] });
    const pack = await server.load_pack("Berakhot 2b");
    assert.equal(pack.data["pack_version"], sefaria.PACK_VERSION);
    assert.ok(pack.segments.length > 1);
  });
});

describe("the routes, as the page asks them", () => {
  const get = async (p) => server.handle(p);
  const post = async (p, body) => server.handle(p, { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body) });

  test("a page, and what cannot be opened", async () => {
    const r = await get("/api/daf?ref=" + encodeURIComponent("Berakhot 2a"));
    assert.equal(r.status, 200);
    assert.equal((await r.json()).segments.length, 14);
    assert.equal((await get("/api/daf?ref=Berakhot%2099a")).status, 400);
  });

  test("words heard while reading are followed", async () => {
    const out = await (await post("/api/heard", { ref: "Berakhot 2a", line: 1, session: "s1",
      said: "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן" })).json();
    assert.equal(out.mode, "reading");
    assert.equal(out.line, 1);
  });

  test("a turn, streamed in lines of JSON", async () => {
    const r = await post("/api/say", { ref: "Berakhot 2a", line: 6, session: "s2", stream: true,
      said: "so he's saying you read shema whenever you happen to go to sleep" });
    assert.match(r.headers.get("Content-Type"), /ndjson/);
    const lines = (await r.text()).trim().split("\n").map((l) => JSON.parse(l));
    const last = lines[lines.length - 1];
    assert.equal(last.mode, "answer", JSON.stringify(lines).slice(0, 300));
    assert.ok(lines.some((l) => l.mode === "part"));
    const rows = await store.log.list({ kinds: ["answer"] });
    assert.ok(rows.some((r) => r.said.startsWith("so he's saying")));
  });

  test("a sentence to speak is an address the Worker makes into audio", async () => {
    const out = await (await post("/api/voice", { text: "Go ahead.", ref: "Berakhot 2a" })).json();
    assert.match(out.url, /^\/x\/voice\?/);
    assert.equal(new URLSearchParams(out.url.split("?")[1]).get("input"), "Go ahead.");
  });

  test("notes by voice, kept in the record", async () => {
    const out = await (await post("/api/heard", { ref: "Berakhot 2a", line: 5, session: "s3",
      said: "Note: the fence is for Shema, not the fats" })).json();
    assert.match(out.quick, /Noted, on line/);
    const notes = await (await get("/api/notes?ref=" + encodeURIComponent("Berakhot 2a"))).json();
    assert.ok(notes.notes.some((n) => /the fence/.test(n.text)));
  });
});
