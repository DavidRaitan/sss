# Decisions — deltas from spec v0.1

What the design conversation settled, and what it opened. Spec v0.1 stands
except where contradicted here.

## Settled

**1. The screen shows the text. (v0.1 Q5 — resolved: not book-only.)**
Phone, earbuds, physical gemara open, *and* the daf on screen.

This is the largest simplification in the document. In v0.1 the fuzzy
alignment of degraded ASR against the known daf text was load-bearing: it was
the only way to know where the learner was on the page. With the text on
screen, position is available from a tap or a scroll. Alignment becomes a
convenience that keeps the highlight moving while the learner reads, and its
failure mode drops from "the system is lost" to "the highlight lags."

Build the cheap version first. Do not spend week one on alignment.

**2. Layout: linear Steinsaltz-style segments for v1, not tzurat hadaf.**
The traditional page — text block with Rashi inside and Tosafot outside,
prose reflowing around them — is a genuine typesetting project, and at phone
width the column measure that makes it readable does not exist. Sefaria
serves segment-numbered text, and every commentary links at segment level, so
segments are already the natural unit.

Offering the shape as a user preference is right eventually. It is not a v1
feature, and picking it for v1 would spend the whole budget on typography.

**3. Speech is code-switched, not multilingual.**
The learner says one sentence containing English, Hebrew, and Aramaic —
"so what he's saying here is that the *kohanim* can't eat *terumah* until
*tzeis*." This is not "supports several languages." Most ASR assumes one
language per utterance and degrades badly on mid-sentence switches.

This is now the biggest unproven technical risk in the project, ahead of
everything in v0.1 §8. It is testable in an afternoon with recorded speech and
should be tested before anything is built on top of it. Yiddish and Spanish
are later; they do not change the shape of the problem.

**4. New requirement: correcting where the learner stopped.**
Not in v0.1. In gemara, where you break the sentence *is* the reading — the
same words stopped in two places are two different arguments. So the chavruta
must be able to say "you stopped a word early; carry it into the next phrase
and it reads differently," and "read two more lines, this clause isn't
finished yet."

This is buildable, and cheaply, because the Davidson vocalized text is
punctuated, and its punctuation is Steinsaltz's reading of where each clause
stops. We are not asking a model to judge pisuk — we are comparing where the
learner stopped against a printed answer. `build_pack.py` extracts these as
`clauses` per segment.

Verified against Berakhot 2a:1, which splits correctly into its four units.

**5. Two tiers of commentary, and they have different accuracy bars.**
What is *on the page* — Rashi, Tosafot, and where printed, Rabbeinu Chananel —
must be exact, quoted, and attributed. These are what the learner is looking
at; an error here is visible immediately and is the fatal event of v0.1 §3.1.

What is *off the page* — Rif, Rashba, Ritva, Ramban — is escalation, reached
when the learner asks "does he really hold that, I remember the opposite
elsewhere." Retrieved the same way, but the learner is not checking us against
an open page.

Sefaria's coverage of Rabbeinu Chananel varies by masechta. Verify per
masechta before promising him. He is not on Berakhot 2a.

**6. Depth is the learner's choice, asked explicitly.**
"Do you want to read it inside, or should I summarise?" Every source in a pack
therefore needs both: the quoted text for reading inside, and a summary. The
summary is generated; the text is retrieved. They are stored separately and
the summary never stands in for the text in a citation.

## What the data gives us for free

Steinsaltz bolds the words that are literally on the daf and leaves his own
connective explanation unbolded — in both the Hebrew and the English. That
markup is a word-level alignment between raw Aramaic and its expansion,
already done, for all of shas. It is the most useful structure on Sefaria for
this product and `build_pack.py` preserves rather than flattens it.

Rashi and Tosafot open with their *dibur hamatchil* before a dash. That gives
every comment an exact anchor to the words it hangs off, so "what does Rashi
say about the line I just read" is a lookup, not a retrieval guess.

## Still open

- **Masechta for v1.** The pack builder is masechta-agnostic; the commentator
  routing table in `build_pack.py` is not, and that table is the moat.
- **Code-switched ASR.** See 3. Test first.
- **Licensing.** Unchanged from v0.1 §8 and still unverified: the Davidson /
  Steinsaltz material appears to be CC-BY-NC. Public-domain Rashi and Tosafot
  are fine. This blocks charging money, not building.
- **Who writes the code** (v0.1 Q1) and **learning level** (v0.1 Q2). The
  worked example in the design conversation — Rabbeinu Chananel, the Rif, "read
  it inside" — is a fluent learner's session, so v1 is being built for someone
  who reads Aramaic and does not lean on the English. Confirm before this
  hardens.

---

# Decisions from using it (September 2026)

**7. It never corrects how the learner reads the words.** It hears through
speech recognition, cannot hear pronunciation or havara, and a transcript that
disagrees with the page is the transcript's error every time. It may correct
where a sentence *stops* — printed, so knowable — and argue with what the
learner *says a line means*. If it suspects a word was passed over it asks,
and believes the answer. Enforced in the partner's constitution.

**8. A conversation, not a chat.** One press opens the microphone; silence
ends a turn; it answers aloud and listens again; talking over it stops it. The
transcript exists, behind a button. Typing exists, inside the transcript, for a
quiet room.

**9. Reading is followed silently.** What it hears is lined up against the
amud (word-level local alignment, `align.py`). If it is the page being read,
the line lights and nothing is said. The one exception is the hinge of a
machlokes, flagged once per line, from structure extracted out of the
commentary's own words — templated, never generated.

**10. The page looks like a page.** Default view is the printed daf:
unvocalized, gemara in the middle, Rashi toward the binding (it flips between
amud aleph and bet), Tosafot outside, Rashi script. The Steinsaltz view —
vocalized, punctuated, translation under each line — is one tap away.

**11. Turning pages is a date picker, not a search box.** מסכת / דף / עמוד,
with Hebrew numerals, plus arrows, keys, swipe, and voice ("go to daf 5 b").
One masechta until the routing judgement has been checked on another.

**12. The gemara is never spoken; the partner's own Hebrew is** (revised by 20). Quotes are
wrapped in «» by the partner, lit on the page, and silenced in speech. The
first voice stripped *all* Hebrew, which silenced every Hebrew answer.

**13. Depth and language are two separate settings.** Depth is how far past
the printed page it reaches unasked (the page / + Rishonim / + Acharonim);
naming a commentator always brings him regardless. Language is what it
answers in (like me / Hebrew / English).

**14. The whole amud is in view on every turn,** in a system prompt that holds
still for the session and is cached. "Two lines down it says the opposite" can
only be said about lines the partner can see.

**15. The data pipeline is tested against recorded live responses.** The first
version was written from memory and got two things wrong that together meant no
real page ever loaded (a version name without its language; anchors trimmed so
no commentary attached to any line). `tests/recorded/` holds real Sefaria
responses and `tests/fake_sefaria.py` replays them, as strictly as the real API.

**16. Merged from the parallel session on the same branch.** That session, run
where Sefaria was reachable, found the same fatal bugs independently, and added
three things kept here: units of learning read off the page's own markers
(sugya.sections), a whole-masechta index for "didn't we see this already"
(masechta_index.py — phrase search now matches across punctuation), and tables
when three or more positions are in play. Its finding that answers came back
in Hebrew to English questions made English the default answer language. Its
floating microphone was not kept: it sat over the gemara and hid words, and it
had no caption to glance at; the voice bar keeps both.

## After the first real sitting (Berakhot 2a)

The first recorded conversation was read back line by line. What it showed,
and what changed:

**17. A different word is asked about; an accent never is.** The learner read
«מעשר» for «בתרומתן» and «השנייה» for «הראשונה», asked "did I read it
correctly?", and was told "Yes." Decision 5 had been over-applied: the partner
was told the transcript is always wrong, and reading turns never reached it at
all. Now the alignment names where speech and print part ways — a swapped
word, a skipped word that carries meaning, words not on the page — and ignores
what speech recognition can't hear anyway (קוראים/קורין, בערבית/בערבין). A
swap is asked about once, as a question, with what it would change ("מעשר?
then they'd eat it in daylight"). Readings are remembered, so "did I read it
right" is answered from what was heard. There is a setting to turn it off.

**18. It goes and gets the source instead of saying it doesn't have it.**
"Was this codified in the Tur?" got "I don't have a source… let's look it
up", and it never looked. The page already says where to go: the ein mishpat
names the Rambam, Tur and Shulchan Arukh (the Rema is inside its text); the
Shulchan Arukh's links lead to the Mishnah Berurah on that seif; the Rif's lead
to Rabbeinu Yonah. `library.py` fetches these in parallel, cached, with a
deadline. While it fetches, the partner says so aloud ("let me pull up the
Tur"), streamed ahead of the answer. Everything fetched is citable because it
was read, and only then.

**19. The size of the answer follows the question.** "Can you hear me?" got a
sentence about the first watch. Small exchanges (mic checks, "go ahead",
thanks) are recognised by the router, which also writes the few words back —
no heavy model and no sources. Every other kind carries a length.

**20. Short quotes are spoken (supersedes 12).** Silencing «quotes» left the
learner hearing "it begins … and ends …", and a table was skipped entirely.
Quotes are spoken and also lit on the page; tables are read row by row; only a
run of nine or more of the page's own words is cut, keeping its first words so
the sentence still points somewhere. A citation that the sentence leaned on
("the text at [[Tur…]] and [[Shulchan Arukh…]]") is said as the book's name, and
on screen citations sit in the sentence as buttons rather than leaving holes.

**21. Warmer, and confident.** The partner hedged ("it's blurred", "not
exact") and never played. It may now enjoy the page and the learner — the
apple in the mishna deserves a laugh — as long as every claim has a source
behind it. It may not argue from silence ("the Rif doesn't decide", from one
line of the Rif).

**22. Speaking up waits for the end of a unit.** The Tosafot remark broke in
after the first line of the masechta. It now comes when the reader finishes
the mishna, baraita or piece of gemara that holds the machlokes. A Tosafot's
voices are labelled (Rashi → questions → Rabbeinu Tam → the Ri) in the pack,
on the panel and in the prompt, so they are not run together.

**23. The sources panel.** Ordered by number (2a:2 before 2a:10), argument
shapes only on works that argue (not on remez), the Rishonim that Sefaria hangs
on other lines of the amud one tap away, and every reference — halacha,
Tanakh, Talmud — opens its text in place.

## After the second sitting

**24. Small talk never touches a model.** "Hey, what's up?" took hearing, a
routing model, the partner and speech synthesis — six or seven seconds for
"hey". `smalltalk.py` recognises mic checks, greetings, "go ahead", thanks and
"what time is it" from the words alone (only when nothing else was said), and
their audio is made once at startup and kept.

**25. Nothing hangs.** A request that hung waited a minute and retried twice,
so the learner watched "listening" for over a minute before an error, which
never reached the export. Every model call now has a short timeout and one
retry, failures are written to the sitting's record and shown in the
transcript, and speech is streamed so playback starts while it is being made.

**26. Hearing, answering and speaking run side by side.** One queue for all
three meant reading waited behind the previous answer's voice, and questions
asked mid-reading were answered one by one after the learner had moved on.
Now reading is followed the moment it is heard; questions asked while an
answer is being made are answered together, once; an answer waits for the end
of the learner's sentence rather than talking into it, and says what it is
answering if they have read on. Talking over it stops it and is heard; ⏸ (or
space) pauses it without having to talk over it; 🔊 says it again. Speaking
over the learner mid-reading was considered and not done: with a mic open,
their own reading would cut it off at once, so waiting for the pause is what
actually gets heard.

**27. Mic off is a clean stop.** Clicking the mic on and off left requests,
queued answers and a second microphone behind. Off now cancels everything in
flight and drops whatever arrives late.

**28. Panels sit beside the page.** Sources, transcript and settings no
longer cover the gemara; on a phone they are a sheet from below. Typing in the
transcript keeps it open and the turn appears there.

**29. What speech recognition mangles is not corrected.** «הם מוכרים עד חצות»
got "Not 'sold'", and a dropped «אתם» got "You skipped «אתם»". A short line is
now recognised from fewer words, a skipped word alone never prompts a remark,
and the partner asks rather than announces.

## After the third sitting

**30. One voice, always.** The voice kept changing: whenever the OpenAI voice
hiccuped or was interrupted while loading, the page quietly fell back to the
browser's voices (two of them, one per language); the server could fall back
to a different OpenAI voice; and the voice direction asked for an Israeli
accent in Hebrew and plain English, which made each switch of language sound
like a new speaker. Now there is no fallback voice at all — if it cannot be
said in its own voice, the words stay on screen — and the direction asks for
one person throughout. Kept clips are keyed by voice and direction.

**31. It knows its own voice.** Without earbuds the mic heard the answer: it
cut itself off, transcribed its own answer as the learner's turn and argued
with it, and the chopped audio produced a flood of "corrupted audio" errors.
Scraps too short to be speech are never sent; unreadable audio is treated as
silence, not an error; anything heard while it was talking that matches what
it just said is recognised as itself and ignored; and after hearing itself
twice it switches to speaker mode — it doesn't listen while it talks, and ⏸ is
how to stop it. Settings has אוזניות / רמקול.

## After the fourth sitting

**32. Answers were cutting themselves off.** Most answers "spoke" for 15–40 ms
until 🔊 was pressed. The microphone's measure of how long the learner had
been speaking was never cleared when they stopped, so after a long question it
was still "loud" when the answer began, counted as the learner talking over it,
and stopped the answer. It is now cleared at the end of every utterance and
when the partner starts speaking, and capped.

**33. Why it loved the Meiri.** Depth "+ Acharonim" opened up to six
commentaries a turn; the Meiri comments on nearly every line of this amud, so
he was in every one of them; halacha questions opened four Meiri paragraphs;
and the partner was told to use what was opened. Now: at most three unasked
voices, one comment each; halacha takes one ruling per Rishon; whoever was
cited in the last two answers sits the next turn out; and the partner is told
the page's own voices come first and the bench is for what they don't say.

**34. "Answer it" is not small talk.** "So go ahead and answer" got "Go
ahead."; "What?" got "Yes, I hear you." Requests are never small talk now,
"what?" / "I didn't hear you" says the last answer again, and the router is
told that asking it to answer means answering.

**35. The check stopped throwing out good answers.** A name reported through a
cited source ("the Tur [[…]] brings Rashi's view") is covered by that citation.
Only an invented reference forces the fallback; a name mentioned without its
citation ships marked "unsourced" on screen.

**36. Real numbers.** Asked for clock times, it fetches the night's zmanim for
Jerusalem from hebcal.com — tonight, and a summer and winter night when asked —
and works the answer through them. Set CHAVRUTA_GEONAMEID / CHAVRUTA_PLACE for
another city.

**37. Panels: ✕ always in reach, and resizable.** The close button sits
outside the scrolling panel; the panel's edge is a handle to drag it wider or
narrower (taller or shorter on a phone), remembered.

**38. Who they were.** "When did he live? Who came first?" got "I don't have
that here." Sefaria keeps this: a commentary's index names its author, when
and where it was written, and often whose student he was ("Rashba was a
student of Ramban"); an author's or sage's topic has birth and death years,
places, the generation of a tanna or amora, a short biography, and teachers and
students. A "people" question fetches that — for the names asked about, or for
"him", whoever the last answers cited — and Wikipedia's summary only when
Sefaria has no description. (Britannica has no free API; Sefaria's records are
the more specific source for these people anyway.)

**39. "Answer it" keeps the thread.** When all they say is "answer it", "go
on" or "you didn't answer", the partner is handed the question they asked
before and told to answer it in full, not restate it.

**40. Short turns.** "What does this mean?" came back as meaning, Rashi,
Tosafot and halacha. Each kind of question now carries a word count (about
25–45 words for meaning), and the partner is told to say the one thing asked
and offer the next layer in a few words rather than deliver it.

## Speed, and a queue

**41. Answers are spoken as they are written.** From the end of a question:
the pause that ends it (~1 s), speech to text (~2 s), routing (~1–2 s), then
the answer — 5 to 16 seconds — and only then the first word. Now the answer
streams: each sentence is checked on its own and spoken while the next is
written (the one after is voiced ahead, so there is no gap between them). A
sentence is held until the next begins, because a citation often follows the
full stop; if one fails its own check the speaking stops there, and once the
whole answer passes the rest is said, or the whole answer if it had to be
written again.

**42. Quick thinking for quick questions.** "What does this mean?", "who was
he", small talk and reading checks use the model's minimal reasoning; halacha,
machlokes and questions about Rashi and Tosafot keep the deeper setting.

**43. Speed of speech.** A setting (slow to very fast), applied to the audio as
it plays, and by voice: "a bit faster", "slower", "תדבר יותר מהר".

**44. A queue you can see.** The bar showed the next question while the
answer to the previous one was still being said. Now each thing asked is a
turn: the bar shows the turn being answered — its question and its answer,
growing as it is spoken — and the others wait below it as a queue (⏳ still
thinking, ✓ ready), with ⏭ to skip the current answer and ⏩ to go straight to
the latest question. "Enough" / "skip" / "די" by voice does the same as ⏭.

**45. What the sixth sitting showed.** A good sitting, with its own mistakes:
- *Times are fetched, never remembered.* "How long till sunset?" got "I need
  your location", and "say in Tel Aviv" got a sunset the model made up. Now
  sunset, dawn, nightfall and "how long till" fetch the times; a named city
  (a list of common ones, in English and Hebrew) is looked up at Hebcal by its
  coordinates and remembered for the sitting, and the time now comes with it.
- *The right Rabban Gamliel.* The name search took the first match, the Elder,
  a generation before the Mishnah's Rabban Gamliel of Yavneh. When Sefaria
  names no exact match, everyone of that name goes in, and the partner decides
  from the page which is meant.
- *What was fetched stays on the table* for the next few turns. The answer
  after "who came first?" was rejected for citing the biographies fetched one
  turn earlier, and came back saying they were "not in the sources".
- *"Let's continue" is about the reading,* not "answer it": it had the last,
  already-answered question answered again. "Go on" asks for an answer only
  when the last answer was a stub; "let's continue" gets "Go ahead."
- *"Um" and "okay" get nothing back* ("Yes, I hear you." to "Okay." was the
  worst of it) -- unless the partner had just asked something, when "okay" is
  a yes and goes to the partner.
- *The gate reads the paragraph.* "Tosafot challenges Rashi: ... [[Tosafot]]"
  was sent back three times for naming Rashi. A name is covered when its
  paragraph cites a source that itself quotes him, and "no Tosafot here" names
  no one. While streaming, such a sentence waits for the end of its paragraph.
- *"Did we skip a Rashi or Tosafot?"* is answered from a list of the Rashi and
  Tosafot on the lines so far, marked by whether they have come up. It had
  named one already discussed and missed the Tosafot on the first line.
- *"Can you read it for me?"* reads it, in full.
- *Never "Yes" before a correction* ("ותו" is not "that's all").
- *A follow-up said while the first question is still being thought about* is
  asked together with it, once. Two answers came, the second repeating the first.

**46. The shelf, sorted by what each work does** (from `sources-map.md`).
The routing now follows genre, not fame: a question on Tosafot goes to its
explainers (the Maharsha, Tosafot HaRosh) and question-raisers (Gilyon HaShas,
Penei Yehoshua, R' Akiva Eiger); a contradiction with another sugya to R'
Akiva Eiger first; "why" to the Catalonian novellae (Rashba, Ritva, Ra'ah); a
new question kind, aggadah, to the Maharsha's Chidushei Agadot, the Ben
Yehoyada and the Chida's Petach Einayim. The Meiri is an overview, light for
psak, and comes last among the halachic voices. On Berakhot a halacha
question brings Talmidei Rabbeinu Yonah on the Rif unasked. The Maharsha was
never found: Sefaria files him on Berakhot as "Chidushei Halachot" and
"Chidushei Agadot". The partner is told what each kind of work is for, that
Maran and the Rema are both reported, and that the gemara's give-and-take is
not yet the halacha.

**47. Who sits at the table is the learner's.** Settings has "מי ליד השולחן":
every Rishon, Acharon and poseik the app can reach, grouped. Tap once for ★
(always, when he has something in this unit), again for ⊘ (only when asked by
name), again for neither. ★ codes come with every halacha question (a ★ Magen
Avraham is followed from the seif beside the Mishnah Berurah); ⊘ ones are not
fetched. "How many voices" caps what a turn opens unasked (1, 2, 3, broad; a
halacha chain gets two more). The partner is told the table too. Rashi and
Tosafot are the page and always there.

**48. The shelf, mapped against what actually exists** (`docs/research/`).
Three research passes (halacha, gemara, people and infrastructure), each fact
marked verified or not. What came of them:
- Halacha past the Mishnah Berurah, all public domain on Sefaria: from the
  seif, Magen Avraham, Taz, Machatzit HaShekel, Pri Megadim, Be'er Heitev,
  Sha'arei Teshuvah, Eliyah Rabbah, the Gra, Kaf HaChayim; from the Tur,
  Beit Yosef, Bach, Darkhei Moshe, Prisha; from the Rambam, Kesef Mishneh,
  the Raavad, Lechem Mishneh, Mishneh LaMelech; the Aruch HaShulchan, which
  Sefaria does not link, by siman number. Reached when named or seated (★).
- Sefaria's own names: the Maharshal is "Chokhmat Shlomo", the Tzlach
  "Tziyyun LeNefesh Chayyah", the Ramban "Chiddushei Ramban", and so on.
  "Shita Mekubetzet on Berakhot" is, by Sefaria's own description, the Ritva.
- Namesakes: Sefaria ties passages to people (Berakhot 2a:4-5 -> Rabban
  Gamliel of Yavneh); the lookup uses that. Empty stub topics are skipped;
  dates are trusted over prose.
- Link only (copyrighted): Yalkut Yosef, Piskei Teshuvot, Yabia Omer, Or
  LeTzion, Encyclopedia Talmudit and the rest of the modern shelf. Text
  elsewhere but untested from here: Hebrew Wikisource (Sha'ar HaTziyun,
  Birkei Yosef, the Mordechai on Berakhot, Chazon Ish).

**49. All of Shas, Daf Yomi, and the tractates you learn.** Every tractate
Sefaria has (37; its shape API gives each first and last amud, Tamid from
25b, Nazir without 33b). A page is still built the first time it is opened
(two Sefaria requests, then kept on disk) with its neighbours built behind it;
"prepare" builds a whole tractate in the background, gently, then its index.
📅 is today's daf from Sefaria's calendar (asked in Israel time); today's and
tomorrow's are built each morning while the app runs. Settings: open on
today's daf or where you stopped; "my tractates" first in the menu, each
remembering its place. By voice: "go to Shabbat 30", "the daf yomi". The
routing judgement was tuned on Berakhot; elsewhere it is a first draft.

**50. Trusted sites, and coming back to it.**
- Trusted sites (settings; Halacha Yomit and Hebrew Wikisource to start):
  Wikisource through its own API; any other site through a web search limited
  to it, after which the page itself is read and its text -- not the search
  engine's retelling -- goes to the partner, cited with its address and quoted
  briefly. Named ("what does Rav Ovadia say", "the Sha'ar HaTziyun"), asked for
  ("check online"), or with every halacha question if set. Rav Ovadia may be
  named only through such a page (the gate enforces it).
- Review: "what were the last six pages about", "what did we do yesterday".
  Each amud gets a short recap, made once from its text and kept; which pages
  comes from where they are, or from the sittings the app records. Coming
  back after a day, the page says where you stopped and offers ↺ a review or
  ❓ questions. At the end of an amud it offers a few questions; a quiz is one
  question at a time, each answer judged from the text.

**51. "Did we learn this?", "where did I see it?", and the mishna pages back.**
Every page left after a sitting gets its recap in the background, so what was
learned can be answered from all of it. A new question kind, recall, brings:
what was learned by day; the lines holding the words asked about, in the
pages learned and those on disk, nearest first; recaps of the pages learned;
and where the page itself points for this passage elsewhere in the Bavli
(Mesoret HaShas), nearest first, the top two opened. It answers yes or no
first, then where and when. "Remind me of the mishna" walks back page by page
to the mishna the gemara is on, brings its text, and recaps the pages since.

**52. The library, settings by voice, one pace, and a summary of every daf.**
- "The library" (הספרייה), never Sefaria or Hebcal, on screen and in what the
  partner says: it is a study partner with a shelf, not a wrapper for a site.
  Sites the learner chose to trust are named, because the words are theirs.
- Every setting by voice: the router proposes changes, only real settings and
  real values get through, the page applies them as if tapped and says so in a
  few words (in the new language, if that was the change). Turning the voice
  off is asked first. "Talk a little bit faster" is caught at once: in use the
  extra words sent it to the model, which could not change the speed.
- What is asked this turn beats the settings: Hebrew when set to English, a
  commentator left out, the full text, what the abbreviations stand for.
- One pace: each sentence is voiced separately and the voice's own pace
  varies (Hebrew often slower); each clip's pace is measured in syllables a
  second, counted alike in both languages, and played at the usual pace times
  the chosen speed, within 0.8–1.3. Changing speed applies to the sentence
  being said. The export shows the paces, to tune from real use.
- The D.A.F. point-by-point outline (dafyomi.co.il, Kollel Iyun Hadaf) of any
  daf in Shas joins a review when that site is trusted (on by default) -- the
  summary for pages learned before this app. Addresses seen for eight
  tractates; for the rest the first daf is found by a site search and the
  pattern kept.

**53. Along the way: the page turns with you, notes, progress, the phone.**
- Read on past the last lines and the next amud is checked (only if already
  built -- turning never waits on the network); if that is where the words
  are, the page turns, and words from the next page are not taken for words
  "not on the page".
- Each page remembers its line; the app and each tractate open where you were.
- Notes by voice ("note: ...", "save this" = the last answer, "what did I
  note?"), kept in notes.jsonl (not committed), 📝 on the line, and shown to
  the partner as the learner's own notes on the page.
- Progress from the recorded sittings: days in a row, pages per tractate, the
  Daf Yomi (today's, and days running); the calendar is kept on disk.
- The phone: `--phone` serves over https on the local network with a
  certificate made once, behind a private link whose key becomes a cookie;
  the Mac itself needs no key. The handshake runs per connection.

**54. "That's the Tzelach's question -- read it together, or the gist?"**
- Every page holds every commentary the library links to it (22 works on
  Berakhot 2a). The partner always sees the whole amud with Rashi and
  Tosafot; the rest are opened a few at a time, by what the question needs.
- On each question about the page, every comment near the line is scanned
  locally -- no call -- for the difficulty it raises (קשה, וא"ת, תימה, לכאורה,
  יש לדקדק, צ"ע...), and the question in the commentator's words goes to the
  partner. The gemara's own "אם כן למה", quoted, and a Tosafot's name
  ("בתד"ה קשיא") are not counted.
- When the learner's question is the same one, it says whose it is, cited,
  and asks: read it together, or the gist? -- then waits. The answer to that
  ("let's read it", "just tell me", "yes") is taken as the answer to the
  offer, not routed as a new question: reading goes phrase by phrase through
  the whole comment, spoken in full; the gist is told and then offered inside.

**55. The desk: commentaries beside the page, arranged to taste, for the sitting.**
- "Let's read it together" opens that comment on a desk beside the page, at
  the comment itself; the words the partner quotes are lit as it reads them.
- ＋ מפרש lists everyone on the amud by kind (a dot for who speaks on this
  line); "לשולחן ⇱" in the sources panel and on an off-page source (the Tur)
  pins it too; by voice: "put the Rashba on the side", "תפתח את המאירי בצד",
  "close the desk". "Open the Rashba" alone stays a question about him.
- Arranged by hand: drag a card by ⋮⋮ (or → ←), wide or narrow, drag a card
  taller, the desk beside / under the page or on its own, ⇄ sides, א−/א+,
  and its edge dragged for more or less room. Each card follows the line.
- None of it is saved -- not the cards, not the layout: a reload clears it.
  Settings are for what holds; the desk is for this sitting.
- Saved layouts, by choice: "＋ שמור" on the desk offers a name (the
  commentators on it) and Enter keeps it -- which commentators, their order,
  width and height, where the desk sits, its size and the letter size. Saved
  layouts are a row of names on the desk: one tap opens one. The one you are
  in shows ☆ (open it by itself with the first page) and ✕; saving under the
  same name updates it. Kept in this browser only.

**56. Feel: the phone, the press, and motion.**
- The phone: one column exactly as wide as the screen (the header row had
  pushed it wider, and a panel waiting off-screen made the phone zoom out to
  half size); the header wraps; the notch and home bar are padded; the body is
  the visible screen (dvh); fields are 16px so iPhone does not zoom into them;
  no tap flash, no text selection on a long press, no double-tap wait; scroll
  stays in the box it started in; the status bar matches, light and dark.
- Hover only where there is a mouse -- on a phone a tapped button stayed lit.
  Every control answers on the press (a small give), and keyboard focus is
  always visible. Small controls grow under a finger.
- Motion that means something: the panel slides in from its side and back
  out the same way (up from below on a phone); the desk and a new card arrive
  instead of appearing; cards glide to their new places when moved, widened
  or removed. A card is carried by ⋮⋮ with the finger or the mouse, stays
  under the finger, and the others make room. One curve, no bounce. With
  "reduce motion" on, only quick fades.

**57. A calmer bar and header.**
- The ‹ › page arrows are gone: א / ב and the daf list turn pages, and the
  arrow keys and a swipe still do. One way to do a thing on screen.
- One set of line icons, drawn in the colour and weight of the text beside
  them, instead of a mix of emoji, pictures and type: microphone, pause,
  play, skip, to the last question, say again, the calendar, settings,
  close, copy, the note mark, and the desk's controls.
- The microphone is one round control whose ring says what is happening:
  your voice while it listens, a turning arc while it thinks, a slow breath
  while it speaks. Pause sits on its edge.
- מפרשים · שולחן · תמליל are three tabs side by side at the top of the
  conversation; what is open is filled, and a second tap closes it.
- The question being answered is set off by a quiet rule, not an emoji; the
  queue shows what waits (a clock, or a check when its answer is ready) and
  two worded buttons: "דלג" and "לשאלה האחרונה" (icons alone on a phone).
- The conversation area's top edge is a handle: drag it up for more of the
  conversation, down for more page; a double-click puts it back. Kept.

**58. Cutting in: answered now, judged against what it cut into.**
- In use a clarifying question waited behind the whole of a long answer. Now
  speaking over an answer stops it at once and holds its place; the router,
  in the same quick call that sorts every question, is shown what was being
  answered and how far it got, and says what the new words are to it:
  - aside ("wait, what's chatzot?"): answered in a sentence or two, then "so,
    as I was saying --" and on from the sentence it stopped in (said again
    whole, not from mid-word). When unsure, this: most interruptions are
    about what is being said.
  - merge ("no, I mean in the Rambam", "and the Rama?"): the rest of the old
    answer is dropped and the question as it now stands is answered, told
    what was heard and what was not, so it carries on instead of repeating.
  - new: answered now; the unfinished answer waits in the queue, and it asks
    "want me to go back to what I was saying?" -- yes brings it back.
  - later ("let's come back to that"): kept in the queue as "לאחר כך" (tap to
    ask it), and the answer goes on.
  "Go back" / "תמשיך במה שאמרת" / "where were we" brings back a held answer
  at any time, and tapping it in the queue does too. An "um", a cough or a
  mic check over it: that sentence again, and on. Reading on over it: it waits.
- The plain cases ("no, I mean", "later") are decided by pattern, not the
  model; the export records each cut-in's verdict.

**59. From the first session on Rosh Hashanah 9a, and the Steinsaltz view.**
- "Rosh Hashanah 9a" was taken for the Rosh: a right answer about the page
  was sent back for "naming the Rosh without a citation" and shipped marked
  unsourced. The gate now skips Rosh Hashanah / Rosh Chodesh / ראש השנה /
  ראש חודש.
- "The last time I studied this" fetched tonight's zmanim ("last time" was a
  clock word, for "the last time to say Shema"). Now only "last time to /
  for ..." is.
- "Good question --" was said before fetching even when nothing was asked.
  Now: "Let me pull up the pages -- one second."
- "A refresher of the last nine pages" asked for twelve recaps, each first
  building its whole page with every commentary, six at a time: most ran past
  the 14-second deadline and the answer said the pages were "not in our
  learned record". Now: the D.A.F. outline of every daf in the stretch (up to
  ten, side by side, one light page each), and a recap made from the text
  alone for the last amud or two -- the one they pick up from. Pages learned
  before the app count; a page that could not be opened is said to be so.
- "I'm still waiting" while it gathers gets "Still on it" at once, and the
  work goes on (it had been taken as a new question).
- The Steinsaltz view showed only the pointed text; Steinsaltz himself was
  nowhere. Now it is woven as he is printed: the daf's words bold and dark,
  his explanation lighter, his bracketed glosses lighter still -- the daf's
  words are the same word-spans as everywhere, so reading along still works,
  and none is ever dropped.
- The edges you drag (the panel, the desk, the conversation area) kept
  following the mouse after the button was let go when the release landed
  elsewhere. They now let go on release wherever it happens -- and on a
  button that is no longer down, a lost capture, or the window losing focus.

**60. Steinsaltz to read simply; plain letters; two commentaries, two names.**
- Woven all at once in three weights, Steinsaltz was too much to look at. Now
  the daf's line is the text -- large, pointed, what you read aloud -- and
  under the line you are on his plain Hebrew opens (smoothly, and closes as
  you move on): one calm paragraph, the daf's own words a shade darker, his
  bracketed glosses a shade lighter. Above: "ביאור שטיינזלץ: בשורה שלי /
  בכל השורות / כבוי".
- Commentaries are in plain letters by default -- Rashi script is hard to read
  for many. Settings → כתב רש״י: none / Rashi and Tosafot on the page / every
  commentary.
- The outer column was titled "תוספות · רבינו חננאל", as if one work. The
  column carries its own name; Rabbeinu Chananel's comments in the same
  margin are each named and set off.

**61. The mic is the mic; the words follow the voice; a choice of voice.**
- A tap on the mic closes it or opens it, and nothing else -- as in any voice
  assistant. What is being said goes on (to stop it: ⏸, Esc, or just talk
  over it). Held down, the mic stops everything. Closed, it is drawn crossed
  out. In use a tap meant to mute (to talk to someone in the room) cut the
  answer off and dropped everything waiting.
- While it speaks, the sentence being said is in full ink, the rest softer,
  and a soft mark moves word by word with the voice (timed from the audio,
  or from the usual pace while it streams); the conversation area scrolls
  itself to keep that word in view, unless you have just scrolled it. The
  transcript stays at its end while you are at its end.
- Settings → איזה קול: the OpenAI voices (Cedar, the default, and Marin are
  the newest and most natural; also Ash, Ballad, Verse, Onyx, Sage, Coral,
  Shimmer). A tap plays a sample. The kept audio is keyed by voice.

**62. Steinsaltz as Sefaria sets him; two voices.**
- Learners know Steinsaltz from Sefaria: a paragraph a line, the daf's words
  bold, his words plain in the same ink. Sefaria marks the daf's words in
  bold, his Aramaic translations in small type inside [brackets], and the
  section heads ("ב גמרא") in big type; the page build now keeps that
  (pack version 6 -- older pages rebuild themselves once) instead of
  stripping it and guessing. Shown: the daf's words bold; his translations
  without the brackets, smaller and in the interface face, a quiet gloss;
  verse references, (דברים ו, ז), in small faint print; משנה / גמרא as a
  small tag. The daf's bold words are the page's word-spans, so reading along
  and quotes still find them; a daf word he splits or skips stays, unseen.
  Above: שטיינזלץ / גמרא מנוקדת.
- Voices: Cedar (default) and Verse -- the two the learner liked.

**63. Taking back what was said.**
- "Never mind", "ignore that", "scratch that", "I wasn't talking to you",
  "עזוב", "לא משנה", "תתעלם", "לא דיברתי אליך": the last thing asked is
  taken back -- not answered (or no longer: it stops), out of the queue, and
  forgotten by the partner, as if it had not been said (the server drops it
  from the conversation it keeps; if its answer was still being written, that
  answer is not kept). An answer it had cut into goes on. Said in a word:
  "OK -- dropped it." The same from a ✕ beside the question in the bar and on
  each question waiting in the queue; struck through in the transcript.

**64. The voice reads the body; the sentence being said is marked.**
- Sources are for the screen. The voice used to say a book's name wherever
  its citation was not right after the name ("On 2a, Berakhot 2a, the gemara
  ...", web page titles). Now every citation is silent, except a short book
  name the sentence leans on as a word ("we need the text at the Tur") --
  otherwise the sentence has a hole. Brackets left holding only sources go.
- Word-by-word marking guessed each word's time from the clip's length; the
  voice gives no word timings, and it does not read exactly what is shown
  (sources, long quotes), so the mark landed on the wrong words. Now the
  sentence being said is marked -- that much is known exactly, since each
  sentence is voiced on its own; an answer that came whole is said sentence
  by sentence too. The conversation scrolls to keep that sentence in view.
- Esc stops the whole answer, not just the sentence it is on.

**65. Two hands in Steinsaltz.**
- Bold alone, in one face, did not tell the Talmud from Steinsaltz. Now, as
  in the printed Koren Steinsaltz: the daf's words in the book face (Frank
  Ruhl), bold; his own words in a clean modern Hebrew sans (Assistant); his
  translations of the Aramaic in that sans, smaller and softer.

**66. Faster from the end of a sentence to the first word.**
- Where the time went (Rosh Hashanah 9a): ~1 s waiting for silence, 1.5-3.7 s
  transcribing, 1-2.5 s sorting the question, 2-6 s writing, ~0.5 s voicing.
  The network itself is a few tenths of a second; Wi-Fi does not change it.
- Heard while spoken: at each breath in the middle of a sentence (a pause of a
  third of a second, after more than a second of speech), the piece so far
  goes to be transcribed while the speaker goes on -- so when they stop, only
  the last piece is left. A piece with no speech in it is never sent (silence
  is where transcription invents words).
- A head start: for a plain question about the page (nothing to fetch, no
  page to turn, no setting), the answer begins on a guess of its kind while
  the router decides, on its own partner and its own copy of the sitting's
  memory, holding every sentence. If the router agrees, those sentences are
  the answer; if not, they are dropped unheard and the real answer starts at
  once -- a wrong guess costs tokens, never time.
- What it is doing, shown while it does it: "מבין את השאלה…", "מביא מקורות…",
  "כותב תשובה…". The export gives each answer a timing line: sorted in, the
  head start used or not, sources, first sentence, first word heard, and from
  the end of their sentence to the first word.

**67. The phone is its own shape, not the desktop squeezed.**
- Most learning may happen on a phone, held in one hand, by voice. So three
  layers, top to bottom: a one-line bar (the page's name -- tap it to turn to
  another -- its two sides, settings); the page, paper to the edges; and the
  conversation over a toolbar with the microphone in the middle, where the
  thumb rests, and four tabs around it: מפרשים, שולחן, תמליל, תצוגה.
- Turning to a page is a sheet: מסכת, דף, עמוד as one grouped list, and
  today's daf as one wide button. The last choice closes it.
- Everything else is a sheet that rises from the toolbar and goes back into
  it, sized for what it holds: the commentaries at half the screen (the line
  they are on still visible above), the transcript and settings tall, the
  view as tall as its three choices. Its edge follows the finger 1:1, gives
  less and less past the top, and on release settles where a flick was
  taking it -- fast enough downward, it goes away.
- One thing at a time: a sheet puts the desk away and the desk lowers a sheet.
  While either is up the conversation steps aside (it is still heard); the
  mic never moves.
- תצוגה gathers how the page looks: צורת הדף or Steinsaltz, the size of the
  letters (for every view and the commentaries), and Rashi script.
- On its side, a phone has room beside the page, so the panel is beside it.
- No keyboard hints where there is no keyboard; the transcript does not open
  the keyboard by itself; it can be added to the home screen and opens
  full-screen with its own icon.

**68. On Cloudflare, free, with the Mac off.**
- Free and always reachable ruled out a container ($5/month) and a tunnel to the
  Mac (only while it is on). What is left is a Worker on the free plan -- and the
  free plan gives a Worker about 10 ms of CPU per request. So the Worker only
  passes things through: the OpenAI key (never in the page), Sefaria and other
  sites (kept at the edge), each sentence's voice (kept at the edge: "Go ahead."
  is paid for once), the record of sittings and notes (D1), and a passcode once
  per device, signed into a cookie. With no passcode set it lets nobody in.
- Everything that thinks moved into the page: the Python modules were ported to
  JavaScript (`web/lib/`) function by function, names and prompts unchanged
  (docs/porting.md). Python's regexes know Hebrew word boundaries and
  JavaScript's do not, so every pattern goes through `re()`, which translates.
  Each module was checked against the Python on the same inputs -- packs built,
  prompts sent, answers, routes, plans -- not only by its ported tests.
- `api.js` answers the page's /api requests as server.py did, with the same
  shapes and the same streaming, so app.js barely changed.
- Tests: 192 JavaScript tests (the Python unit tests ported, parity with the
  Python, and the Worker under wrangler), and the end-to-end test now runs
  against the real Worker on workerd.
- Not carried over: the phone link with its own certificate (the Worker's
  address replaces it) and pre-making the small-talk voices (the edge keeps them
  after their first use).

**69. No passcode; a new mark.**
- The passcode screen stood between the learner and the page, so it went. The
  link is enough. What stays is a check that costs nothing: the Worker answers
  only its own page (the browser's Sec-Fetch-Site / Origin), so no other
  website can use it as a door to the OpenAI key. Someone with the link can
  still use the app; an OpenAI spending limit is the ceiling.
- The icon: ח in a speech bubble, cream on the page's terracotta -- learning
  by talking it through. Drawn as shapes (no font), so it is the same
  everywhere; a maskable copy for Android keeps clear of its circle.

**70. The phone, mobile first.**
- צורת הדף on the phone is the page as printed: Rashi and Tosafot in their
  columns around the gemara (it had shown the gemara alone). Each column
  scrolls to the line you are on; set to the right edge, not justified, since
  a narrow justified column opens holes between words.
- No desk on the phone -- arranging cards side by side is a computer's thing.
  "Let's read it together" opens the comment in the commentaries sheet; the
  toolbar is מפרשים, תמליל, the mic, תצוגה, הגדרות.
- Pause and skip were two small buttons clinging to the mic. While it speaks
  there is now a player strip above the conversation, as in a music app: a
  big ⏸/▶ under the right thumb, ⏭, and the question being answered. It stays
  up for the whole answer (each sentence is voiced separately; it does not
  blink between them). The mic is only the mic.

**71. The page as printed, as a fourth way to see it.**
- תצוגה now offers four: מצולם (the Vilna Shas, scanned), צורת הדף (the
  page's shape in text, with Rashi and Tosafot), שטיינזלץ, and מנוקד.
- The scan is HebrewBooks' PDF of the amud (`shas.aspx?mesechta=N&daf=23b
  &format=pdf`, their tractate numbers 1-40), fetched through the Worker and
  kept at the edge for a month, drawn with pdf.js (shipped with the app, not
  loaded from elsewhere), and recoloured pixel by pixel: black to the app's
  ink, white to its paper -- so it sits in the app instead of on top of it,
  in dark mode too. The neighbouring amudim are fetched while one is read.
  Double-tap to look closer, again to fit; the letter size sets its scale.
- It is a picture: the line you are on and the words you read aloud are
  followed in the other three views, not on the scan.

**72. A brisker voice, and two of them.**
- "Way too slow": the voice's own direction said "unhurried", and the speed
  was 1.0. Now the direction asks for a brisk, lively pace and the default
  speed is 1.15 (settings saved before are moved to it once).
- Two voices, each where it is best: Cedar (warm, calm) says the answers;
  Verse (lively) the quick things -- "Yes, I hear you", "Let me pull up the
  Tur", nudges. The default; settings can keep one voice throughout.

**73. The scan, opened by the learner's own browser.**
- HebrewBooks turns away requests from servers (the Worker got a 403; its
  bot protection), so fetching the PDF through the Worker failed on the
  phone. Getting past that by pretending to be a browser would be going
  around their protection; instead the page is what HebrewBooks expects --
  the learner's own browser opening it -- in a frame inside the app,
  blended into the app's paper (multiply; light-on-dark in dark mode), drawn
  as wide as the letter size says, with "open it there" beneath in case it
  will not show in a frame. pdf.js is no longer needed.
- HebrewBooks' tractate numbers, checked against live links: Vilna order
  1-37, Shekalim 5, Kinnim/Tamid/Middot under Meilah (36), Niddah 37 (they
  were 37-40 before, wrongly).

**74. וילנא: the page laid out as printed, from its own text.**
- The scan from HebrewBooks stayed blank on the phone: HebrewBooks refuses
  servers, and will not be shown inside another site. So the fourth view is
  no longer a picture: it is the page laid out as the Vilna Shas lays it out
  -- the gemara in the middle, Rashi toward the binding, Tosafot outside,
  wrapping around it, sides swapping between amud א and ב -- by daf-renderer
  (MIT, shipped with the app), from Sefaria's text. Called וילנא.
- Being text, it is in the app's ink and paper (dark mode too), the line you
  are on is lit, the words you read are followed, a tap selects a line or
  opens a comment, and two taps zoom in where tapped (a tap waits a moment,
  so a double-tap only zooms). It is as wide as the screen, up to a book's
  page; the letter size scales it. The scan itself is a link, to open at
  HebrewBooks.
- daf-renderer read every stylesheet on the page and stopped at Google
  Fonts', which a page may not read; patched to skip those.

**75. וילנא is the scanned page itself, from Sefaria.**
- Sefaria keeps the scan of the Romm Vilna printing (1880-86, the National
  Library's copy) for every amud, at an address made from the ref
  (manuscripts.sefaria.org/vilna-romm/Bava_Kamma_83b.jpg), and lets any page
  show it. So וילנא is now the printed page itself: the browser loads the
  picture straight from there (through the Worker if that fails), no server
  and no PDF.
- Tinted, not edited: grayscale, a little warmth and contrast, multiplied onto
  the app's paper, so the yellowed paper becomes the page's own; in the dark,
  inverted and screened, light ink on the dark page.
- Double-tap zooms in where tapped and back; two fingers zoom as far as they
  spread. Zooming keeps the tapped place under the finger in a right-to-left
  page too (scrollLeft counts from the right there; it did not, before).
- If the scan cannot be had (offline, an amud it lacks), the page is laid out
  from its text by daf-renderer, as in 74, where a line can be tapped.

**76. Two Vilnas, a smooth zoom, and "updated".**
- וילנא is the scan; וילנא חי ("living Vilna") is the page rebuilt from its
  text (74), kept as its own view: there the line you are on is lit, your
  reading is followed and a tap opens a comment. Five looks now.
- The scan is painted once onto a canvas in the app's own ink and paper
  (each grey mapped between --ink and --paper, levels taken from the page), so
  dark mode is warm cream on the dark page, not black and white. Its pixels
  must be readable, so it is asked for openly from Sefaria, else through the
  Worker as the app's own; failing both, it is shown under a CSS filter.
- Zoom was choppy: every finger movement resized a 1530x2450 picture under a
  filter and blend. Now, while the fingers (or a double-tap's animation, or a
  trackpad's pinch) move, the page is only scaled by a transform, on the
  graphics chip; when they stop it is laid out once at its new size and the
  place zoomed at is put back under the fingers.
- "Updated": the Worker says which deployment it is (/x/version, Cloudflare's
  version metadata). The first time a new one opens, a short note says
  "עודכן ✓" (just that: the learner asked for no more); if one is published while the app
  is open, it offers a refresh. Settings shows the version's date.

**77. The conversation on a phone, pulled down out of the way.**
- Its top edge follows the finger to any height, to the pixel -- no steps
  (snapping to three sizes was tried first: "too sensitive, either up or
  down"). Low (under ~120 px), only the answer's own words are left: no "last
  time", review buttons or the question repeated.
- It snaps only at the ends: let go near the bottom, or flicked down hard,
  it is gone -- nothing above the toolbar, speak and listen; flicked up (on
  the toolbar too), it comes back as tall as it was. Kept between visits.
- The computer the same, with the mouse. (Its old handle only set a maximum
  height, so with a short answer dragging did nothing visible, and it never
  went below 70 px: "doesn't work on the PC".)

**78. Ready for iPhone, Samsung, Nothing Phone, iPad and the computer.**
- Installable everywhere: the manifest has an id, scope and description; a
  service worker (`sw.js`, network first, so a new version is never held
  back) lets Samsung Internet and Chrome offer to install it, and lets it
  open with no signal on the pages already learned. ⚙ shows the way to
  install on this device: a button where the browser has one, the Share →
  Add to Home Screen steps on an iPhone, the menu on Android.
- The mic on a phone: the screen stays awake while it listens (a locked phone
  stops the microphone); coming back to the app wakes the sound engine, or
  opens the mic anew if the phone ended it. "Allow the microphone" says where
  that switch is on an iPhone, on Android, or on the computer.
- Android's back button closes the sheet that is up, not the app.
- Buttons a finger can hit (~40px) on every touch screen, the iPad included.
- A browser too old to run the app (before iOS 16.4, March 2023) says so,
  instead of showing an empty page.
- Checked at 13 sizes, from the iPhone SE and a folded Galaxy Fold to a
  1920px screen, light and dark: nothing wider than the screen, nothing cut off.


**79. Allowed once, not asked every time.**
- The microphone is the only thing the app asks for (sound, the clipboard and
  the stored pages need no permission; it never asks for location). It used
  to ask for the microphone afresh at every tap of the mic, and give it back
  at every mute -- and an iPhone, whose Safari "asks" by default, can show its
  prompt again for each request. Now it is asked for once and kept: muting
  switches it off (nothing heard or recorded) and the mic button turns it
  straight back on. It is let go after ten minutes off, or at once when the
  app is put away while off, so the phone's "mic in use" mark does not linger.
- What only the learner can switch: on an iPhone, Settings → Apps → Safari →
  Microphone → Allow; Safari on a Mac, per site. ⚙ says so, on those devices
  only. Android and Chrome remember on their own.
- Installed, it asks the phone to keep its data for good (no prompt).
