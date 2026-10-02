// A daf pack, loaded, and the questions the rest of the app asks of it.
//
// The pack is the only thing the partner is allowed to know about the page. If a
// claim is not traceable to something in here, it does not ship (see ground.py).
//
// Ported from chavruta/pack.py. Packs that were files on disk are store.kv
// entries (ns "packs", key = ref).

import { truthy, or, sorted } from "./py.js";
import * as store from "./store.js";


export class Pack {
  constructor(data) {
    this.data = data;
    this.segments = data.segments;
    this.is_fixture = truthy(data.fixture);
    this.fixture_note = Object.hasOwn(data, "fixture_note") ? data.fixture_note : "";
  }

  // Python: Pack.load(path) read a file; here the pack stored under its ref,
  // or null if none is.
  static async load(ref) {
    const data = await store.kv.get("packs", ref);
    if (data === null || data === undefined) {
      return null;
    }
    return new this(data);
  }

  get ref() {
    return this.data.ref;
  }

  segment(n) {
    for (const segment of this.segments) {
      if (segment.n === n) {
        return segment;
      }
    }
    return this.segments[Math.min(Math.max(n, 1), this.segments.length) - 1];
  }

  /** Every reference the partner may cite. Anything else was invented. */
  refs() {
    const known = new Set([this.ref]);
    for (const segment of this.segments) {
      known.add(segment.ref);
      for (const r of segment.halacha ?? []) known.add(r);
      for (const r of segment.xrefs ?? []) known.add(r);
      for (const refs of Object.values(or(segment.related ?? null, {}))) {
        for (const r of refs) known.add(r);
      }
      for (const entries of Object.values(segment.commentaries)) {
        for (const e of entries) known.add(e.ref);
      }
    }
    return known;
  }

  commentators() {
    return [...or(this.data.commentators ?? null,
      sorted([...new Set(this.segments.flatMap((s) => Object.keys(s.commentaries)))]))];
  }

  sources_for(n, { names = null } = {}) {
    const segment = this.segment(n);
    const found = [];
    const wanted = (name) => (names instanceof Set || names instanceof Map ? names.has(name)
      : Array.isArray(names) ? names.includes(name) : Object.hasOwn(names, name));
    for (const [name, entries] of Object.entries(segment.commentaries)) {
      if (names === null || names === undefined || wanted(name)) {
        found.push(...entries.map((e) => [name, e]));
      }
    }
    return sorted(found, (pair) => -(pair[1].weight ?? 0));
  }

  /** Comments that state a position and then attack it -- the one kind of
   * structural turn that earns an unprompted interruption. */
  machlokes_on(n) {
    return this.sources_for(n).filter(([name, e]) => truthy(or(e.structure ?? null, {}).is_machlokes));
  }
}
