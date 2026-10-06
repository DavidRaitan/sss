# חברותא (chavruta): notes for Claude

A voice study partner for Talmud. The learner reads the daf aloud, and the app follows the
reading line by line. When asked, it answers aloud, grounded in sources (Sefaria) that it
cites. The user (David) is not a developer. Explain in plain words, and don't hand him
commands he does not need.

Read `README.md` for what the app does, and `docs/decisions.md` for why it is the way it
is (numbered entries, 1–77+). This file covers how to work on it.

## Two branches, two versions: keep them apart

| Branch | What it is | Runs |
|---|---|---|
| `claude/understand-idea-l0bw9a` | The original: a Python server (`chavruta/*.py`) + `web/` | On the Mac: `./run.sh python`; the phone over wifi: `./run.sh --phone` |
| `claude/cloudflare-experiment` | The Cloudflare version: the Python ported to the browser (`web/lib/*.js`) + a small Worker | https://chavruta.workpages.workers.dev |

- The user said the original "works great on the computer" and **must not be affected by
  experiments**. Cloudflare and phone work goes on `claude/cloudflare-experiment` only.
- Merge to main only if he asks.
- The Python code stays the reference for the port (`docs/porting.md`).

## Deploying (the Cloudflare branch)

- **Pushing deploys.** Cloudflare Workers Builds is connected to GitHub. Every push to
  `claude/cloudflare-experiment` builds and deploys the Worker `chavruta`.
  - Root: `chavruta/worker`. Command: `npx wrangler deploy`.
  - Don't tell the user to run `./run.sh deploy` after each change. He asked not to be
    given the update command every time.
- **Check a deploy without the dashboard:** look up the check run named
  `Workers Builds: chavruta` on the commit.
  ```
  gh api repos/DavidRaitan/sss/commits/<sha>/check-runs \
    --jq '.check_runs[] | "\(.name): \(.status) \(.conclusion)"'
  ```
- **The user learns of updates in the app.** It shows "עודכן ✓" the first time a new
  version opens, and "יש גרסה חדשה · לרענן" if one lands while it is open. Settings shows
  the version's date. Keep the note that short; he asked for just "updated".
- **Account details:**
  - Cloudflare account subdomain: `workpages`.
  - D1 database `chavruta`: id `1cf82c3d-ae01-4d6e-8591-380a9d894122`, region EEUR, schema
    in `worker/schema.sql`.
  - Secret: `OPENAI_API_KEY`. There is no passcode any more; the user asked to remove it.
  - The Worker refuses requests not from its own page (`Sec-Fetch-Site`/`Origin`). `OPEN=1`
    lifts that for tests and local runs.
- **Free plan:** the Worker only passes requests through (~10 ms CPU). Everything that
  thinks runs in the page. Keep it that way.

## Architecture (Cloudflare branch)

```
web/                static page (Workers static assets, run_worker_first: /x/*)
  index.html, app.js, app.css   UI: one classic script, app.js (~3.5k lines)
  boot.js           picks the Python server (if /api/health answers JSON) or the in-page API;
                    reports errors on screen + to D1 (kind "error")
  lib/              the Python modules ported 1:1 (ES modules, Python names kept)
    api.js          the old server.py routes (/api/*) answered in the page: window.API.handle
    net.js          config + route(): other sites go through /x/fetch; web_rewrite for tests
    store.js        kv (IndexedDB) and log (D1 via /x/events)
    py.js           Python semantics helpers: re() (Hebrew-aware \b \w), truthy, sorted, …
  vendor/daf-renderer/   MIT, patched (try/catch around cross-origin cssRules)
worker/src/index.js /x/openai/v1/* (key added), /x/voice (TTS GET, edge-cached),
                    /x/sefaria/* (cached a day), /x/fetch?url= (cached an hour),
                    /x/events (D1), /x/who, /x/version (version_metadata binding VERSION)
```

### The five page views

They live in `S.settings.view`. `openView()` builds the phone sheet; the header buttons
are `#v-*`.

- **וילנא** (`vilna`): the real scanned Romm Vilna page (1880–86, NLI's copy), as Sefaria
  hosts it.
  - Source: `https://manuscripts.sefaria.org/vilna-romm/<Masechet_with_underscores>_<daf><a|b>.jpg`,
    1530×2450. Sefaria's manuscripts API lists it under slug `romm-vilna-pressing-(1880-86-ce)`.
  - It is painted once onto a canvas in the app's `--ink`/`--paper` colours (`paintScan`),
    so dark mode is warm cream on brown, not black and white.
  - Loading order: direct with CORS, then through the Worker, then a plain `<img>` under a
    CSS filter, then the text layout.
- **וילנא חי** (`live`): the same page rebuilt from Sefaria's text with daf-renderer. Lines
  light up, reading is followed, and a tap opens a comment. It is also the fallback when the
  scan fails.
- **צורת הדף** (`daf`): three columns. **שטיינזלץ** / **מנוקד** (`lin` with `explain` set to
  `stz` or `off`).
- **Zoom (both Vilna views):** while fingers, a double-tap or a trackpad pinch move, only a
  CSS transform changes. The page is laid out once at the end (`zoomBegin`/`zoomMove`/`zoomEnd`).
  - Resizing on every move was "very choppy"; don't go back to it.
  - In RTL, adjust scroll by differences, never by absolute `scrollLeft`.

### Image sources that don't work

- **HebrewBooks** (`shas.aspx?mesechta=N&daf=23b`; Vilna numbering 1–37, Shekalim 5,
  Kinnim/Tamid/Middot under 36, Niddah 37) refuses servers (403) and framing. It is only a
  link.
- daf-yomi.com, the Internet Archive and Wikimedia Commons have scans but were never
  reachable to check.

### The phone

Phone mode is `PHONE` matchMedia: width ≤ 760, or a short landscape touch screen.

- No desk (שולחן); that is "a computer thing". Panels are bottom sheets with detents.
- A player strip (pause/skip) shows while it speaks.
- The conversation area above the toolbar is resized by its top edge (`#foot-grip`), freely
  to the pixel.
  - Below ~120 px only the answer's words show.
  - It snaps only near the bottom or on a strong flick (`FLICK` 0.8 px/ms), which hides it.
    A flick up restores it.
  - The user called three-step snapping "too sensitive"; don't bring it back.

### Voice and conversation

These are already built; see decisions 26, 41, 44, 58 and 63.

- Default speed 1.15. Voices: `mix` (Cedar explains, Verse answers short).
- Speaking over an answer stops it. The new words are judged: an aside resumes the old answer
  ("as I was saying"); "no, I mean" merges; a new question holds the old one.
- Questions asked while one is still being thought about are answered together, once.
- On the speaker setting it doesn't listen while it talks (it would hear itself); with
  headphones you can talk over it.

## Tests: run them before every push

```
cd chavruta
node --test "tests/js/*.test.mjs"   # ~194 unit tests; harness starts the Python fakes
python3 tests/e2e.py [--shots DIR]  # browser: real Worker via wrangler dev + fake Sefaria/OpenAI
```

- **e2e** drives Chromium at `/opt/pw-browsers/chromium` (`executable_path`). Never run
  `playwright install`.
- It includes an iPhone-size `phone()` flow. Touch gestures there go through CDP
  `Input.dispatchTouchEvent`.
  - Each CDP call takes ~30 ms. A "flick" in a test must be one big move, or its speed falls
    below the threshold.
  - In `touchend`, read positions tracked in `touchmove`, not `changedTouches`.
- **Fakes:** `tests/fake_sefaria.py` and `tests/fake_openai.py`.
  - Sefaria responses are real, recorded ones (`tests/recorded/`).
  - `/ms/vilna-romm/*` serves `vilna_sample.jpg`, a low-resolution stand-in for Berakhot only.
    Don't judge scan quality from test screenshots.
  - The fakes send no CORS headers, so the scan reaches tests through the Worker.
- **Python tests on main:** `./run.sh test`.
- **Never `pkill -f "wrangler dev"`.** The pattern matches your own shell and kills it. Kill
  by PID from `ps` with an awk filter that excludes itself.

## The sandbox Claude works in

- **Outbound web is blocked.** sefaria.org, hebrewbooks.org, daf-yomi.com, archive.org,
  wikimedia, Google Fonts and the live `*.workers.dev` site cannot be reached, by curl or by
  WebFetch.
  - The Sefaria MCP tools do work: `get_available_manuscripts`, `get_manuscript_image`,
    texts.
  - WebSearch works.
- **You can't see the live app.** Check that the deploy check passed, then reproduce
  locally with the e2e stack. Errors on the user's phone show at the top as "משהו השתבש — …"
  and are stored in D1 as kind `error`.
- **The Cloudflare MCP connector needs the user to authorize it** in claude.ai settings
  before D1 or logs can be read from here.

## Conventions

- **Comments:** plain prose explaining *why*, in the voice of the existing code. User-facing
  strings are Hebrew; the UI is RTL.
- **Every user-visible behaviour change gets a numbered bold entry** at the end of
  `docs/decisions.md`: what was wrong or asked, what it does now, and what was tried and
  rejected.
- **e2e checks read as sentences** (`check("phone: …", cond, detail)`). Add one for each new
  behaviour.
- **`web/lib`** follows `docs/porting.md`: faithful translation, Python names, and `re()`
  for every regex.
- **What the user cares about:**
  - The phone first, natively mobile.
  - Beauty and simplicity (the apple-design and mobile-native skills fit).
  - Hebrew names for things: "Vilna", not "Mitsulam".
  - Don't break what works. Show screenshots of visual changes.
