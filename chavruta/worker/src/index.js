// חברותא on Cloudflare: the page is static; this Worker is the little that
// cannot be in it.
//
//   /x/openai/v1/...   the model, with the key the page must never see
//   /x/voice?...       a sentence as speech, kept at the edge (the same words are never paid for twice)
//   /x/sefaria/...     Sefaria's API, kept at the edge for a day
//   /x/fetch?url=      any other page the partner reads (Wikisource, Hebcal, the study sites)
//   /x/events          the record of every sitting and the learner's notes (D1)
//   /x/who             whether the key is set
//
// Everything that thinks runs in the page. The Worker only passes things
// through, so each request costs it almost no CPU -- which is what keeps it
// on the free plan.

const OPENAI_PATHS = /^(chat\/completions|responses|audio\/transcriptions|audio\/speech|models)$/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/x/")) return env.ASSETS.fetch(request);
    try {
      if (!fromThePage(request, env, url)) return json({ error: "not_from_the_app" }, 403);
      if (url.pathname === "/x/who") return json({ ok: true, key: !!env.OPENAI_API_KEY });
      if (url.pathname.startsWith("/x/openai/v1/")) return openai(request, env, url);
      if (url.pathname === "/x/voice") return voice(request, env, ctx, url);
      if (url.pathname.startsWith("/x/sefaria/")) return sefaria(request, env, ctx, url);
      if (url.pathname === "/x/fetch") return page(request, ctx, url);
      if (url.pathname === "/x/events") return events(request, env, url);
      return json({ error: "not_found" }, 404);
    } catch (err) {
      return json({ error: "worker: " + (err && err.message || err) }, 502);
    }
  },
};

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}

// -- only the app's own page ----------------------------------------------------------
// No passcode: the link is enough. But the Worker answers only the page it
// serves -- not another website, and not a request that says it comes from
// nowhere -- so it is not a free door to the OpenAI key for the whole web.
// (A determined person with the link can still use the app itself; an
// OpenAI spending limit is the real ceiling.) OPEN=1 (tests, ./run.sh on the
// Mac) skips the check.

function fromThePage(request, env, url) {
  if (env.OPEN === "1") return true;
  const site = request.headers.get("Sec-Fetch-Site");
  if (site) return site === "same-origin";
  const from = request.headers.get("Origin") || request.headers.get("Referer");
  try { return !!from && new URL(from).host === url.host; } catch (e) { return false; }
}

// -- the model ------------------------------------------------------------------------

async function openai(request, env, url) {
  const path = url.pathname.slice("/x/openai/v1/".length);
  if (!OPENAI_PATHS.test(path)) return json({ error: "not_allowed" }, 403);
  if (!env.OPENAI_API_KEY) return json({ error: { message: "OPENAI_API_KEY is not set on the Worker" } }, 500);
  const headers = { Authorization: "Bearer " + env.OPENAI_API_KEY };
  const type = request.headers.get("Content-Type");
  if (type) headers["Content-Type"] = type;
  // Streamed straight through: the first words of an answer reach the page as they are written.
  return fetch(base(env.OPENAI_BASE, "https://api.openai.com") + "/v1/" + path + url.search, {
    method: request.method, headers, body: request.method === "GET" ? undefined : request.body });
}

// A sentence as speech: GET, so the page can hand the address to an <audio>
// and hear it begin while the rest is still being made; and kept at the edge.
async function voice(request, env, ctx, url) {
  const cache = caches.default, key = new Request(url.toString(), { method: "GET" });
  const kept = await cache.match(key);
  if (kept) return kept;
  const q = url.searchParams, input = q.get("input") || "";
  if (!input.trim() || input.length > 4000) return json({ error: "nothing_to_say" }, 400);
  const body = { model: q.get("model"), voice: q.get("voice"), input, response_format: q.get("format") || "mp3" };
  if (q.get("instructions")) body.instructions = q.get("instructions");
  const r = await fetch(base(env.OPENAI_BASE, "https://api.openai.com") + "/v1/audio/speech", {
    method: "POST", headers: { Authorization: "Bearer " + env.OPENAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body) });
  if (!r.ok) return new Response(r.body, { status: r.status, headers: { "Content-Type": "application/json" } });
  const type = r.headers.get("Content-Type") || "audio/mpeg";
  const [toPage, toCache] = r.body.tee();
  ctx.waitUntil(new Response(toCache, { headers: { "Content-Type": type, "Cache-Control": "public, max-age=2592000" } })
    .arrayBuffer().then((buf) => cache.put(key, new Response(buf, {
      headers: { "Content-Type": type, "Cache-Control": "public, max-age=2592000" } }))).catch(() => {}));
  return new Response(toPage, { headers: { "Content-Type": type, "Cache-Control": "no-store" } });
}

// -- reading the world ------------------------------------------------------------------

async function cached(request, ctx, target, seconds, init = {}) {
  if (request.method !== "GET") return json({ error: "get_only" }, 405);
  const cache = caches.default, key = new Request("https://cache.chavruta/" + encodeURIComponent(target));
  const kept = await cache.match(key);
  if (kept) return kept;
  const r = await fetch(target, { headers: { "User-Agent": "chavruta (study partner)", ...(init.headers || {}) },
    redirect: "follow" });
  const out = new Response(r.body, r);
  out.headers.delete("Set-Cookie");
  out.headers.set("Cache-Control", r.ok ? "public, max-age=" + seconds : "no-store");
  if (r.ok) ctx.waitUntil(cache.put(key, out.clone()).catch(() => {}));
  return out;
}

function sefaria(request, env, ctx, url) {
  const target = base(env.SEFARIA_BASE, "https://www.sefaria.org/api") + "/" +
    url.pathname.slice("/x/sefaria/".length) + url.search;
  // A day: a page of Talmud does not change, and the calendar is asked again tomorrow.
  return cached(request, ctx, target, url.pathname.includes("calendars") ? 600 : 86400);
}

function page(request, ctx, url) {
  const target = url.searchParams.get("url") || "";
  let parsed;
  try { parsed = new URL(target); } catch (e) { return json({ error: "bad_url" }, 400); }
  if (!/^https?:$/.test(parsed.protocol)) return json({ error: "bad_url" }, 400);
  return cached(request, ctx, parsed.toString(), 3600);
}

function base(value, fallback) { return (value || fallback).replace(/\/+$/, ""); }

// -- the record -------------------------------------------------------------------------
// One row per thing that happened, as the sessions/*.jsonl and notes.jsonl files
// were: {kind, at, ...}. Read back by kind and day; `fields` keeps the answer small
// when only where and when are wanted.

async function events(request, env, url) {
  if (!env.DB) return json({ error: "no_database" }, 500);
  if (request.method === "POST") {
    const row = await request.json();
    if (!row || typeof row.kind !== "string" || typeof row.at !== "string") return json({ error: "bad_row" }, 400);
    const body = JSON.stringify(row);
    if (body.length > 200000) return json({ error: "too_big" }, 413);
    await env.DB.prepare("INSERT INTO events (at, kind, ref, body) VALUES (?, ?, ?, ?)")
      .bind(row.at, row.kind, typeof row.ref === "string" ? row.ref : null, body).run();
    return json({ ok: true });
  }
  const q = url.searchParams, where = [], args = [];
  const kinds = (q.get("kinds") || "").split(",").filter(Boolean);
  if (kinds.length) { where.push("kind IN (" + kinds.map(() => "?").join(",") + ")"); args.push(...kinds); }
  if (q.get("since")) { where.push("at >= ?"); args.push(q.get("since")); }
  const fields = (q.get("fields") || "").split(",").filter(Boolean);
  const narrow = fields.length && fields.every((f) => ["at", "kind", "ref"].includes(f));
  const sql = "SELECT " + (narrow ? "at, kind, ref" : "body") + " FROM events" +
    (where.length ? " WHERE " + where.join(" AND ") : "") + " ORDER BY id LIMIT 20000";
  const { results } = await env.DB.prepare(sql).bind(...args).all();
  const rows = results.map((r) => {
    if (!narrow) {
      const row = JSON.parse(r.body);
      return fields.length ? Object.fromEntries(fields.filter((f) => f in row).map((f) => [f, row[f]])) : row;
    }
    return Object.fromEntries(fields.filter((f) => r[f] !== null).map((f) => [f, r[f]]));
  });
  return json({ rows });
}
