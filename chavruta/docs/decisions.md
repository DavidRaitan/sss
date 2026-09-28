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
