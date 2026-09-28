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
- **Interrupt** it by talking; it stops, and hears you. **⏸** (or space) pauses it
  without talking over it; **🔊** says the last answer again.
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

To build every page of a tractate now (or use "להכין מראש" in settings), so each
opens instantly and works offline, with the whole-tractate index behind "didn't we
learn this elsewhere":

    ./run.sh prefetch Shabbat

## How it is built

    run.sh                    one command: set up, check, open
    web/                      the page, the voice loop, the panels
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

Tests: `./run.sh test` (unit), `python3 tests/e2e.py` (browser, needs Playwright).

## If something is wrong

`./run.sh doctor` checks each piece for real and says what to do. The server writes
problems to `chavruta.log`; the last few show up in `doctor`.

Using it from a phone: the app runs on your Mac. `./run.sh --lan` lets a phone on the
same wifi open it, but phones only allow the microphone over https, so for now use it
on the Mac with earbuds, or mirror the Mac screen.

Sefaria's Davidson/Steinsaltz texts are CC BY-NC: free to use, not to sell.
