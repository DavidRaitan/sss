import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fake, control } from "./harness.mjs";
import { startWorker } from "./worker_dev.mjs";

const persist = fs.mkdtempSync(path.join(os.tmpdir(), "chav-"));
const w = await startWorker({ sefaria: fake.sefaria, openaiRoot: fake.control, passcode: "shalom", persist });
const { execSync } = await import("node:child_process");
execSync("npx wrangler d1 execute chavruta --local --persist-to " + persist + " --file schema.sql",
  { cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../worker"), stdio: "ignore" });
test.after(() => w.stop());

let cookie = "";
const go = (p, init = {}) => fetch(w.url + p, { ...init, headers: { ...(init.headers || {}), Cookie: cookie } });

test("the page itself is served to anyone", async () => {
  const r = await fetch(w.url + "/");
  assert.equal(r.status, 200);
  assert.match(await r.text(), /חברותא/);
});

test("without the passcode, nothing behind it", async () => {
  assert.equal((await fetch(w.url + "/x/who")).status, 401);
  assert.equal((await fetch(w.url + "/x/openai/v1/models")).status, 401);
  const wrong = await fetch(w.url + "/x/login", { method: "POST", body: JSON.stringify({ passcode: "nope" }) });
  assert.equal(wrong.status, 401);
});

test("the passcode once, then a cookie", async () => {
  const r = await fetch(w.url + "/x/login", { method: "POST", body: JSON.stringify({ passcode: "shalom" }) });
  assert.equal(r.status, 200);
  const set = r.headers.get("set-cookie");
  assert.match(set, /HttpOnly/);
  assert.doesNotMatch(set, /shalom/);
  cookie = set.split(";")[0];
  assert.equal((await go("/x/who")).status, 200);
});

test("the model, with the key added by the Worker", async () => {
  const r = await go("/x/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "x", messages: [{ role: "system", content: "You are a chavruta." },
      { role: "user", content: "can you hear me?" }] }) });
  assert.equal(r.status, 200);
  assert.ok((await r.json()).choices);
  // and streamed, as answers are
  const s = await go("/x/openai/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "x", stream: true, messages: [{ role: "system", content: "You are a chavruta." },
      { role: "user", content: "can you hear me?" }] }) });
  assert.match(s.headers.get("content-type"), /event-stream/);
  assert.match(await s.text(), /data: \[DONE\]/);
  assert.equal((await go("/x/openai/v1/files", { method: "GET" })).status, 403);   // only what the app uses
});

test("Sefaria through the Worker", async () => {
  const r = await go("/x/sefaria/v3/texts/Berakhot%202a?version=source");
  assert.equal(r.status, 200);
  assert.ok((await r.json()).versions.length);
});

test("a sentence as speech", async () => {
  const r = await go("/x/voice?model=m&voice=cedar&input=" + encodeURIComponent("Go ahead."));
  assert.equal(r.status, 200);
  assert.ok((await r.arrayBuffer()).byteLength > 0);
});

test("the record, kept and read back", async () => {
  for (const row of [{ kind: "heard", at: "2026-10-01 21:00:00", ref: "Berakhot 2a", said: "x" },
                     { kind: "note", at: "2026-10-02 08:00:00", ref: "Berakhot 2b", line: 3, text: "check" }]) {
    const r = await go("/x/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
    assert.equal(r.status, 200);
  }
  const all = (await (await go("/x/events")).json()).rows;
  assert.equal(all.length, 2);
  const notes = (await (await go("/x/events?kinds=note")).json()).rows;
  assert.deepEqual(notes, [{ kind: "note", at: "2026-10-02 08:00:00", ref: "Berakhot 2b", line: 3, text: "check" }]);
  const narrow = (await (await go("/x/events?kinds=heard&fields=ref,at")).json()).rows;
  assert.deepEqual(narrow, [{ ref: "Berakhot 2a", at: "2026-10-01 21:00:00" }]);
  const since = (await (await go("/x/events?since=2026-10-02")).json()).rows;
  assert.equal(since.length, 1);
});

test("another site's page, through the Worker", async () => {
  const site = fake.sefaria.slice(0, -4);
  const r = await go("/x/fetch?url=" + encodeURIComponent(site + "/zmanim?cfg=json&geonameid=281184&date=2026-10-02"));
  assert.equal(r.status, 200);
});
