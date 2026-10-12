# Handoff: from the cloud session to a local one

Written on 2026-10-12 at the end of a long cloud session, for a new Claude session running on
David's Mac. Read this, then `chavruta/CLAUDE.md`. Use `README.md` and `docs/decisions.md`
(entries 1–80) as reference. The cloud session could not reach the live site, Sefaria, or the
user's own folders. The local session can, and that is why the work moves there.

## Who you're working with

- **David is not a developer.** Explain in plain words, briefly, what changed and what he will
  notice. Don't hand him terminal commands unless there is no other way. He asked not to be
  given the deploy command after each change, since pushing deploys by itself.
- **He talks by voice typing, so names come out misheard.** "Kotzer" is "Kutzer";
  "Tsugata Daf" is "צורת הדף"; "Mitsulam" is "מצולם", and he wants it called "Vilna". Read for
  intent, and ask when it is genuinely unclear.
- **What he cares about:**
  - The phone first, as natively mobile as possible.
  - Beauty and simplicity: the apple-design and mobile-native skills fit his taste.
  - Hebrew UI and Hebrew names.
  - Nothing that works should break.
- **Show him.** Send screenshots of visual changes. He says plainly when something feels
  wrong ("too sensitive", "choppy", "ugly"), so fix what he names, test it, and tell him it is
  live.

## Where things are on the Mac

The paths below may have moved: he planned to move `~/VS Code/*` to `~/Projects/*`, with
symlinks left at the old paths. Check both.

| What | Path |
|---|---|
| Repo, main branch (the original Python app, untouched) | `~/sss`, branch `claude/understand-idea-l0bw9a` |
| Repo worktree, the Cloudflare version (where the work goes) | `~/sss-cloudflare`, branch `claude/cloudflare-experiment` |
| OpenAI key for local runs | `~/sss/chavruta/.env` (`./run.sh` copies it if missing) |
| Zichru / Kutzer project | `~/VS Code/zichru_ai` or `~/Projects/zichru_ai`; GitHub `DavidRaitan/Kutzer` |

Start with `cd ~/sss-cloudflare && git pull`. This file arrived with that pull.

## The app: חברותא (chavruta)

- **Live:** https://chavruta.workpages.workers.dev, on a free Cloudflare Worker.
- **Deploy:** every push to `claude/cloudflare-experiment` builds and deploys through Workers
  Builds. Check a push with the GitHub check run "Workers Builds: chavruta".
- **Latest commit at handoff:** `90d520d` ("Always listening…"). It was live and passing all
  tests: 194 unit tests and the full e2e suite.
- **Main is untouched:** `claude/understand-idea-l0bw9a` is the original Mac/Python version.
  Don't merge into it unless he asks.

### What was done in the cloud session (newest first)

- **80** Always listening, like Claude's and ChatGPT's voice modes.
  - There is no earbuds/speaker setting any more. Earbuds are detected from device names.
  - The old "speaker mode" stopped listening while the app talked, and switched itself on for
    good after two echoes. It is gone.
- **79** The microphone is requested once and kept, instead of on every tap; an iPhone could
  re-prompt each time. Settings shows where to allow it for good on iPhone and Mac Safari.
- **78** Ready for iPhone, Samsung, Nothing Phone, iPad and PC:
  - a network-first service worker (`web/sw.js`), and an install section in Settings;
  - a screen wake lock while the mic is open, and the mic revived when the app returns;
  - Android back closes sheets; touch targets about 40px;
  - an "update your browser" screen below iOS 16.4.
- **77** The conversation strip above the toolbar can be dragged to any height on phone and
  computer. It snaps only near the bottom or on a hard flick.
- **76** Two Vilna views, smooth zoom, and the update notice "עודכן ✓".
  - **וילנא:** the real Romm scan from Sefaria, painted in the app's colours.
  - **וילנא חי:** the page rebuilt from text.
  - Zoom: pinch and double-tap use a GPU transform.
- **75** The real scanned Vilna page, from `manuscripts.sefaria.org/vilna-romm/<Masechet>_<daf>.jpg`.
- Earlier:
  - the JS port of the Python server, so it runs in the browser on Cloudflare's free plan;
  - D1 for the shared learning record;
  - no passcode;
  - the icon;
  - a mobile-first layout;
  - default voice speed 1.15, with a mix of Cedar and Verse voices.

### Waiting on David's real-device feedback

None of this could be tested on real hardware from the cloud, which only had Chromium emulating
devices.

- **Interrupting:** does talking over it work from the phone's speaker, and with AirPods? Does
  it ever cut itself off on the speaker?
- **The conversation handle:** does the free drag and flick feel right now?
- **Installing:** add to the home screen on iPhone, Samsung and Nothing; check that it opens
  full screen and works offline on pages already learned.
- **The mic prompt on iPhone:** after he sets Settings → Apps → Safari → Microphone → Allow,
  does it stop asking?
- **The Vilna scan on the live site:** does it load, and is it sharp when zoomed?
  - The cloud could not check whether `manuscripts.sefaria.org` sends CORS headers. Without
    them, the scan goes through the Worker's `/x/fetch` instead.
  - Locally you can just look: open the live site, and check DevTools' Network tab for which
    request served the scan.

### Now possible locally (blocked in the cloud)

- **The live site:**
  - Open it in real Safari and real Chrome.
  - Test WebKit with Playwright: `npx playwright install webkit` works on the Mac.
  - Run the e2e suite against Safari's engine.
- **Sharper page images:**
  - daf-yomi.com (`DafYomi_Page.aspx?vt=2&id=…`) shows Vilna scans. He mentioned it, and the
    cloud could never reach it.
  - HebrewBooks PDFs: `shas.aspx?mesechta=N&daf=23b&format=pdf`; numbering is in
    `web/lib/api.js` `HEBREWBOOKS`. It refuses servers and framing, but a local browser can
    read it.
  - Wikimedia Commons ("Category:Vilna Edition Shas"; the HebrewBooks PDFs uploaded per
    volume, rendered at any width through `upload.wikimedia.org/.../pageN-2000px-….pdf.jpg`).
  - The Internet Archive (`Talmud_Bavli_Vilna_images`).
  - The current Sefaria scan is 1530×2450, readable when zoomed but not crisp at 3× zoom.
- **The Cloudflare dashboard, logs and D1:** errors from his phone are stored in D1 as kind
  `"error"`. Reach them with `npx wrangler d1 execute chavruta --remote --command "select …"`.

### Offered but not yet decided

- **App Store / Play Store:** a native wrapper such as Capacitor. Needs an Apple developer
  account ($99 a year) and a Google one ($25 once). Today it ships as a home-screen web app.
- **An OpenAI monthly spending limit:** anyone with the link uses his key; the limit is set at
  platform.openai.com → Limits.
- **Separate user accounts:** today everyone with the link shares one record.

## The other project: Zichru / Kutzer

Separate from chavruta. Context from his earlier chats, in his words where quoted:

- **What it is:** "Zichru: Talmud Mastery". One page, `public/index.html`, with Google sign-in
  and Firestore, on Firebase project `tracking-app-0001`. A way to keep track of Talmud
  learning: pages learned, quizzes, and tractates that can be shared.
- **Sept 28:** it was pushed to github.com/DavidRaitan/Kutzer in 2 commits.
  - `c80f031`: the original code.
  - `b41533c`: security and bug fixes.
    - Shared tractates could run code in other users' browsers.
    - Firestore rules; public emails exposed.
    - Leftovers after sign-out.
    - Tractate names with spaces.
    - Quiz bugs; un-marking pages.
    - Sync overwriting newer progress.
    - Export/Reset buttons; updated AI models.
- **The fixes are NOT deployed.** To deploy: `cd ~/"VS Code/zichru_ai" && npm run deploy` (or
  the `~/Projects` path), then sign in and click "Publish tractates" once. Do this first:
  the sharing bug is a security hole.
- **Oct 6** (in a chat about his Holech app): "Don't build this. Just for you to know in the
  future, I want you to build this. Not now, maybe in four days. It's called Zichru Kotzer
  Plan. Just remind me that eventually we have to build that."
  - It was never said what "this" is. A Daf Yomi reminder idea he sent just before it is a
    separate thing.
  - **The reminder is due.** Ask him what the plan should cover before building anything.
- **Overlap with chavruta,** to raise with him. Chavruta already keeps the learning record in
  D1, Daf Yomi progress and streaks, recaps, "test me" and review. The options:
  1. Zichru stays separate and gets its own improvements.
  2. The two share one learning record, so what he learns with the chavruta shows up in Zichru.
  3. Zichru's tracking is folded into the chavruta.

## Working rules that held up

- Run both test suites before every push (see CLAUDE.md for the commands and their traps).
  Add an e2e check, written as a sentence, for each new behaviour.
- Add a numbered entry at the end of `docs/decisions.md` for each user-visible change.
- Commit messages end with the session's Co-Authored-By line.
