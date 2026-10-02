// Starting the app. Run by the Python server on the Mac (./run.sh), the page
// asks that server, as it always did. On Cloudflare there is no such server:
// the passcode, once per device; then the server's work (lib/api.js) is put
// in place in the page itself. Either way, app.js then begins.

async function door() {
  let r;
  try { r = await fetch("/x/who"); } catch (e) { return; }      // offline: what is kept still opens
  if (r.status !== 401) return;
  const box = document.getElementById("door");
  const form = box.querySelector("form"), input = box.querySelector("input"), note = box.querySelector(".door-note");
  box.hidden = false;
  input.focus();
  await new Promise((done) => {
    form.onsubmit = async (e) => {
      e.preventDefault();
      note.textContent = "";
      const ok = await fetch("/x/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: input.value }) }).then((x) => x.ok).catch(() => false);
      if (ok) { box.hidden = true; done(); }
      else { note.textContent = "לא נכון — נסה שוב."; input.select(); }
    };
  });
}

const python = await fetch("/api/health").then((r) => r.ok && /json/.test(r.headers.get("Content-Type") || ""))
  .catch(() => false);
let api = null;
if (python) {
  window.API = { handle: (path, init) => fetch(path, init) };
} else {
  await door();
  api = await import("./lib/api.js");
  window.API = api;
}
const app = document.createElement("script");
app.src = "app.js";
document.body.append(app);
if (api) {
  api.morning().catch(() => {});
  setInterval(() => api.morning().catch(() => {}), 30 * 60 * 1000);
}
