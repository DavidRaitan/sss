import { fake, control } from "./harness.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../../web/lib/net.js";
import { LLM, ModelError, speakable, VOICE_DIRECTION } from "../../web/lib/llm.js";
import * as web from "../../web/lib/web.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/** Run a Python snippet with the repo on its path; its stdout parsed as JSON. */
function python(code, { env = {}, input = "" } = {}) {
  return new Promise((ok, fail) => {
    const child = spawn("python3", ["-c", code], {
      cwd: ROOT, env: { ...process.env, PYTHONPATH: ROOT, OPENAI_API_KEY: "sk-test", ...env },
      stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("close", (code) => {
      if (code !== 0) return fail(new Error("python failed: " + err));
      try { ok(JSON.parse(out)); } catch (e) { fail(new Error("python said: " + out + err)); }
    });
    child.stdin.end(input);
  });
}

// -- Speaking ----------------------------------------------------------------------

test("test_short_quotes_are_spoken_and_citations_are_not", () => {
  // In use the silenced quotes left "it begins … and ends …".
  const said = speakable("Rashi [[Rashi on Berakhot 2a:1:2]] reads «עד סוף האשמורה» as a third of the night.");
  assert.equal(said, "Rashi reads עד סוף האשמורה as a third of the night.");
});

test("test_a_citation_used_as_a_word_leaves_no_hole", () => {
  // In use: "we need the actual text at and and."
  const said = speakable("We need the text at [[Tur, Orach Chayim 235]] and [[Shulchan Arukh, Orach Chayim 235:1]].");
  assert.equal(said, "We need the text at the Tur and the Shulchan Aruch.");
});

test("test_sources_are_for_the_screen_only", () => {
  // In use the voice read "On 2a Berakhot 2a the gemara ..." and the titles of web pages.
  assert.equal(speakable("On 2a [[Berakhot 2a]] the gemara asks about the evening Shema."),
               "On 2a the gemara asks about the evening Shema.");
  assert.equal(speakable("The outline says three questions [[D.A.F. outline: Berakhot 2]]."),
               "The outline says three questions.");
  assert.equal(speakable("Three views ([[Rashi on Berakhot 2a:1:2]], [[Tosafot on Berakhot 2a:1:1]]) " +
                         "and the Meiri."), "Three views and the Meiri.");
  assert.equal(speakable("Wikisource has it (see [[Wikisource: מהרש\"ל]])."), "Wikisource has it.");
});

test("test_a_table_is_read_row_by_row", () => {
  const said = speakable("Three opinions.\n| Who | Holds |\n|---|---|\n| ר' אליעזר | «סוף האשמורה» [[Rashi on Berakhot 2a:1:2]] |\n| חכמים | עד חצות |\nSo the Rabbis are in the middle.");
  assert.ok(!said.includes("|"));
  assert.ok(!said.includes("Who"));
  assert.ok(said.includes("ר' אליעזר, סוף האשמורה."));
  assert.ok(said.includes("חכמים, עד חצות."));
  assert.ok(said.includes("in the middle"));
});

test("test_effort_ladder_survives_a_refusal", async () => {
  await control("/control/reset", {});
  await new LLM().say("x", [{ role: "user", content: "y" }], { heavy: false });
  const log = await control("/control/log");
  const efforts = log.filter((e) => e.path === "chat").map((e) => e.effort);
  assert.deepEqual(efforts.slice(0, 2), ["none", "minimal"]);
});

test("test_every_model_call_is_on_a_short_leash", () => {
  assert.ok(LLM.LEASH["hear"][0] <= 20);
  assert.ok(Math.max(...Object.values(LLM.LEASH).map(([, r]) => r)) <= 1);
});

test("test_one_voice_never_a_substitute", () => {
  assert.ok(!LLM.prototype.speak_stream.toString().includes("alloy"));
  assert.ok(!LLM.prototype.speak.toString().includes("alloy"));
  assert.ok(VOICE_DIRECTION.includes("never two speakers"));
});

// -- TrustedSites ------------------------------------------------------------------

test("test_only_domains_are_trusted", () => {
  assert.deepEqual(web.clean_sites(["https://www.halachayomit.co.il/he/", "he.wikisource.org",
                                    "javascript:alert(1)", "not a site"]),
                   ["halachayomit.co.il", "he.wikisource.org"]);
});

test("test_a_page_is_read_for_its_text_not_its_menus", async () => {
  const entry = await web.page("https://halachayomit.co.il/he/ReadHalacha.aspx?HalachaID=4521", "halachayomit.co.il");
  assert.equal(entry["ref"], "Halacha Yomit: זמן קריאת שמע של ערבית");
  assert.ok(entry["he"].includes("עד עלות השחר"));
  assert.ok(!entry["he"].includes("תפריט"));
  assert.ok(!entry["he"].includes("var x"));
  // (The Python also checked library.text(ref) opens it in the panel; library
  // is not ported here -- what it reads, web.cached(ref), is checked instead.)
  assert.equal((await web.cached(entry["ref"]))["url"], entry["url"]);
});

test("test_the_shaar_hatziyun_is_found_on_wikisource", async () => {
  // The Python went through retrieve.plan and library.gather to web.wikisource;
  // the query it planned ("שער הציון רלה") is given to web.wikisource directly.
  const found = await web.wikisource("שער הציון רלה");
  assert.equal(found[0]["ref"], "Wikisource: שער הציון/רלה");
  assert.ok(found[0]["url"].startsWith("https://he.wikisource.org/wiki/"));
  assert.ok(found[0]["he"].includes("עד חצות"));
});

test("test_the_daf_outline_of_any_page", async () => {
  const entry = await web.outline("Berakhot", 2, async () => []);
  assert.equal(entry["ref"], "D.A.F. outline: Berakhot 2");
  assert.ok(entry["he"].includes("THE TIME FOR THE EVENING SHEMA"));
  assert.ok(!entry["he"].includes("Home | Daf Yomi"));                       // not the menu
  assert.ok(entry["url"].endsWith("/berachos/points/br-ps-002.htm"));
});

test("test_a_tractate_not_listed_is_learned_once", async () => {
  const asked = [];
  const find = async (q, d) => { asked.push(q); return [["https://www.dafyomi.co.il/shabbos/points/sh-ps-002.htm", ""]]; };
  assert.ok((await web.outline("Shabbat", 31, find))["url"].endsWith("/shabbos/points/sh-ps-031.htm"));
  assert.equal((await web.outline("Shabbat", 32, find))["ref"], "D.A.F. outline: Shabbat 32");
  assert.equal(asked.length, 1);                                               // searched once, then known
});

test("web: a page that cannot be read is None, and a site search reads what it finds", async () => {
  assert.equal(await web.page("http://127.0.0.1:1/nothing-here", "halachayomit.co.il"), null);
  const found = await web.search("halachayomit.co.il", "rav ovadia",
                                 (q, d) => new LLM().find_pages(q, d));
  assert.equal(found.length, 1);
  assert.equal(found[0]["ref"], "Halacha Yomit: זמן קריאת שמע של ערבית");
  assert.ok(found[0]["he"].includes("עובדיה יוסף"));
});

test("web: text_of and title_of agree with the Python", async () => {
  const pages = [
    "<html><head><title>A &amp; B &#8211; site</title><style>p{}</style></head><body><nav>menu menu menu menu menu menu menu menu</nav>" +
      "<p>This is a long English sentence that should be kept by the reader &mdash; surely.</p><div>short</div>" +
      "<li>Another fairly long line, with more than six words in it &nbsp; here.</li></body></html>",
    "<title>שלום | אתר</title><div><p>מי שלא קרא קריאת שמע של ערבית עד חצות הלילה, יקרא עד עלות השחר</p>" +
      "<p>English line that is long enough to count but is not Hebrew at all.</p><br>" +
      "<td>עוד שורה בעברית שהיא ארוכה מספיק כדי להיחשב כגוש</td></div>",
    "<p>tiny</p>",
    "<TITLE>  Upper   Case  Title - with dash  </TITLE><SCRIPT>var a = 'a long script that is not text at all no';</SCRIPT>" +
      "<P CLASS=x>Point one: THE TIME FOR THE EVENING SHEMA is given in three opinions here.</P>",
  ];
  const py = await python(
    "import json,sys\nfrom chavruta import web\n" +
    "print(json.dumps([[web.text_of(p), web.title_of(p, 'fb')] for p in json.load(sys.stdin)]))",
    { input: JSON.stringify(pages) });
  assert.deepEqual(pages.map((p) => [web.text_of(p), web.title_of(p, "fb")]), py);
});

// -- speakable(), against the Python -----------------------------------------------

const ANSWERS = [
  "Rashi [[Rashi on Berakhot 2a:1:2]] reads «עד סוף האשמורה» as a third of the night.",
  "We need the text at [[Tur, Orach Chayim 235]] and [[Shulchan Arukh, Orach Chayim 235:1]].",
  "See [[Mishneh Torah, Reading the Shema 1:9]] for the ruling.",
  "As explained according to [[Mishneh Torah, Reading the Shema 1:9]] and [[Mishnah Berurah 235:3]].",
  "The Tur [[Tur, Orach Chayim 235]] rules like Rabban Gamliel -- «והלכה כר\"ג» -- even לכתחלה, until dawn.",
  "On 2a [[Berakhot 2a]] the gemara asks about the evening Shema.",
  "Three views ([[Rashi on Berakhot 2a:1:2]], [[Tosafot on Berakhot 2a:1:1]]) and the Meiri.",
  "Wikisource has it (see [[Wikisource: מהרש\"ל]]).",
  "Halacha Yomit [[Halacha Yomit: זמן קריאת שמע של ערבית]] brings Rav Ovadia's ruling.",
  "זה לא מסתדר. תסתכל על «עד סוף האשמורה הראשונה» — רש״י [[Rashi on Berakhot 2a:1:2]] מסביר שזה שליש הלילה (ראה [[Tosafot on Berakhot 2a:1:1]]).",
  "Three opinions.\n| Who | Holds |\n|---|---|\n| ר' אליעזר | «סוף האשמורה» [[Rashi on Berakhot 2a:1:2]] |\n| חכמים | עד חצות |\nSo the Rabbis are in the middle.",
  "| a | b |\n| c | d |",
  "Before.\n|---|---|\n| only row | here |\nAfter.",
  "  | [[Berakhot 2a]] | [[Rashi on Berakhot 2a]] |\n| real | cell |",
  "He said … … … and then … stopped.",
  "Look  here ,  and  there .  Why ?",
  "per [[Ritva on Berakhot 2a]] and [[Meiri on Berakhot 2a]] too",
  "Like [[Sefer HaChinukh 420]], the count is daily.",
  "Compare with [[Rabbeinu Yonah on Berakhot 1a:1]] here.",
  "AT [[Tur, Orach Chayim 235]] AND [[Shulchan Arukh, Orach Chayim 235:1]] AND [[Mishnah Berurah 235:3]]",
  "the Tur, at [[Tur, Orach Chayim 235]], disagrees",
  "Unclosed «quote here and [[Berakhot 2b]] then.",
  "Empty «» quote and (cf. [[Berakhot 3a]]; [[Berakhot 4a]]) gone.",
  "By [[Talmud Yerushalmi Berakhot 1:1]] it is so.\nNext line from [[Kesef Mishneh]]\n",
  "Read by Rashi (on the verse) with [[Rashi on Deuteronomy 6:7]] and with Tosafot.",
  "Mixed English and עברית «בערבין» here, and «מאימתי» there [[Mishnah Berakhot 1:1]].",
];

test("speakable() says what the Python's says", async () => {
  const py = await python("import json,sys\nfrom chavruta.llm import speakable\n" +
                          "print(json.dumps([speakable(t) for t in json.load(sys.stdin)]))",
                          { input: JSON.stringify(ANSWERS) });
  assert.equal(py.length, ANSWERS.length);
  ANSWERS.forEach((t, i) => assert.equal(speakable(t), py[i], "for: " + t));
});

// -- the requests, against the Python ----------------------------------------------

/** A recording stand-in for OpenAI: every request as [path, accept, content type, body]. */
function capture() {
  const state = { seen: [], fail: [] };
  const server = http.createServer((req, res) => {
    const parts = [];
    req.on("data", (d) => parts.push(d));
    req.on("end", () => {
      const raw = Buffer.concat(parts);
      const type = (req.headers["content-type"] || "").split(";")[0];
      let body = null;
      if (type === "application/json") body = JSON.parse(raw.toString("utf8"));
      else if (type === "multipart/form-data") body = multipart(raw, req.headers["content-type"]);
      const path = req.url.replace(/^\/v1/, "");
      state.seen.push([req.method, path, req.headers["accept"], type, body]);
      if (state.fail.length) {
        const status = state.fail.shift();
        const text = JSON.stringify({ error: { message: "boom", type: "server_error", param: null, code: null } });
        res.writeHead(status, { "Content-Type": "application/json" });
        return res.end(text);
      }
      const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
      if (path === "/chat/completions") {
        const content = body.response_format ? '{"kind": "meaning", "names": ["Rashi"]}' :
          "Rashi [[Rashi on Berakhot 2a:1:2]] reads «עד סוף האשמורה» as a third of the night.";
        if (!body.stream) {
          return json({ id: "x", object: "chat.completion", created: 0, model: body.model,
                        choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }] });
        }
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const words = content.match(/\S+\s*/g);
        for (let i = 0; i < words.length; i += 3) {
          res.write("data: " + JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: body.model,
            choices: [{ index: 0, delta: { content: words.slice(i, i + 3).join("") }, finish_reason: null }] }) + "\n\n");
        }
        return res.end("data: " + JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: body.model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "\n\ndata: [DONE]\n\n");
      }
      if (path === "/audio/transcriptions") return json({ text: "  so he's saying  " });
      if (path === "/audio/speech") {
        res.writeHead(200, { "Content-Type": "audio/mpeg" });
        return res.end(Buffer.alloc(9000, 7));
      }
      if (path === "/responses") {
        const url = "https://halachayomit.co.il/he/ReadHalacha.aspx?HalachaID=4521";
        return json({ id: "r", object: "response", status: "completed", model: body.model, output: [
          { type: "web_search_call", id: "ws", status: "completed",
            action: { type: "search", sources: [{ type: "url", url }, { type: "url", url: "https://elsewhere.com/x" }] } },
          { type: "message", id: "m", role: "assistant", status: "completed", content: [
            { type: "output_text", text: "Found.", annotations: [
              { type: "url_citation", url: "https://www.halachayomit.co.il/other", title: "Other", start_index: 0, end_index: 1 }] }] }] });
      }
      res.writeHead(404); res.end("{}");
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => {
    server.unref();
    ok({ state, url: "http://127.0.0.1:" + server.address().port + "/v1", server });
  }));
}

/** multipart/form-data as [name, filename, content type, value (files in base64)], in order. */
function multipart(raw, header) {
  const boundary = "--" + /boundary=("?)([^";]+)\1/.exec(header)[2];
  const text = raw.toString("latin1");
  return text.split(boundary).slice(1, -1).map((part) => {
    const at = part.indexOf("\r\n\r\n");
    const head = part.slice(0, at), value = part.slice(at + 4, -2);
    const name = /name="([^"]*)"/.exec(head)[1];
    const filename = (/filename="([^"]*)"/.exec(head) || [])[1] || null;
    const type = (/content-type:\s*([^\r\n]+)/i.exec(head) || [])[1] || null;
    return [name, filename, type,
            filename ? Buffer.from(value, "latin1").toString("base64") : Buffer.from(value, "latin1").toString("utf8")];
  });
}

const PY_CALLS = `
import json, sys
from chavruta.llm import LLM
l = LLM()
out = {}
out["say"] = l.say("sys", [{"role": "user", "content": "hello"}], cache_key="k")
out["say_cheap"] = l.say("sys", [{"role": "user", "content": "hello"}, {"role": "assistant", "content": "hi"},
                                {"role": "user", "content": "again"}], heavy=False, max_tokens=300)
out["say_effort"] = l.say("sys", [{"role": "user", "content": "hello"}], effort="high")
out["json"] = l.json("route this", [{"role": "user", "content": "what does Rashi say?"}])
out["stream"] = list(l.say_stream("sys", [{"role": "user", "content": "hello"}], cache_key="k2", max_tokens=500))
out["hear1"] = l.hear(bytes([0, 1, 2, 200, 255]) + "audio".encode(), hint="מאימתי קורין", keywords=["Rashi", "תרומתן"],
                      mime="audio/ogg;codecs=opus")
out["hear2"] = l.hear(b"abc")
out["hear3"] = l.hear(b"wav!", mime="audio/wav")
audio, mime = l.speak("שלום, Rashi says " + "x" * 4000)
out["speak"] = [len(audio), mime]
out["speak_stream"] = [len(c) for c in l.speak_stream("Rashi reads «עד חצות»")]
out["find"] = [list(p) for p in l.find_pages("rav ovadia", ["halachayomit.co.il"])]
print(json.dumps(out))
`;

async function js_calls() {
  const l = new LLM();
  const out = {};
  out["say"] = await l.say("sys", [{ role: "user", content: "hello" }], { cache_key: "k" });
  out["say_cheap"] = await l.say("sys", [{ role: "user", content: "hello" }, { role: "assistant", content: "hi" },
                                         { role: "user", content: "again" }], { heavy: false, max_tokens: 300 });
  out["say_effort"] = await l.say("sys", [{ role: "user", content: "hello" }], { effort: "high" });
  out["json"] = await l.json("route this", [{ role: "user", content: "what does Rashi say?" }]);
  out["stream"] = [];
  for await (const piece of l.say_stream("sys", [{ role: "user", content: "hello" }], { cache_key: "k2", max_tokens: 500 }))
    out["stream"].push(piece);
  out["hear1"] = await l.hear(new Uint8Array([0, 1, 2, 200, 255, ...Buffer.from("audio")]),
                              { hint: "מאימתי קורין", keywords: ["Rashi", "תרומתן"], mime: "audio/ogg;codecs=opus" });
  out["hear2"] = await l.hear(new TextEncoder().encode("abc"));
  out["hear3"] = await l.hear(new TextEncoder().encode("wav!"), { mime: "audio/wav" });
  const [audio, mime] = await l.speak("שלום, Rashi says " + "x".repeat(4000));
  out["speak"] = [audio.length, mime];
  out["speak_stream"] = [];
  for await (const c of l.speak_stream("Rashi reads «עד חצות»")) out["speak_stream"].push(c.length);
  out["find"] = await l.find_pages("rav ovadia", ["halachayomit.co.il"]);
  return out;
}

test("every request body is the one the Python SDK sent, field for field", async () => {
  const cap = await capture();
  const saved = config.openai;
  try {
    const py = await python(PY_CALLS, { env: { OPENAI_BASE_URL: cap.url } });
    const py_seen = cap.state.seen.splice(0);
    config.openai = cap.url;
    const js = await js_calls();
    const js_seen = cap.state.seen.splice(0);
    assert.deepEqual(js, py);
    assert.equal(js_seen.length, py_seen.length);
    js_seen.forEach((r, i) => assert.deepEqual(r, py_seen[i], "request " + i + " " + r[1]));
    assert.deepEqual(py["speak_stream"], [4096, 4096, 808]);
    assert.ok(py_seen.some(([, p, , , b]) => p === "/audio/transcriptions" && b.some(([n]) => n === "keywords[]")));
  } finally {
    config.openai = saved;
    cap.server.close();
  }
});

test("the stand-in logs the same requests from the JavaScript as from the Python", async () => {
  await control("/control/reset", {});
  const py = await python(PY_CALLS, { env: { OPENAI_BASE_URL: fake.openai } });
  const py_log = await control("/control/log");
  await control("/control/reset", {});
  const js = await js_calls();
  const js_log = await control("/control/log");
  assert.deepEqual(js, py);
  assert.deepEqual(js_log, py_log);
  assert.ok(js_log.some((e) => e.path === "chat" && e.stream));
  assert.ok(js_log.some((e) => e.path === "transcribe" && e.prompt.includes("מאימתי קורין")));
});

test("say_stream yields the answer as it is streamed", async () => {
  const pieces = [];
  for await (const p of new LLM().say_stream("x", [{ role: "user", content: "hello" }])) pieces.push(p);
  assert.ok(pieces.length > 1);
  const whole = await new LLM().say("x", [{ role: "user", content: "hello" }]);
  assert.equal(pieces.join(""), whole);
  assert.ok(whole.startsWith("That can't be right."));
});

test("say_stream loosens what the model refuses, as say does", async () => {
  await control("/control/reset", {});
  const l = new LLM({ heavy: "gpt-5.6-luna" });
  const pieces = [];
  for await (const p of l.say_stream("x", [{ role: "user", content: "hello" }], { effort: "none" })) pieces.push(p);
  assert.ok(pieces.length > 1);
  const log = (await control("/control/log")).filter((e) => e.path === "chat");
  assert.deepEqual(log.map((e) => e.effort), ["none", "minimal"]);
  assert.ok(log[1].stream);
});

test("an API error reads as the SDK's did, so _rejects can find the words in it", async () => {
  const py = await python(
    "import json\nfrom openai import OpenAI\n" +
    "try:\n  OpenAI().chat.completions.create(model='gpt-5.6-luna', reasoning_effort='none', " +
    "messages=[{'role': 'user', 'content': 'x'}])\nexcept Exception as e:\n  print(json.dumps(str(e)))",
    { env: { OPENAI_BASE_URL: fake.openai } });
  await assert.rejects(
    new LLM().leashed("cheap").chat.completions.create({ model: "gpt-5.6-luna", reasoning_effort: "none",
                                                          messages: [{ role: "user", content: "x" }] }),
    (e) => { assert.equal(e.message, py); return true; });
  assert.match(py, /^Error code: 400 - \{'error': \{'message': "Unsupported value: 'reasoning_effort'/);
});

test("retries as the SDK did: a server error once more on a leash, a bad request never", async () => {
  const cap = await capture();
  const saved = config.openai;
  try {
    cap.state.fail = [500];
    config.openai = cap.url;
    assert.ok((await new LLM().say("s", [{ role: "user", content: "u" }])).startsWith("Rashi"));
    assert.equal(cap.state.seen.splice(0).length, 2);

    cap.state.fail = [500, 500, 500];
    let js_error = null;
    try { await new LLM().say("s", [{ role: "user", content: "u" }]); } catch (e) { js_error = e; }
    assert.ok(js_error instanceof ModelError);
    assert.equal(cap.state.seen.splice(0).length, 2);                          // LEASH heavy: one retry
    cap.state.fail = [500, 500, 500];
    const py = await python(
      "import json\nfrom chavruta.llm import LLM\n" +
      "try:\n  LLM().say('s', [{'role': 'user', 'content': 'u'}])\nexcept Exception as e:\n  print(json.dumps([str(e)]))",
      { env: { OPENAI_BASE_URL: cap.url } });
    assert.equal(cap.state.seen.splice(0).length, 2);
    assert.equal(js_error.message, py[0]);

    cap.state.fail = [400];
    config.openai = cap.url;
    await assert.rejects(new LLM().say("s", [{ role: "user", content: "u" }]), ModelError);
    assert.equal(cap.state.seen.splice(0).length, 1);
  } finally {
    cap.state.fail = [];
    config.openai = saved;
    cap.server.close();
  }
});

test("the anthropic provider is not in the browser", async () => {
  const l = new LLM({ provider: "anthropic" });
  assert.equal(l.can_hear, false);
  await assert.rejects(l.say("s", [{ role: "user", content: "u" }]), /anthropic provider not available in the browser/);
  assert.throws(() => new LLM({ provider: "nope" }), (e) => e instanceof ModelError && e.message === "unknown provider 'nope'");
});
