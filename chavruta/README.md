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

## Using it

**Turn to a page** with the three menus at the top — מסכת, דף, עמוד — or the ‹ ›
arrows, the ← → keys, or a swipe. Berakhot for now, 2a to 64a.

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
- **Interrupt** it by talking; it stops.

What it will never do: correct *how you read the words*. It hears you through
speech recognition and cannot know your pronunciation or havara, so it does not
pretend to. It may tell you where a sentence *stops* — that is printed — and argue
with what you *say it means*.

**On screen**, as a companion to glance at: the words it quotes light up on the page;
the sources it cites appear as buttons under its answer — tap one to read it.
**מפרשים** shows everything Sefaria has on the current line, grouped the way the page
is: on the page, Rishonim, Acharonim, then halacha, Tanakh, parallels. **תמליל** is the
transcript, and has a box for typing when you cannot speak.

**Two ways to see the page**: *צורת הדף* — the gemara in the middle, Rashi toward the
binding, Tosafot outside, unvocalized like the printed page — or *שטיינזלץ*, vocalized
and punctuated with the translation under each line.

**Settings** (⚙): how deep it reaches on its own (the page / + Rishonim / + Acharonim),
which language it answers in, how long it waits before answering (choose *long* if it
cuts in while you think), whether it speaks up unasked, its voice.

## What it costs

A cheap model decides what kind of thing you said; a mid-tier one answers, once per
turn, against the whole amud held in a prompt the provider caches — so a long session
pays full price for the page about once. Hearing and speaking cost a fraction of a
cent a turn. The page itself — text, Rashi, Tosafot, Rishonim, Steinsaltz — comes
free from Sefaria, and is cached after the first time.

To open every page of Berakhot now, so each opens instantly and works offline:

    ./run.sh prefetch

## How it is built

    run.sh                    one command: set up, check, open
    web/                      the page, the voice loop, the panels
    chavruta/server.py        the local app
    chavruta/sefaria.py       fetching an amud and building its pack
    chavruta/align.py         following the reading: where on the page is the learner
    chavruta/partner.py       what the partner is told, and what it is given
    chavruta/retrieve.py      which sources come into a turn, and when
    chavruta/commentators.py  who answers what, and who is strong where — editorial, correct it
    chavruta/ground.py        nothing is said without a source behind it
    chavruta/sugya.py         the argument a commentary states about itself
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

Tests: `./run.sh test` (unit), `python3 tests/e2e.py` (browser, needs Playwright).

## If something is wrong

`./run.sh doctor` checks each piece for real and says what to do. The server writes
problems to `chavruta.log`; the last few show up in `doctor`.

Using it from a phone: the app runs on your Mac. `./run.sh --lan` lets a phone on the
same wifi open it, but phones only allow the microphone over https, so for now use it
on the Mac with earbuds, or mirror the Mac screen.

Sefaria's Davidson/Steinsaltz texts are CC BY-NC: free to use, not to sell.
