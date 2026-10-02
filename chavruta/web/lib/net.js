// The network, from the browser.
//
// The page cannot hold the OpenAI key or reach most sites itself, so it goes
// through the Worker: /x/openai/... for the model, /x/sefaria/... for Sefaria,
// and /x/fetch?url=... for any other page (Wikisource, Hebcal, the study
// sites). Everything that was an environment variable on the Python server is
// a field of `config` here; the tests point it straight at the stand-ins.

export const config = {
  sefaria: "/x/sefaria",                 // Sefaria's /api root (Python: CHAVRUTA_SEFARIA_API)
  openai: "/x/openai/v1",                // OpenAI's /v1 root
  proxy: "/x/fetch?url=",                // prefix for any other address; "" fetches it directly
  wikisource: "https://he.wikisource.org/w/api.php",
  zmanim: "https://www.hebcal.com/zmanim",
  wiki: "https://en.wikipedia.org/api/rest_v1/page/summary/",
  place: "281184", placeName: "Jerusalem", tz: "Asia/Jerusalem",
  web_rewrite: {},                       // {"https://site": "http://stand-in"} (Python: CHAVRUTA_WEB_REWRITE)
  provider: "openai",
  models: { heavy: "gpt-5.6-terra", cheap: "gpt-5.6-luna", stt: "gpt-transcribe", tts: "gpt-4o-mini-tts", voice: "cedar" },
  effort: "low",
  fetch: (...a) => fetch(...a),          // replaceable in tests
};

// A test run hands the page its stand-ins before anything loads.
if (typeof globalThis !== "undefined" && globalThis.CHAVRUTA_CONFIG) Object.assign(config, globalThis.CHAVRUTA_CONFIG);

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message || "HTTP " + status);
    this.status = status; this.body = body;
  }
}

/** The address to actually ask: a stand-in if one is configured, through the Worker if it is elsewhere. */
export function route(url) {
  for (const [from, to] of Object.entries(config.web_rewrite || {}))
    if (url.startsWith(from)) { url = to + url.slice(from.length); break; }
  if (config.proxy && /^https?:\/\//i.test(url)) return config.proxy + encodeURIComponent(url);
  return url;
}

/** fetch with a deadline (seconds), routed as above. */
export async function request(url, { timeout = 20, method = "GET", headers = {}, body = null, signal = null, direct = false } = {}) {
  const ctl = new AbortController();
  const timer = timeout ? setTimeout(() => ctl.abort(new Error("timed out")), timeout * 1000) : null;
  if (signal) signal.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });
  try {
    return await config.fetch(direct ? url : route(url), { method, headers, body, signal: ctl.signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** GET and parse JSON; throws HttpError on a status >= 400. */
export async function getJSON(url, opts = {}) {
  const r = await request(url, opts);
  const text = await r.text();
  if (!r.ok) throw new HttpError(r.status, "HTTP " + r.status + " for " + url, text);
  return JSON.parse(text);
}

/** GET as text; throws HttpError on a status >= 400. */
export async function getText(url, opts = {}) {
  const r = await request(url, opts);
  const text = await r.text();
  if (!r.ok) throw new HttpError(r.status, "HTTP " + r.status + " for " + url, text);
  return text;
}

/** urllib.parse.urlencode */
export const urlencode = (params) => Object.entries(params)
  .filter(([, v]) => v !== undefined && v !== null)
  .flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : [[k, v]]))
  .map(([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)).replace(/%20/g, "+"))
  .join("&");
/** urllib.parse.quote (safe "/" by default, as Python's) */
export const quote = (s, safe = "/") => encodeURIComponent(s).replace(/%2F/g, safe.includes("/") ? "/" : "%2F")
  .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
