# חברותא — AI Chavruta

A study partner for Talmud. Open a page, put in earbuds, and read aloud. It follows
you along the page and stays quiet while you read. When you say what you think a
line means, it answers out loud — and if your reading does not hold, it says so and
shows you why from the page.

## Start

    cd ~/sss && git pull && cd chavruta
    ./run.sh doctor     # checks your key, Sefaria and the models — fix anything marked ✗
    ./run.sh            # opens the app

The first run sets itself up and creates `.env`. Put your OpenAI key in it
(`open -e .env`), then run again.

## On Cloudflare (free) — the phone, anywhere, Mac off

One address for the phone and the Mac, on Cloudflare's free plan:

    cd ~/sss && git pull && cd chavruta
    ./run.sh deploy

The first time it opens a browser to log in to Cloudflare, takes your OpenAI key
from `.env`, and prints the address — today **https://chavruta.workpages.workers.dev**.
There is no passcode: the link is enough. Anyone you give the link to uses your OpenAI
key, so set a monthly limit at platform.openai.com → Settings → Limits. On the phone: open it in Safari, then
Share → **Add to Home Screen** — it opens full screen, like an app. On Android
(Samsung, Nothing, any Chrome) and on the computer, ⚙ has an **install** button (or
the browser menu → Add to Home screen / Install app). Installed, it opens even with no
signal, on the pages you have already learned. It needs iOS 16.4 or later on an iPhone,
or a current Chrome / Samsung Internet; an older browser says so.

**Updates publish themselves.** Cloudflare is connected to GitHub (Workers Builds):
every push to the `claude/cloudflare-experiment` branch is built and live a minute or
two later — nothing to run. The app says so: "עודכן ✓" the first time a new version
opens, and "יש גרסה חדשה · לרענן" if one arrives while it is open; ⚙ shows the
version's date at the bottom. If something breaks on the phone, it is written at the
top of the screen ("משהו השתבש — …") — a screenshot of that is the quickest fix.

This is a separate branch on purpose: `claude/understand-idea-l0bw9a` keeps the
original Python version that runs on the Mac, untouched by the Cloudflare work.

How it is built: the page is static; everything that thinks (the partner, the
router, following your reading) runs in the browser (`web/lib/`). A small Worker
(`worker/`) does only what the page cannot: holds the OpenAI key, reaches Sefaria
and the study sites, makes each sentence's voice (and keeps it, so the same words
are never paid for twice), and keeps the record of every sitting and your notes in
a D1 database (so phone and Mac share your history). `./run.sh` runs the same thing
on the Mac; `./run.sh python` runs the original Python server.

## Using it

**Turn to a page** with the three menus at the top — מסכת, דף, עמוד — or the ‹ ›
arrows, the ← → keys, or a swipe. All of Shas as Sefaria has it (37 tractates;
not Shekalim, Kinnim or Middot). **📅** opens today's Daf Yomi, and each tractate
opens where you left it. By voice: "go to Shabbat 30", "today's daf".

**What you are learning** (⚙): open on today's daf or where you stopped; pick your
tractates (they come first in the menu); and "להכין מראש" builds every page of one
in the background, so each opens instantly. Today's daf and tomorrow's are built
every morning while the app is open.

**Press the microphone** (or the space bar) once. It stays open; this is a
conversation, not a chat.

- **Read aloud** from your gemara. The line you are on lights up and the words it
  followed fade a little, so a glance shows where it thinks you are. It says nothing
  while you read — except once, when you reach a place where the commentators split:
  *"רגע — כאן תוספות מתווכח עם רש״י. רוצה להיכנס?"*
- **Say what you think it means** — in English, Hebrew, or both in one sentence. When
  you stop talking, it answers aloud. If you are wrong it tells you, and why.
- **Ask**: "what does the Rashba say here?", "does he really hold that, I learned the
  opposite elsewhere", "what's the halacha", "read it inside or summarise".
- **Move by voice**: "go to daf 5 amud b" / "תעבור לדף ה עמוד ב".
- **Interrupt** it by talking; it stops at once and hears you. A quick side question
  ("wait, what's chatzot?") gets a sentence, then "as I was saying" and it goes on;
  "no, I mean…" folds into the question; a new question is answered and the old
  answer waits ("go back" / "תמשיך במה שאמרת" brings it back). Several things said
  while it is still thinking are answered together, once. **⏸** (or space) pauses it
  without talking over it; **🔊** says the last answer again. It always listens, as
  Claude's and ChatGPT's voice modes do — with earbuds or from the phone's speaker
  (it tells which by itself, and from the speaker waits for a clearly louder voice,
  so its own does not cut it off).
- **Keep reading while it thinks.** It follows your reading at once, answers when you
  pause, and if you've read on it says which question it's answering.

What it will never do: correct *how you say the words* — pronunciation, havara,
Hebrew for Aramaic. It hears you through speech recognition and cannot know those,
so it does not pretend to. What it does notice: a *different word* (you read מעשר
where the page has תרומה), a skipped word that matters, words that are not on the
page. Then it asks, once — "מעשר? I have בתרומתן here" — and says what it would
change. (Settings can turn this off.) It may tell you where a sentence *stops* —
that is printed — and argue with what you *say it means*.

**It goes and gets things.** Ask about the halacha and it says "let me pull up the
Tur and the Shulchan Aruch", fetches them from Sefaria (with the Rema inside the
Shulchan Aruch, and the Mishnah Berurah on that seif), and answers from what it
read. Name a Rishon who isn't printed on the page — Rabbeinu Yonah — and it follows
the links to him. "Can you hear me?" gets "Yes, I hear you." — short questions get
short answers.

**Coming back to it.** Ask "what were the last six pages about?", "what did we do
yesterday?" or "remind me of the mishna" (even when it is pages back) — each page
you learn gets a short recap, kept, and it tells you the story from there. "Did we
learn «הקטר חלבים» yesterday?" or "I think I saw this somewhere" gets a yes or no
with where and when: it looks through the pages you learned, nearest first, and
where the page itself points (Mesoret HaShas). "Test me" asks questions one at a
time; at the end of an amud it offers. Opening the app after a day away, it says
where you stopped, with ↺ review and ❓ questions one tap away.

**Along the way.** Read on past the last line and the page turns to the next amud
with you. Close the app and it opens again at the line you were on. Say "note:
…" (or "תרשום: …") to pin a thought to the line, "save this" to keep the last answer,
"what did I note on this page / in this tractate?" to hear them — 📝 marks the lines.
"How much have I learned?" — days in a row, pages per tractate, and whether you
learned today's daf; the same in ⚙ under "ההתקדמות שלי", and ✓ on 📅 once done.

**Trusted sites** (⚙): for what Sefaria does not have — Halacha Yomit for Rav
Ovadia's rulings, Hebrew Wikisource for the Sha'ar HaTziyun, Birkei Yosef, the
Mordechai. Named ("what does Rav Ovadia say?") or asked ("check online"), it
reads the page itself, quotes a line, and links to it. Add your own sites.

**Units of learning** are marked where the page opens them — משנה, גמרא, תניא,
אמר מר — and tapping one lights the whole unit, so "let's finish this piece"
means something. When three or more opinions are in play, the answer comes as a
table on the screen, read aloud row by row. It speaks up unasked only when you
finish a unit that holds a real machlokes.

**"Didn't we learn this ten pages back?"** is answerable once the whole
masechta is indexed (`./run.sh prefetch`, below): it points at the pages that
share this unit's uncommon wording, as a lead — it says it has not read them.

**On screen**, as a companion to glance at: the words it quotes light up on the page;
the sources it cites are buttons inside its sentences — tap one to read it, even the
Tur or the Rambam, which open right there.
**מפרשים** shows everything Sefaria has on the current line, grouped the way the page
is: on the page, Rishonim, Acharonim, then halacha, Tanakh, parallels. **תמליל** is the
transcript, and has a box for typing when you cannot speak.

**Five ways to see the page** (תצוגה):
- *וילנא* — the printed page itself: the Vilna Shas scan (Romm, 1880–86, from the
  National Library's copy, as Sefaria keeps it), painted in the app's paper and ink —
  warm in dark mode too. Double-tap to zoom in where you tap, and again for the whole
  page; pinch with two fingers (or the trackpad) for any size.
- *וילנא חי* — the same page rebuilt from its text, gemara in the middle, Rashi and
  Tosafot around it, in the app's letters: the line you are on lights up, your reading
  is followed, and tapping a comment opens it. Shown also when the scan cannot be had.
- *צורת הדף* — three columns, gemara with Rashi and Tosafot beside it.
- *שטיינזלץ* — vocalized and punctuated with the explanation woven in; *מנוקד* — the
  pointed gemara alone.

**On the phone** it is built for one hand: the page fills the screen, the toolbar sits
at the bottom (מפרשים · תמליל · the mic · תצוגה · הגדרות), and panels rise as sheets
you can drag. While it speaks, a small strip gives ⏸ and ⏭. The conversation above the
toolbar has a handle on its top edge: drag it to any height — low, it keeps only the
answer's words, scrolling with the voice — and let go near the bottom (or flick it
down) to hide it entirely and just talk; flick up to bring it back. The desk (שולחן,
commentators side by side) is on the computer only.

**Settings** (⚙): how deep it reaches on its own (the page / + Rishonim / + Acharonim),
which language it answers in, how long it waits before answering (choose *long* if it
cuts in while you think), whether it speaks up unasked, its voice.

## What it costs

A cheap model decides what kind of thing you said; a mid-tier one answers, once per
turn, against the whole amud held in a prompt the provider caches — so a long session
pays full price for the page about once. Hearing and speaking cost a fraction of a
cent a turn. The page itself — text, Rashi, Tosafot, Rishonim, Steinsaltz — comes
free from Sefaria, and is cached after the first time.

To build every page of a tractate now (or use "להכין מראש" in settings), so each
opens instantly and works offline, with the whole-tractate index behind "didn't we
learn this elsewhere":

    ./run.sh prefetch Shabbat

## How it is built

    run.sh                    one command: set up, check, open, deploy
    web/                      the page, the voice loop, the panels
    web/lib/                  the Python modules below, ported to the browser (Cloudflare version)
    worker/                   the Cloudflare Worker: OpenAI key, Sefaria and site proxy, voice cache, D1 record
    chavruta/server.py        the local app
    chavruta/sefaria.py       fetching an amud and building its pack
    chavruta/align.py         following the reading: where on the page is the learner
    chavruta/partner.py       what the partner is told, and what it is given
    chavruta/retrieve.py      which sources come into a turn, and when
    chavruta/library.py       going past the page: fetching the codes and linked works live
    chavruta/commentators.py  who answers what, and who is strong where — editorial, correct it
    chavruta/ground.py        nothing is said without a source behind it
    chavruta/sugya.py         the argument a commentary states; the units of a page
    chavruta/masechta_index.py  the whole tractate, for "didn't we see this already"
    chavruta/llm.py           thinking, hearing, speaking
    tests/                    unit tests and a browser test with a fake microphone,
                              against real recorded Sefaria responses

Three rules are enforced in code rather than asked for in a prompt:

1. **No invented sources.** Every name must come with a citation from the pack, in
   English or Hebrew; a reference the pack never held is rejected. The answer is sent
   back, and if it fails twice the reply is "I don't have that here — let's look."
2. **The gemara is never spoken.** Quoted text is lit on the page instead.
3. **Silence while you read.** Reading is recognised by lining up what it heard with
   the page, and followed without a word.

Tests: `./run.sh test` (Python unit), `node --test "tests/js/*.test.mjs"` (the browser
port), `python3 tests/e2e.py` (browser, needs Playwright and Node: it runs the real
Worker with `wrangler dev` against stand-ins for Sefaria and OpenAI, including an
iPhone-sized pass with touch gestures).

## If something is wrong

`./run.sh doctor` checks each piece for real and says what to do. The server writes
problems to `chavruta.log`; the last few show up in `doctor`.

**Using it from a phone** (same wifi as the Mac): `./run.sh --phone`. The Mac makes
its own certificate once and prints a private link — send it to yourself and open it
on the phone. The first time the phone warns the certificate isn't trusted (it's your
Mac's own): continue (Safari: *Show Details → visit this website*). Without the key
in that link, nobody else on the wifi can use the app or your OpenAI key.

Sefaria's Davidson/Steinsaltz texts are CC BY-NC: free to use, not to sell.
