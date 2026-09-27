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

**12. The gemara is never spoken; the partner's own Hebrew is.** Quotes are
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
