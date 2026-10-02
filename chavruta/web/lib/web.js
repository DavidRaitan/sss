// Trusted sites: what Sefaria does not have, read from sites the learner trusts.
//
// Two ways in. Hebrew Wikisource has a real API -- search it, then read the page
// -- and holds works Sefaria lacks (Sha'ar HaTziyun, Birkei Yosef, the Mordechai
// on Berakhot, the Chazon Ish). Every other site (Halacha Yomit, for Rav
// Ovadia's rulings) is found by a web search limited to that site, and the page
// it points to is then read directly, so what the partner quotes is the site's
// own words, with its address, and never a search engine's summary of them.
//
// A site's text belongs to its authors. It is read for this learner's study,
// quoted briefly, and always cited with where it came from.

import { config, request, urlencode, quote, HttpError } from "./net.js";
import * as store from "./store.js";
import { re, search as re_search, match, sub, split, findall, strip, pysplit, fmt, sum } from "./py.js";
import { unescape } from "./html.js";

export const LABELS = { "halachayomit.co.il": "Halacha Yomit", "he.wikisource.org": "Wikisource",
                        "dafyomi.co.il": "D.A.F. outline" };
export const DEFAULT_SITES = ["halachayomit.co.il", "he.wikisource.org", "dafyomi.co.il"];
// WIKISOURCE_API is config.wikisource (CHAVRUTA_WIKISOURCE_API), read when it is used.
// REWRITE is config.web_rewrite (CHAVRUTA_WEB_REWRITE): for tests,
// {"https://halachayomit.co.il": "http://127.0.0.1:port/hy"}; net.js applies it to every address.
export const DOMAIN = re(String.raw`^[a-z0-9-]+(\.[a-z0-9-]+)+$`);
export const HEBREW = re(String.raw`[א-ת]`);
// Pages read this session (url -> entry, or null for one that could not be read).
// The ones that were read are also kept in store.kv "pages", so they are not
// fetched again on the next visit.
export const _PAGES = new Map();


export function clean_sites(sites) {
  // Domains only: "halachayomit.co.il", never a URL or anything else.
  const out = [];
  for (let site of sites || []) {
    site = strip(String(site)).toLowerCase();
    site = sub(String.raw`^https?://`, "", site).split("/")[0];
    if (site.startsWith("www.")) site = site.slice(4);
    if (match(DOMAIN, site) && !out.includes(site)) out.push(site);
  }
  return out.slice(0, 8);
}


export function label(domain) {
  return LABELS[domain] || domain;
}


// What urllib could raise reading a page: the network, a status, a bad reply.
// (The Python caught URLError, TimeoutError, OSError, ValueError; anything else
// was a bug and was let through.)
function _unreadable(e) {
  return e instanceof HttpError || e instanceof SyntaxError || e instanceof TypeError ||
    (e && (e.name === "AbortError" || e.name === "TimeoutError" || e.message === "timed out"));
}


export async function _get(url, { timeout = 8 } = {}) {
  // config.web_rewrite (the Python's REWRITE) is applied by net.js on the way out.
  const response = await request(url, { timeout, headers: { "User-Agent": "chavruta/0.3 (personal study tool)" } });
  if (!response.ok) throw new HttpError(response.status, "HTTP " + response.status + " for " + url);
  const raw = new Uint8Array(await response.arrayBuffer()).slice(0, 2_000_000);
  const type = response.headers.get("content-type") || "";
  const charset = (/charset=["']?([^"';\s]+)/i.exec(type) || [])[1] || "utf-8";
  return new TextDecoder(charset, { fatal: false }).decode(raw);
}


export const BLOCK = re(String.raw`</?(p|div|br|li|h[1-6]|td|tr|section|article|blockquote)\b[^>]*>`, "i");

const isalpha = (ch) => /^\p{L}$/u.test(ch);
const letters_in = (s) => { let n = 0; for (const ch of s) if (isalpha(ch)) n++; return n; };
const len = (s) => [...s].length;


export function text_of(page) {
  // The body of a page as plain text: its prose blocks, not menus, footers or
  // scripts. On a Hebrew page, the blocks that are mostly Hebrew; on an English
  // one (the D.A.F. outlines), the blocks of real sentences.
  page = sub(String.raw`(?is)<(script|style|nav|header|footer|form|noscript)\b.*?</\1>`, " ", page);
  const blocks = [];
  for (const block of split(BLOCK, page)) {
    if (!block || len(block) < 2) continue;
    const plain = strip(sub(String.raw`\s+`, " ", unescape(sub(String.raw`<[^>]+>`, " ", block))));
    if (len(plain) >= 40) blocks.push(plain);
  }
  const letters = sum(blocks.map(letters_in)) || 1;
  const hebrew_page = sum(blocks.map((b) => findall(HEBREW, b).length)) / letters > 0.3;
  const out = [];
  for (const plain of blocks) {
    const share = findall(HEBREW, plain).length / (letters_in(plain) || 1);
    if (hebrew_page ? (share > 0.5) : (pysplit(plain).length >= 6)) out.push(plain);
  }
  return out.join("\n");
}


export function title_of(page, fallback) {
  const m = re_search(String.raw`(?is)<title[^>]*>(.*?)</title>`, page);
  let title = m ? strip(unescape(sub(String.raw`\s+`, " ", m.group(1)))) : "";
  title = title ? split(String.raw`\s+[|\-–]\s+`, title)[0] : "";
  return [...(title || fallback)].slice(0, 70).join("");
}


async function _remembered(url) {
  if (_PAGES.has(url)) return [true, _PAGES.get(url)];
  const kept = await store.kv.get("pages", url);
  if (kept) {
    _PAGES.set(url, kept);
    return [true, kept];
  }
  return [false, null];
}

async function _remember(url, entry) {
  _PAGES.set(url, entry);
  if (entry) await store.kv.set("pages", url, entry);
}


export async function page(url, domain, { title = "" } = {}) {
  // One page of a trusted site as a citable entry, or None.
  const [known, kept] = await _remembered(url);
  if (known) return kept;
  let entry = null;
  try {
    const body = await _get(url);
    const text = text_of(body);
    if (text) {
      const name = title_of(body, title || url);
      entry = { "ref": fmt("%s: %s", label(domain), name), "he": text.slice(0, 6000), "url": url,
                "dibur": null, "fetched": true, "site": domain };
    }
  } catch (e) {
    if (!_unreadable(e)) throw e;
    entry = null;
  }
  await _remember(url, entry);
  return entry;
}


export async function search(domain, query, find) {
  // Pages of one site that answer `query`, read. `find(query, domains)` is
  // the web search (llm.find_pages).
  const out = [];
  for (const [url, title] of (await find(query, [domain])).slice(0, 2)) {
    const entry = await page(url, domain, { title });
    if (entry && !out.map((e) => e["ref"]).includes(entry["ref"])) out.push(entry);
  }
  return out;
}


export async function wikisource(query, { limit = 2 } = {}) {
  // Hebrew Wikisource through its own API: search, then read the pages.
  let hits;
  try {
    const q = urlencode({ "action": "query", "list": "search", "srsearch": query,
                          "srlimit": limit, "format": "json" });
    hits = (JSON.parse(await _get(config.wikisource + "?" + q))["query"] || {})["search"] || [];
  } catch (e) {
    if (!_unreadable(e)) throw e;
    return [];
  }
  const out = [];
  for (const hit of hits.slice(0, limit)) {
    const title = hit["title"];
    const url = "https://he.wikisource.org/wiki/" + quote(title.replaceAll(" ", "_"));
    const [known, kept] = await _remembered(url);
    if (known) {
      if (kept) out.push(kept);
      continue;
    }
    let entry = null;
    try {
      const q = urlencode({ "action": "parse", "page": title, "prop": "text",
                            "format": "json", "formatversion": 2 });
      const parsed = JSON.parse(await _get(config.wikisource + "?" + q))["parse"] || {};
      const text = text_of(parsed["text"] || "");
      if (text) {
        entry = { "ref": fmt("Wikisource: %s", title), "he": text.slice(0, 6000), "url": url,
                  "dibur": null, "fetched": true, "site": "he.wikisource.org" };
      }
    } catch (e) {
      if (!_unreadable(e)) throw e;
      entry = null;
    }
    await _remember(url, entry);
    if (entry) out.push(entry);
  }
  return out;
}


export async function cached(ref) {
  for (const e of _PAGES.values()) if (e && e["ref"] === ref) return e;
  for (const url of await store.kv.keys("pages")) {
    const e = await store.kv.get("pages", url);
    if (e && e["ref"] === ref) {
      _PAGES.set(url, e);
      return e;
    }
  }
  return null;
}


// Which works live on which trusted site, by how people say them.
export const WORKS = [
  ["halachayomit.co.il", re(
    String.raw`rav ovadia|rabbi ovadia|ovadia yosef|yalkut yosef|yabia omer|yechaveh da'?at|chazon ovadia|` +
    String.raw`halacha yomit|הרב עובדיה|עובדיה יוסף|ילקוט יוסף|יביע אומר|יחוה דעת|חזון עובדיה|הלכה יומית`, "i")],
  ["he.wikisource.org", re(
    String.raw`sha'?ar ha-?tziyun|שער הציון|birkei yosef|ברכי יוסף|mordechai|מרדכי|chazon ish|חזון איש|` +
    String.raw`wikisource|ויקיטקסט`, "i")],
];
export const ANY_SITE = re(String.raw`\b(search|check|look) (it )?(up )?(online|the web|the internet|your sites|trusted sites)\b|` +
                           String.raw`תחפש באינטרנט|תבדוק באתרים|באתרים`, "i");


// -- the D.A.F. point-by-point outline of every daf (Kollel Iyun Hadaf) --------
//
// dafyomi.co.il/<folder>/points/<abbr>-ps-<daf>.htm, one page per daf, in
// English, for all of Shas. The folders and abbreviations below were seen in
// its own addresses; for a tractate not listed, the first daf is found by a
// search limited to the site, and the pattern is learned from the address and
// kept, so every later daf is a single page read.
export const DAF_SITE = "dafyomi.co.il";
export const DAF_KNOWN = { "Berakhot": ["berachos", "br"], "Taanit": ["taanis", "tn"], "Sotah": ["sotah", "so"],
                           "Yevamot": ["yevamos", "ye"], "Kiddushin": ["kidushin", "kd"], "Bava Metzia": ["bmetzia", "bm"],
                           "Zevachim": ["zevachim", "zv"], "Menachot": ["menachos", "mn"],
                           "Rosh Hashanah": ["rhashanah", "rh"] };
export const DAF_URL = re(String.raw`dafyomi\.co\.il/([a-z_]+)/points/([a-z]+)-ps-\d+\.htm`, "i");


// What was learned is kept in store.kv "outlines", one key per tractate (the
// Python kept the same dict in packs/_dafyomi_sites.json).
export async function _pattern(masechta, find) {
  if (masechta in DAF_KNOWN) return DAF_KNOWN[masechta];
  let learned;
  try {
    learned = await store.kv.get("outlines", masechta);
  } catch (e) {
    learned = null;
  }
  if (learned) return [...learned];
  for (const [url] of await find(fmt("POINT BY POINT OUTLINE %s 2 dafyomi.co.il points", masechta), [DAF_SITE])) {
    const m = re_search(DAF_URL, url);
    if (m) {
      const found = [m.group(1).toLowerCase(), m.group(2).toLowerCase()];
      try {
        await store.kv.set("outlines", masechta, found);
      } catch (e) {
        // not kept: found again next time
      }
      return [...found];
    }
  }
  return null;
}


export async function outline(masechta, daf, find) {
  // The D.A.F. point-by-point outline of one daf, as a citable entry, or None.
  const pattern = await _pattern(masechta, find);
  if (!pattern) return null;
  const [folder, abbr] = pattern;
  const url = fmt("https://www.dafyomi.co.il/%s/points/%s-ps-%03d.htm", folder, abbr, Math.trunc(Number(daf)));
  let entry = await page(url, DAF_SITE);
  if (entry) {
    entry = { ...entry, "ref": fmt("D.A.F. outline: %s %s", masechta, daf) };
    await _remember(url, entry);
  }
  return entry;
}
