// What the Python server kept on disk, kept here.
//
//   kv   -- things worth not fetching or computing twice: built packs, recaps,
//           daf-yomi days, pages from the study sites, the tractate index.
//           On a phone or a laptop: this browser's IndexedDB.
//   log  -- the record of every sitting (sessions/<date>.jsonl) and the
//           learner's notes (notes.jsonl): what must follow them from one
//           device to another. In the app: the Worker's D1 database.
//
// Both are async. Tests use the in-memory stand-ins (useMemory()).

const memoryKV = () => {
  const m = new Map();
  return {
    async get(ns, key) { return m.has(ns + "\u0000" + key) ? structuredClone(m.get(ns + "\u0000" + key)) : null; },
    async set(ns, key, value) { m.set(ns + "\u0000" + key, structuredClone(value)); },
    async del(ns, key) { m.delete(ns + "\u0000" + key); },
    async keys(ns) { return [...m.keys()].filter((k) => k.startsWith(ns + "\u0000")).map((k) => k.slice(ns.length + 1)); },
    clear() { m.clear(); },
  };
};

const memoryLog = () => {
  let rows = [];
  return {
    // fields as Python's record(): anything; `at` ("YYYY-MM-DD HH:MM:SS", local) is added if missing.
    async add(kind, fields = {}) {
      const row = Object.assign({}, fields, { kind, at: fields.at || stamp() });
      rows.push(row);
      return row;
    },
    // Rows of these kinds (all if none), from this day on ("YYYY-MM-DD"), oldest first;
    // with `fields`, only those fields of each row (the Worker can then send far less).
    async list({ kinds = null, since = null, fields = null } = {}) {
      return rows.filter((r) => (!kinds || kinds.includes(r.kind)) && (!since || r.at.slice(0, 10) >= since))
        .map((r) => (fields ? Object.fromEntries(fields.filter((f) => f in r).map((f) => [f, r[f]])) : structuredClone(r)));
    },
    clear() { rows = []; },
  };
};

/** "YYYY-MM-DD HH:MM:SS" in local time, as time.strftime made it. */
export function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " +
    p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
}
/** "YYYY-MM-DD", local. */
export const today = (d = new Date()) => stamp(d).slice(0, 10);

// -- the browser's backends -----------------------------------------------------

function idbKV(name = "chavruta") {
  let db = null;
  const open = () => db || (db = new Promise((ok, fail) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("kv");
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  }));
  const tx = async (mode, fn) => {
    const d = await open();
    return new Promise((ok, fail) => {
      const t = d.transaction("kv", mode), s = t.objectStore("kv");
      const r = fn(s);
      t.oncomplete = () => ok(r && "result" in r ? r.result : undefined);
      t.onerror = () => fail(t.error);
    });
  };
  const fallback = memoryKV();      // a private window, or storage refused: still works, just forgets
  const safe = (f, alt) => async (...a) => { try { return await f(...a); } catch (e) { return alt(...a); } };
  return {
    get: safe(async (ns, key) => (await tx("readonly", (s) => s.get(ns + "/" + key))) ?? null, fallback.get),
    set: safe((ns, key, value) => tx("readwrite", (s) => s.put(value, ns + "/" + key)), fallback.set),
    del: safe((ns, key) => tx("readwrite", (s) => s.delete(ns + "/" + key)), fallback.del),
    keys: safe(async (ns) => ((await tx("readonly", (s) => s.getAllKeys(IDBKeyRange.bound(ns + "/", ns + "/￿")))) || [])
      .map((k) => k.slice(ns.length + 1)), fallback.keys),
  };
}

function workerLog(base = "/x/events") {
  const pending = [];
  return {
    async add(kind, fields = {}) {
      const row = Object.assign({}, fields, { kind, at: fields.at || stamp() });
      try {
        await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(row) });
      } catch (e) {
        pending.push(row);            // offline: kept, and sent with the next one
      }
      while (pending.length) {
        try {
          await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pending[0]) });
          pending.shift();
        } catch (e) { break; }
      }
      return row;
    },
    async list({ kinds = null, since = null, fields = null } = {}) {
      const q = new URLSearchParams();
      if (kinds) q.set("kinds", kinds.join(","));
      if (since) q.set("since", since);
      if (fields) q.set("fields", fields.join(","));
      try {
        const r = await fetch(base + "?" + q);
        if (!r.ok) return [];
        return (await r.json()).rows || [];
      } catch (e) { return []; }
    },
  };
}

const inBrowser = typeof indexedDB !== "undefined" && typeof location !== "undefined";
export let kv = inBrowser ? idbKV() : memoryKV();
export let log = inBrowser ? workerLog() : memoryLog();

/** For tests: fresh in-memory stores. */
export function useMemory() {
  kv = memoryKV();
  log = memoryLog();
  return { kv, log };
}
