import test from "node:test";
import assert from "node:assert/strict";
import { fake } from "./harness.mjs";
import { getJSON, config } from "../../web/lib/net.js";

test("the stand-ins answer", async () => {
  const d = await getJSON(config.sefaria + "/v3/texts/Berakhot%202a?version=source");
  assert.ok(d.versions.length >= 1);
  assert.match(fake.openai, /\/v1$/);
});
