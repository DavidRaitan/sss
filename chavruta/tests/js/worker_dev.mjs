// The real Worker, run locally by wrangler (workerd), pointed at the stand-ins.
// Used by worker.test.mjs and by the end-to-end test.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const freePort = () => new Promise((ok) => {
  const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
});

/** Start the Worker; resolves to {url, stop()} once it answers. vars: extra --var values. */
export async function startWorker({ sefaria, openaiRoot, passcode = "", vars = {}, persist = null } = {}) {
  const port = await freePort();
  const args = ["wrangler", "dev", "--port", String(port), "--ip", "127.0.0.1", "--log-level", "warn",
    "--var", "SEFARIA_BASE:" + sefaria, "--var", "OPENAI_BASE:" + openaiRoot, "--var", "OPENAI_API_KEY:sk-test"];
  if (passcode) args.push("--var", "PASSCODE:" + passcode);
  else args.push("--var", "OPEN:1");
  for (const [k, v] of Object.entries(vars)) args.push("--var", k + ":" + v);
  if (persist) args.push("--persist-to", persist);
  // Its own process group, so stopping it stops workerd too, not only npx.
  const child = spawn("npx", args, { cwd: path.join(ROOT, "worker"), stdio: ["ignore", "pipe", "pipe"], detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: "false", CI: "1" } });
  const stop = () => { try { process.kill(-child.pid, "SIGTERM"); } catch (e) {} };
  process.on("exit", stop);
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const url = "http://127.0.0.1:" + port;
  for (let i = 0; i < 120; i++) {
    try { const r = await fetch(url + "/x/who"); if (r.status) break; } catch (e) {}
    await new Promise((ok) => setTimeout(ok, 500));
    if (child.exitCode !== null) throw new Error("wrangler dev exited:\n" + log);
  }
  child.stdout.unref?.(); child.stderr.unref?.(); child.unref();
  return { url, log: () => log, stop };
}
