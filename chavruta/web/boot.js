// Starting the app. Run by the Python server on the Mac (./run.sh), the page
// asks that server, as it always did. On Cloudflare there is no such server:
// the server's work (lib/api.js) is put in place in the page itself. Either
// way, app.js then begins.

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
