// Every JavaScript test starts here: the same stand-ins for Sefaria and OpenAI
// the Python tests use (tests/fake_*.py, replaying recorded Sefaria data),
// with the app's network and storage pointed at them -- exactly as
// tests/test_units.py set its environment.

import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { config } from "../../web/lib/net.js";
import { useMemory } from "../../web/lib/store.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const child = spawn("python3", [path.join(ROOT, "tests/serve_fakes.py")], { stdio: ["pipe", "pipe", "inherit"] });
const line = await new Promise((ok) => createInterface({ input: child.stdout }).once("line", ok));
export const fake = JSON.parse(line);           // {sefaria: ".../api", openai: ".../v1", control: "http://127.0.0.1:port"}
child.unref(); child.stdout.unref(); child.stdin.unref();
process.on("exit", () => child.kill());

const site = fake.sefaria.slice(0, -4);         // the stand-in also plays the study sites, Hebcal and Wikisource
Object.assign(config, {
  sefaria: fake.sefaria, openai: fake.openai, proxy: "",
  zmanim: site + "/zmanim", wikisource: site + "/w/api.php",
  web_rewrite: { "https://halachayomit.co.il": site + "/hy", "https://www.dafyomi.co.il": site + "/daf" },
});
export const stores = useMemory();
export const ROOT_DIR = ROOT;

/** Talk to the OpenAI stand-in's control endpoints (/control/transcript, /control/log, /control/latency, /control/reset). */
export async function control(pathname, body) {
  const r = await fetch(fake.control + pathname, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.headers.get("content-type")?.includes("json") ? r.json() : r.text();
}
