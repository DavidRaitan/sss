import { fake, control } from "./harness.mjs";
import { ROOT_DIR } from "./harness.mjs";
import { describe, test, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getJSON, config } from "../../web/lib/net.js";
import * as store from "../../web/lib/store.js";
import { str, truthy, sorted } from "../../web/lib/py.js";
import * as sefaria from "../../web/lib/sefaria.js";
import { Index as Ix, build_index } from "../../web/lib/masechta_index.js";

const PACK = await sefaria.build("Berakhot 2a");


describe("Sefaria", () => {
  test("test_amud_has_its_real_lines", () => {
    assert.equal(PACK.segments.length, 14);
    assert.deepEqual([PACK.next, PACK.prev], ["Berakhot 2b", null]);
  });

  test("test_every_line_has_commentary_attached", () => {
    // The first version trimmed the anchor and attached nothing to anything.
    assert.ok(PACK.segments.every((s) => truthy(s.commentaries)));
  });

  test("test_backbone_and_rishonim_are_named_properly", () => {
    for (const name of ["Rashi", "Tosafot", "Steinsaltz", "Rif", "Rashba", "Meiri"]) {
      assert.ok(PACK.commentators.includes(name), name);
    }
  });

  test("test_diburim_in_both_styles", () => {
    const first = (n) => PACK.segments.flatMap((s) => s.commentaries[n] ?? [])[0];
    assert.equal(first("Tosafot").dibur, "מאימתי קורין וכו'");          // dash style
    assert.equal(first("Rashba").dibur, "מעשה ובאו בניו מבית המשתה");    // bold style
  });

  test("test_no_bulky_cross_reference_text_in_the_pack", () => {
    assert.ok(!str(PACK).slice(0, 100).includes("xref_text"));
    assert.ok(PACK.segments.flatMap((s) => s.xrefs).includes("Deuteronomy 6:7"));
  });

  test("test_a_bare_version_title_is_refused_like_the_real_api", async () => {
    // The Python test called the stand-in's texts() directly; here, the same request over HTTP.
    const d = await getJSON(config.sefaria + "/v3/texts/Berakhot%202a?" +
      new URLSearchParams({ version: "William Davidson Edition - Vocalized Aramaic" }));
    assert.equal(truthy(d.versions), false);
  });

  test("test_berakhot_runs_2a_to_64a", () => {
    const a = sefaria.amudim("Berakhot");
    assert.deepEqual([a.length, a[0], a[a.length - 1]], [125, "Berakhot 2a", "Berakhot 64a"]);
  });
});


describe("Sections", () => {
  test("test_berakhot_2a_divides_as_the_page_does", () => {
    const got = PACK.sections.map((s) => [s.label, s.from, s.to]);
    assert.deepEqual(got, [["משנה", 1, 5], ["גמרא", 6, 11], ["אמר מר", 12, 14]]);
  });

  test("test_commentary_from_another_tractate_is_not_on_this_page", () => {
    const names = new Set(PACK.segments.flatMap((s) => Object.values(s.commentaries).flatMap((es) => es.map((e) => e.ref))));
    assert.ok(![...names].some((r) => r.includes("Pesachim") || r.includes("Zevachim")));
  });
});


describe("Index", () => {
  let index;
  before(async () => {
    // As setUpClass ran pack/build_index.py: every amud built once (and kept,
    // as the app keeps packs), then the index read back from the store.
    const load = async (ref) => {
      let data = await store.kv.get("packs", ref);
      if (data === null) {
        data = await sefaria.build(ref);
        await store.kv.set("packs", ref, data);
      }
      return data;
    };
    await build_index("Berakhot", load);
    index = await Ix.load("Berakhot");
  });

  test("test_whole_masechta_indexed", () => {
    assert.equal(Object.keys(index.pages).length, 125);
  });

  test("test_a_phrase_is_found_on_its_page", () => {
    const hits = index.phrase("תנא היכא קאי דקתני מאימתי");
    assert.ok(hits.some((h) => h.ref.startsWith("Berakhot 2a")));
  });
});


describe("Parity", () => {
  // The same pages built by the Python reference, against the same stand-in.
  const REFS = ["Berakhot 2a", "Berakhot 2b"];
  const SCRIPT = [
    "import json, sys",
    "from chavruta import sefaria",
    "print(json.dumps({r: sefaria.build(r) for r in sys.argv[1:]}, ensure_ascii=False))",
  ].join("\n");

  // built_at is the clock; and Python's commentators list is a set sorted by
  // weight alone, so names of equal weight come in hash order, which differs
  // from one Python run to the next. Compare the clock's format, and that order
  // up to ties: same names, same weights in the same descending sequence.
  const settle = (pack) => {
    assert.match(pack.built_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const weights = pack.commentators.map((c) => pack.weights[c]);
    assert.deepEqual(weights, sorted(weights, null, true));
    return { ...pack, built_at: null, commentators: sorted(pack.commentators, (c) => [-pack.weights[c], c]) };
  };

  test("a pack built by JS equals the pack built by Python", async () => {
    const { stdout } = await promisify(execFile)("python3", ["-c", SCRIPT, ...REFS], {
      cwd: ROOT_DIR, maxBuffer: 1 << 28,
      env: { ...process.env, CHAVRUTA_SEFARIA_API: fake.sefaria, PYTHONPATH: ROOT_DIR },
    });
    const python = JSON.parse(stdout);
    for (const ref of REFS) {
      const js = JSON.parse(JSON.stringify(await sefaria.build(ref)));
      assert.deepStrictEqual(settle(js), settle(python[ref]), ref);
    }
  });
});
