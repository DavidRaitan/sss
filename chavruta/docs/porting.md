# Porting the Python server to the browser

The app moves to Cloudflare's free plan: a small Worker (worker/) holds the
OpenAI key, reaches Sefaria and the study sites, stores the record in D1 and
checks a passcode. Everything the Python server *decided* -- the partner, the
router, the pack builder, alignment, grounding -- runs in the browser as
JavaScript under `web/lib/`. The Python code stays the reference until the port
passes every test it passed.

## The rule: a faithful translation

Port module by module, function by function, keeping behaviour **identical**.
Do not improve, simplify, rename or "clean up" logic, prompts, regexes, word
lists or thresholds. Prompts and every user-facing string are copied
character for character. Comments are carried over (they explain *why*).

- One Python module `chavruta/x.py` becomes `web/lib/x.js`, an ES module.
- **Names stay Python's names**, snake_case included (`amud_context`,
  `asked_here`, `PACK_VERSION`), so every module can rely on every other
  module's names without asking. Classes keep their names and methods.
- **Parameters**: parameters without a default stay positional. **Every
  parameter that has a default in Python goes into one trailing options
  object**, with the same names, even where Python callers pass it
  positionally: `def get(path, soft=False, **params)` →
  `get(path, { soft = false, ...params } = {})`; `sittings(400)` →
  `sittings({ days: 400 })`.
- `@property` → getter. `@classmethod` → `static`.
- Tuples become arrays. Python dicts keyed by strings become plain objects;
  dicts keyed by numbers or tuples, or where order of numeric keys matters,
  become `Map` (JS objects reorder integer-like keys). Sets become `Set`.
  A tuple used as a set member or dict key becomes a string key (`ref + "|" + n`).
- **Async**: a function that does network or storage I/O, directly or through
  anything it calls, becomes `async`. **When calling into another module,
  always `await`** unless the function is plainly a pure computation
  (awaiting a plain value is harmless; forgetting to await a promise is a bug).
- Threads, pools, locks → promises. `ThreadPoolExecutor` + deadline →
  `Promise.all` with `within(promise, seconds, fallback)` from py.js. Locks that
  guard a cache → a Map of in-flight promises.
- Exceptions keep their class names (`SefariaError`, `ModelError`), as
  `class SefariaError extends Error {}`.

## The helpers (web/lib/py.js) -- use them, do not hand-translate

- **Regular expressions: always `re(String.raw\`...\`, flags)`**, never a JS
  literal. Python's `\b`, `\w`, `\W` know Hebrew letters and JavaScript's do
  not; `re()` translates (also `(?P<name>`, `(?P=name)`, `(?i)`, lone braces,
  needless escapes like `\"`). Flags: `"i"` for re.I, `"s"` for re.S, `"m"`,
  `"x"` (VERBOSE). Copy the Python pattern text exactly into `String.raw`. (If a
  Python pattern is a non-raw string with `א` escapes or `%`-formatting,
  build the same string first, then `re()` it.)
- Python's `re` functions: `search`, `match`, `fullmatch`, `findall`,
  `finditer`, `sub` (Python templates `\1`, `\g<name>`, or a function of a
  Match), `subn`, `split`, `escape`. A Match has `.group(n|name)`, `.groups()`,
  `.groupdict()`, `.start()`, `.end()`, `.span()`, `.lastindex`. Compiled
  pattern methods (`P.search(s)`, `P.sub(r, s)`) become `search(P, s)`,
  `sub(P, r, s)`.
- Strings: `pysplit(s, sep, maxsplit)` (Python's `str.split`, whitespace by
  default, no empties), `rsplit`, `strip/lstrip/rstrip(s, chars)`,
  `partition`, `title`, `capitalize`, `fmt("%s ... %d", ...)` for `%`
  formatting, `str()` / `repr()` as Python prints values.
- Values: **`truthy(x)` wherever Python tests a value's truth and it may be a
  list, dict, set or string** (`if items:` → `if (truthy(items))`; in JS `[]`
  and `{}` are true). `or(a, b)` for `a or b` on such values. `range`, `zip`,
  `sum`, `any`, `all`, `sorted(xs, key, reverse)` (stable, compares arrays as
  tuples), `cmp`, `max/min(xs, key)`, `pyround`, `counter`, `dumps`
  (json.dumps with Python's spacing -- use it wherever the JSON text reaches a
  prompt or a test), `deepcopy`, `now()` (time.time()), `within()`.
- `//` → `Math.floor(a / b)`; `%` on negatives → `((a % b) + b) % b`;
  `int(x)` → `Math.trunc(Number(x))` or `parseInt`; slicing → `.slice()`;
  `x in "string"` → `.includes`; `list.index` → `indexOf` (Python raises if
  absent -- check callers); `dict.get(k, d)` → `obj[k] ?? d` (careful: Python
  returns a stored `None`/`0`/`""`, so use `k in obj ? obj[k] : d` when that
  matters).

## The outside world (web/lib/net.js, web/lib/store.js)

- `config` holds what were environment variables: `config.sefaria` (Python
  `sefaria.API`), `config.openai`, `config.wikisource`, `config.zmanim`,
  `config.wiki`, `config.place`, `config.placeName`, `config.tz`,
  `config.web_rewrite` (Python `web.REWRITE`), `config.models`
  (`heavy, cheap, stt, tts, voice`), `config.effort`, `config.provider`.
  Read them at call time, not at import time (tests set them after import).
- HTTP: `getJSON(url, {timeout})`, `getText(url, {timeout})`,
  `request(url, {method, headers, body, timeout, signal})` → a fetch Response.
  They route other sites through the Worker and apply `web_rewrite`; never
  call `fetch` directly. `HttpError` has `.status`. `urlencode`, `quote`.
- Files the Python wrote become `store.kv` (async `get(ns, key)`,
  `set(ns, key, value)`, `del`, `keys(ns)`): packs (`ns "packs"`, key = ref),
  recaps (`"recaps"`), daf-yomi days (`"days"`), site pages (`"pages"`),
  learned outlines (`"outlines"`), tractate index (`"index"`). Always import as
  `import * as store from "./store.js"` and use `store.kv` / `store.log`
  (they are swapped in tests).
- The session record (`sessions/<date>.jsonl`) and notes (`notes.jsonl`) become
  `store.log`: `add(kind, fields)` (adds `at`, "YYYY-MM-DD HH:MM:SS" local) and
  `list({kinds, since, fields})` → rows oldest first (`fields`: only those keys of each row -- use it when only `ref`/`at`/`kind` are needed, e.g. sittings). Notes are rows of kind `"note"`.
  `store.stamp()` / `store.today()` give local timestamps as Python's strftime did.
- No DOM at import time: modules must load in Node for the tests. Use
  DOMParser only inside functions, and only if the Python used an HTML parser
  (prefer the same regexes the Python used).

## Tests

`tests/test_units.py` is ported to `tests/js/<module>.test.mjs` with
`node:test` and `node:assert/strict`, each test with the same name (as a
string) and the same assertions. Every test file starts with
`import { fake, control } from "./harness.mjs";` -- it starts the same Python
stand-ins (`tests/fake_sefaria.py`, `tests/fake_openai.py`) and points
`config` at them, exactly as test_units.py set its environment. Run:

    node --test "tests/js/*.test.mjs"

A ported test that fails is a porting bug to fix in the port, not a test to
change -- unless the Python test itself read a file path or other
Python-only detail, in which case test the same behaviour through the JS
equivalent (store.kv, store.log).
