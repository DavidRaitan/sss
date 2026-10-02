// Python's habits, for code carried over from the Python server.
//
// The partner was written and tested in Python; this keeps its meaning when it
// runs in the browser. Above all regular expressions: Python's \b and \w know
// Hebrew letters, JavaScript's do not -- `\bמשנה\b` would never match here.
// `re()` takes a pattern as Python wrote it and returns the RegExp that means
// the same thing.

const WORD = "\\p{L}\\p{N}_";   // what Python's \w matches: letters and digits (not nikud marks), and _
const W = "[" + WORD + "]";
const B = "(?:(?<=" + W + ")(?!" + W + ")|(?<!" + W + ")(?=" + W + "))";
const NB = "(?:(?<=" + W + ")(?=" + W + ")|(?<!" + W + ")(?!" + W + "))";
// Escapes that mean something in a u-mode RegExp; any other "\x" is just x.
const MEANINGFUL = new Set("^$\\.*+?()[]{}|/-0123456789bBdDwWsStrnvfkpPucx0".split(""));
const QUANT = /^\{\d+(,\d*)?\}|^\{,\d+\}/;

function translate(src, multiline = false) {
  let out = "", inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      const n = src[i + 1];
      i++;
      if (n === undefined) { out += "\\\\"; break; }
      if (!inClass) {
        if (n === "b") { out += B; continue; }
        if (n === "B") { out += NB; continue; }
        if (n === "w") { out += W; continue; }
        if (n === "W") { out += "[^" + WORD + "]"; continue; }
        if (n === "A") { out += "(?<![\\s\\S])"; continue; }
        if (n === "Z") { out += "(?![\\s\\S])"; continue; }
        if (n === "-") { out += "-"; continue; }
      } else {
        if (n === "w") { out += WORD; continue; }
        if (n === "W") throw new Error("re(): \\W inside [...] has no JavaScript equivalent: " + src);
        if (n === "b") { out += "\\x08"; continue; }
      }
      if (n === "u" && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 1, i + 5))) { out += "\\u" + src.slice(i + 1, i + 5); i += 4; continue; }
      if (n === "x" && /^[0-9a-fA-F]{2}$/.test(src.slice(i + 1, i + 3))) { out += "\\x" + src.slice(i + 1, i + 3); i += 2; continue; }
      if (n === "U" && /^[0-9a-fA-F]{8}$/.test(src.slice(i + 1, i + 9))) {
        out += "\\u{" + src.slice(i + 1, i + 9).replace(/^0+/, "") + "}"; i += 8; continue;
      }
      if (n === "u" || n === "x" || n === "c" || n === "k" || n === "p" || n === "P") { out += "\\" + n; continue; }
      if (MEANINGFUL.has(n) || /[a-zA-Z0-9]/.test(n)) out += "\\" + n;
      else out += n === " " ? " " : n;            // \" \' \# \~ \< \> ... are just the character
      continue;
    }
    if (inClass) {
      if (c === "]" && (out.endsWith("[") || out.endsWith("[^"))) { out += "\\]"; continue; }   // []...] in Python
      if (c === "]") inClass = false;
      else if (c === "[") { out += "\\["; continue; }
      out += c;
      continue;
    }
    if (c === "[") { inClass = true; out += c; continue; }
    // Python's $ (without re.M) also matches before a newline that ends the string.
    if (c === "$" && !multiline) { out += "(?=\\n?(?![\\s\\S]))"; continue; }
    if (c === "(" && src.startsWith("(?P<", i)) { out += "(?<"; i += 3; continue; }
    if (c === "(" && src.startsWith("(?P=", i)) {
      const end = src.indexOf(")", i);
      out += "\\k<" + src.slice(i + 4, end) + ">"; i = end; continue;
    }
    if (c === "{" && !QUANT.test(src.slice(i))) { out += "\\{"; continue; }
    if (c === "}") {
      const open = out.lastIndexOf("{");
      const quant = open >= 0 && out[open - 1] !== "\\" && QUANT.test(out.slice(open) + "}");
      out += quant ? "}" : "\\}";
      continue;
    }
    out += c;
  }
  return out;
}

// re.VERBOSE: whitespace and #-comments outside classes and escapes are not part of the pattern.
function verbose(src) {
  let out = "", inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") { out += c + (src[i + 1] || ""); i++; continue; }
    if (inClass) { if (c === "]") inClass = false; out += c; continue; }
    if (c === "[") { inClass = true; out += c; continue; }
    if (/\s/.test(c)) continue;
    if (c === "#") { while (i < src.length && src[i] !== "\n") i++; continue; }
    out += c;
  }
  return out;
}

const CACHE = new Map();
/** A Python pattern as a RegExp. flags: Python's letters "i", "s", "m" (and "g"). */
export function re(src, flags = "") {
  if (src instanceof RegExp) return src;
  const key = flags + "\u0000" + src;
  let r = CACHE.get(key);
  if (!r) {
    // Python's inline flags at the very start: (?i), (?s), (?is) ...
    const inline = /^\(\?([aiLmsux]+)\)/.exec(src);
    let body = src;
    if (inline) { flags += inline[1]; body = src.slice(inline[0].length); }
    if (flags.includes("x")) body = verbose(body);
    const f = [...new Set(("u" + flags.replace(/[^imsg]/g, "")).split(""))].join("");
    r = new RegExp(translate(body, flags.includes("m")), f);
    CACHE.set(key, r);
  }
  return r;
}
const withFlag = (r, f) => (r.flags.includes(f) ? new RegExp(r.source, r.flags) : new RegExp(r.source, r.flags + f));
const rx = (p) => (p instanceof RegExp ? p : re(p));

/** Python's match object, over a JavaScript match. */
export class Match {
  constructor(m, string) {
    this.m = m; this.string = string;
  }
  group(...ns) {
    if (!ns.length) ns = [0];
    const one = (n) => {
      const v = typeof n === "number" ? this.m[n] : (this.m.groups || {})[n];
      return v === undefined ? null : v;
    };
    return ns.length === 1 ? one(ns[0]) : ns.map(one);
  }
  groups(dflt = null) { return Array.from(this.m).slice(1).map((v) => (v === undefined ? dflt : v)); }
  groupdict(dflt = null) {
    const out = {};
    for (const [k, v] of Object.entries(this.m.groups || {})) out[k] = v === undefined ? dflt : v;
    return out;
  }
  start(n = 0) {
    if (n === 0) return this.m.index;
    const d = this.m.indices;
    return d && d[n] ? d[n][0] : -1;
  }
  end(n = 0) {
    if (n === 0) return this.m.index + this.m[0].length;
    const d = this.m.indices;
    return d && d[n] ? d[n][1] : -1;
  }
  span(n = 0) { return [this.start(n), this.end(n)]; }
  get lastindex() {
    for (let i = this.m.length - 1; i > 0; i--) if (this.m[i] !== undefined) return i;
    return null;
  }
}

/** re.search */
export function search(p, s) {
  const r = withFlag(rx(p), "d");
  r.lastIndex = 0;
  const m = r.exec(s);
  return m ? new Match(m, s) : null;
}
/** re.match: only at the start */
export function match(p, s) {
  const r = withFlag(withFlag(rx(p), "y"), "d");
  r.lastIndex = 0;
  const m = r.exec(s);
  return m ? new Match(m, s) : null;
}
/** re.fullmatch */
export function fullmatch(p, s) {
  const r = rx(p);
  const whole = new RegExp("(?:" + r.source + ")$", [...new Set((r.flags + "yd").split(""))].join("").replace("g", ""));
  whole.lastIndex = 0;
  const m = whole.exec(s);
  return m ? new Match(m, s) : null;
}
/** re.finditer */
export function* finditer(p, s) {
  const r = withFlag(withFlag(rx(p), "g"), "d");
  for (const m of s.matchAll(r)) yield new Match(m, s);
}
/** re.findall: whole matches, or the one group, or tuples of the groups. */
export function findall(p, s) {
  const out = [];
  for (const m of finditer(p, s)) {
    const g = m.groups("");
    out.push(g.length === 0 ? m.group(0) : g.length === 1 ? g[0] : g);
  }
  return out;
}
/** Python's replacement template (\1, \g<1>, \g<name>) applied to a match. */
function expand(template, m) {
  return template.replace(/\\(?:g<([^>]+)>|(\d{1,2})|(.))/g, (all, g, d, other) => {
    if (g !== undefined) return m.group(/^\d+$/.test(g) ? +g : g) || "";
    if (d !== undefined) return m.group(+d) || "";
    return { n: "\n", t: "\t", r: "\r", "\\": "\\" }[other] ?? "\\" + other;
  });
}
/** re.sub: repl is a Python template string or a function of a Match. */
export function sub(p, repl, s, count = 0) {
  let n = 0, out = "", last = 0;
  for (const m of finditer(p, s)) {
    if (count && n >= count) break;
    out += s.slice(last, m.start()) + (typeof repl === "function" ? repl(m) : expand(repl, m));
    last = m.end();
    n++;
  }
  return out + s.slice(last);
}
/** re.subn */
export function subn(p, repl, s, count = 0) {
  let n = 0;
  const out = sub(p, (m) => { n++; return typeof repl === "function" ? repl(m) : expand(repl, m); }, s, count);
  return [out, n];
}
/** re.split, groups included as Python includes them. */
export function split(p, s, maxsplit = 0) {
  const out = [];
  let last = 0, n = 0;
  for (const m of finditer(p, s)) {
    if (maxsplit && n >= maxsplit) break;
    out.push(s.slice(last, m.start()), ...m.groups(null).map((g) => g));
    last = m.end();
    n++;
  }
  out.push(s.slice(last));
  return out;
}
/** re.escape */
export const escape = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&").replace(/\s/g, (c) => "\\" + c);

// -- strings, as Python has them --------------------------------------------------

/** str.split(): with no separator, on any run of whitespace, no empties. */
export function pysplit(s, sep = null, maxsplit = -1) {
  if (sep === null || sep === undefined) {
    const parts = s.trim().split(/\s+/).filter(Boolean);
    if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
    const out = [];
    let rest = s.trim();
    for (let i = 0; i < maxsplit; i++) {
      const m = /\s+/.exec(rest);
      out.push(rest.slice(0, m.index));
      rest = rest.slice(m.index + m[0].length);
    }
    out.push(rest);
    return out;
  }
  const parts = s.split(sep);
  if (maxsplit < 0 || parts.length <= maxsplit + 1) return parts;
  return [...parts.slice(0, maxsplit), parts.slice(maxsplit).join(sep)];
}
/** str.rsplit(sep, maxsplit) */
export function rsplit(s, sep = null, maxsplit = -1) {
  if (maxsplit < 0) return pysplit(s, sep);
  if (sep === null || sep === undefined) {
    const parts = s.trim().split(/\s+/).filter(Boolean);
    if (parts.length <= maxsplit + 1) return parts;
    const head = parts.slice(0, parts.length - maxsplit).join(" ");
    return [head, ...parts.slice(parts.length - maxsplit)];
  }
  const parts = s.split(sep);
  if (parts.length <= maxsplit + 1) return parts;
  return [parts.slice(0, parts.length - maxsplit).join(sep), ...parts.slice(parts.length - maxsplit)];
}
const charsRe = (chars) => (chars === null || chars === undefined ? "\\s" : "[" + chars.replace(/[\\\]^-]/g, "\\$&") + "]");
export const strip = (s, chars = null) => s.replace(new RegExp("^" + charsRe(chars) + "+|" + charsRe(chars) + "+$", "gu"), "");
export const lstrip = (s, chars = null) => s.replace(new RegExp("^" + charsRe(chars) + "+", "u"), "");
export const rstrip = (s, chars = null) => s.replace(new RegExp(charsRe(chars) + "+$", "u"), "");
/** str.partition */
export function partition(s, sep) {
  const i = s.indexOf(sep);
  return i < 0 ? [s, "", ""] : [s.slice(0, i), sep, s.slice(i + sep.length)];
}
/** str.title() */
export const title = (s) => s.toLowerCase().replace(/(^|[^\p{L}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
/** str.capitalize() */
export const capitalize = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
/** "%s" % ... with %s, %d, %r, %%. */
export function fmt(template, ...args) {
  if (args.length === 1 && Array.isArray(args[0])) args = args[0];
  let i = 0;
  return template.replace(/%(\.\d+f|0?\d*d|s|r|%)/g, (all, k) => {
    if (k === "%") return "%";
    const v = args[i++];
    if (k === "s") return str(v);
    if (k === "r") return repr(v);
    if (k.endsWith("f")) return Number(v).toFixed(+k.slice(1, -1));
    const width = parseInt(k, 10) || 0;
    const t = String(Math.trunc(Number(v)));
    return k.startsWith("0") ? t.padStart(width, "0") : t.padStart(width, " ");
  });
}
/** str(x) as Python prints it */
export function str(v) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (Array.isArray(v)) return "[" + v.map(repr).join(", ") + "]";
  if (v instanceof Set) return v.size ? "{" + [...v].map(repr).join(", ") + "}" : "set()";
  if (typeof v === "object") return "{" + Object.entries(v).map(([k, x]) => repr(k) + ": " + repr(x)).join(", ") + "}";
  return String(v);
}
export function repr(v) {
  if (typeof v === "string") return v.includes("'") && !v.includes('"') ? '"' + v + '"' : "'" + v.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
  return str(v);
}

// -- values ---------------------------------------------------------------------

/** Python's truth: empty strings, lists, dicts and sets are false. */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === "" || Number.isNaN(v)) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Set || v instanceof Map) return v.size > 0;
  if (typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype) return Object.keys(v).length > 0;
  return true;
}
/** `a or b` */
export const or = (...vs) => { for (const v of vs.slice(0, -1)) if (truthy(v)) return v; return vs[vs.length - 1]; };
export const range = (a, b, step = 1) => {
  if (b === undefined) { b = a; a = 0; }
  const out = [];
  for (let i = a; step > 0 ? i < b : i > b; i += step) out.push(i);
  return out;
};
export const zip = (...xs) => range(Math.min(...xs.map((x) => x.length))).map((i) => xs.map((x) => x[i]));
export const sum = (xs, start = 0) => xs.reduce((a, b) => a + b, start);
export const any = (xs) => xs.some(truthy);
export const all = (xs) => xs.every(truthy);
/** sorted(xs, key=..., reverse=...): stable, and compares as Python does (numbers, strings, tuples). */
export function sorted(xs, key = null, reverse = false) {
  const k = key || ((x) => x);
  const out = [...xs].map((x, i) => [k(x), i, x]);
  out.sort((a, b) => cmp(a[0], b[0]) * (reverse ? -1 : 1) || a[1] - b[1]);
  return out.map((x) => x[2]);
}
export function cmp(a, b) {
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = cmp(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "boolean") a = +a;
  if (typeof b === "boolean") b = +b;
  if (typeof a === "string" && typeof b === "string") return a < b ? -1 : a > b ? 1 : 0;   // code points, like Python
  return a < b ? -1 : a > b ? 1 : 0;
}
export const max = (xs, key = null) => xs.reduce((best, x) => (best === undefined || cmp((key || ((v) => v))(x), (key || ((v) => v))(best)) > 0 ? x : best), undefined);
export const min = (xs, key = null) => xs.reduce((best, x) => (best === undefined || cmp((key || ((v) => v))(x), (key || ((v) => v))(best)) < 0 ? x : best), undefined);
/** round(), banker's rounding as Python does it. */
export function pyround(x, nd = 0) {
  const f = 10 ** nd, v = x * f, r = Math.round(v);
  if (nd > 0 && Number.isFinite(x)) {
    // Python rounds x's exact binary value: round(0.025, 2) is 0.03, though 0.025 * 100 is 2.5.
    // A true tie only when x * 2**(nd+1) is an odd integer; then to even.
    const twice = x * 2 ** (nd + 1);
    if (Number.isInteger(twice) && Math.abs(twice % 2) === 1) return 2 * Math.round(v / 2) / f;
    return Number(x.toFixed(nd));       // toFixed rounds the exact value
  }
  const out = Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r;
  return nd ? out / f : out;
}
/** Counter */
export function counter(xs) {
  const c = new Map();
  for (const x of xs) c.set(x, (c.get(x) || 0) + 1);
  return c;
}
/** json.dumps(x, ensure_ascii=False): Python's separators, ", " and ": ". */
export function dumps(v, { indent = null, sort_keys = false } = {}) {
  const walk = (x, depth) => {
    if (x === null || x === undefined) return "null";
    if (x instanceof Set) x = [...x];
    if (Array.isArray(x)) {
      if (!x.length) return "[]";
      if (indent === null) return "[" + x.map((y) => walk(y, depth + 1)).join(", ") + "]";
      const pad = " ".repeat(indent * (depth + 1));
      return "[\n" + x.map((y) => pad + walk(y, depth + 1)).join(",\n") + "\n" + " ".repeat(indent * depth) + "]";
    }
    if (typeof x === "object") {
      let keys = Object.keys(x).filter((k) => x[k] !== undefined);
      if (sort_keys) keys = keys.sort();
      if (!keys.length) return "{}";
      if (indent === null) return "{" + keys.map((k) => JSON.stringify(k) + ": " + walk(x[k], depth + 1)).join(", ") + "}";
      const pad = " ".repeat(indent * (depth + 1));
      return "{\n" + keys.map((k) => pad + JSON.stringify(k) + ": " + walk(x[k], depth + 1)).join(",\n") + "\n" + " ".repeat(indent * depth) + "}";
    }
    if (typeof x === "number" && Number.isInteger(x)) return String(x);
    if (typeof x === "number") return String(x).includes(".") || String(x).includes("e") ? String(x) : x.toFixed(1);
    return JSON.stringify(x);
  };
  return walk(v, 0);
}
/** A deep copy (copy.deepcopy) of plain data, Sets and Maps included. */
export function deepcopy(v) {
  if (v instanceof Set) return new Set([...v].map(deepcopy));
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [deepcopy(k), deepcopy(x)]));
  if (Array.isArray(v)) return v.map(deepcopy);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = deepcopy(x);
    return out;
  }
  return v;
}
/** time.time() */
export const now = () => Date.now() / 1000;
/** Await with a deadline: the value, or `fallback` once `seconds` have passed. */
export function within(promise, seconds, fallback = null) {
  let timer;
  return Promise.race([promise, new Promise((ok) => { timer = setTimeout(() => ok(fallback), seconds * 1000); })])
    .finally(() => clearTimeout(timer));
}
