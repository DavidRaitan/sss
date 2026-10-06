// Starting the app. Run by the Python server on the Mac (./run.sh), the page
// asks that server, as it always did. On Cloudflare there is no such server:
// the server's work (lib/api.js) is put in place in the page itself. Either
// way, app.js then begins.

// Anything that breaks on the phone: said at the top of the screen (so a
// screenshot shows it) and kept in the record (kind "error"). A file that
// will not load (the styles, the app) is said too: that is a page that opens
// half-dressed.
const said = new Set();
function broke(text, show = true) {
  text = String(text || "").slice(0, 400);
  if (!text || said.has(text)) return;
  said.add(text);
  const at = new Date().toISOString().replace("T", " ").slice(0, 19);
  fetch("/x/events", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "error", at, text, ua: navigator.userAgent, page: location.href }) }).catch(() => {});
  const box = document.getElementById("news");
  if (!show || !box) return;
  document.getElementById("news-text").textContent = "משהו השתבש — " + text;
  document.getElementById("news-act").hidden = true;
  box.hidden = false;
}
addEventListener("error", (e) => {
  const t = e.target;
  if (t && t !== window && (t.tagName === "SCRIPT" || t.tagName === "LINK")) {
    const url = t.src || t.href || "";
    if (url.startsWith(location.origin)) broke("לא נטען: " + url.split("/").pop());   // ours; not the fonts'
    return;
  }
  if (e.message) broke(e.message + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : ""));
}, true);
// A promise that failed unseen: only kept, not shown -- most are a slow network, and handled.
addEventListener("unhandledrejection", (e) => broke(e.reason && (e.reason.message || e.reason), false));

const python = await fetch("/api/health").then((r) => r.ok && /json/.test(r.headers.get("Content-Type") || ""))
  .catch(() => false);
let api = null;
if (python) {
  window.API = { handle: (path, init) => fetch(path, init) };
} else {
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
