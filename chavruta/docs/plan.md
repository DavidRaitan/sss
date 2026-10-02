# Plan, after testing the ground

Spec v0.1 §7 says: hand-build a pack for one amud and talk to it before writing
code, because a flat conversation is a one-day finding instead of a six-week
one. That test has now been run. It passed. What follows is the plan it argues
for, plus the four other things probing turned up.

## What was tested

| Assumption | Result |
|---|---|
| Davidson punctuation is ground truth for where a clause stops | **Holds.** Berakhot 2a:1 splits into its four units correctly |
| Steinsaltz's bold marks the literal daf words | **Holds**, in Hebrew and English both |
| Rashi and Tosafot anchor to a dibur hamatchil | **Holds** — and Sefaria ships the regex per commentary |
| A hand-written masechta→commentator table is the moat | **Wrong shape.** Half of it is derivable |
| The sugya map has to be generated | **Partly wrong.** Much of it is already written down |
| Day-one test: is the conversation good? | **Passes** |
| Steinsaltz material is CC-BY-NC | **Confirmed. Non-commercial.** |
| Rabbeinu Chananel is available | **Masechta-dependent.** Shabbat yes, 314 daf. Berakhot no |

## The day-one test, and why it passed

The test case was the first Tosafot on shas (`Tosafot on Berakhot 2a:1:1`),
because it is exactly the conversation described in the design: *"actually,
this is a big machlokes between Rashi and Tosafot."*

That single retrieved unit contains, unaided: Rashi's position stated in full;
four separate objections to it; Rabbeinu Tam's alternative reading; where the
Ri finally lands; a practical conclusion; and six cross-references to other
dapim, with numbers.

So the whole exchange — *"this is a big argument" → "does he really hold that,
I remember the opposite elsewhere" → "that's exactly the question, and here is
the answer"* — is supported by retrieved material. Nothing has to be invented.
That is the product working, and it satisfies non-negotiable §3.1 by
construction rather than by restraint.

## The finding that saves the most time

The sugya map was the scariest line item in the budget, because it looked like
pure generation. It is largely not. Tosafot's prose is formulaic:

    פירש רש"י …          here is Rashi's position
    תימא לפירושו …       here is the difficulty with it
    ועוד קשה …           and another (four times in this one comment)
    לכן פירש ר"ת …       here is the alternative
    על כן אומר ר"י …     here is where it lands
    (דף ה.) (דף כו.)     here is what it depends on elsewhere

Those markers are stable across shas. Parsing them yields most of the
structural map — where the question is posed, which move is the hard one, who
disagrees, what the page leans on — as **retrieved** structure rather than
generated claims. Which means it can be checked, it degrades visibly rather
than silently, and it does not need a model to understand a sugya from scratch.

Generate only what parsing misses, and mark it as generated.

## The finding that hurts

The Davidson/Steinsaltz layer is CC-BY-NC. Confirmed, not assumed.

That single licence covers four things this design leans on: the punctuation
that makes pisuk correction cheap, the English translation, the Hebrew biur,
and the bold alignment between Aramaic and expansion. They are the four free
gifts in the data, and they are one licence.

- **Free product:** no issue. Use all of it.
- **Paid product:** all four go at once. Either licence from Koren, or build
  your own punctuation and translation layer — which becomes a real asset, and
  costs real months — or fall back to the public-domain Wikisource text with
  Rashi and Tosafot, which keeps the fluent-learner product and guts the
  beginner one.

This is not a licensing footnote, it is a product fork, and it should be
decided before the pisuk feature is built on top of it.

## On the connections panel

Confirmed: Sefaria tags every link with a category — Commentary, Halakhah,
Talmud, Midrash, Responsa, Reference — and that tagging is what its side panel
is built from. It is the skeleton of *"what did X say here"* and *"what is the
law here"*, already done for all of shas. The pack mirrors it rather than
inventing a taxonomy.

Two things added on top: a **weight** per commentator, which decides both what
surfaces first and what is heavy enough to precompute; and the threshold below
which a source is fetched live instead of shipped in the pack.

On precomputing "at five in the morning": packs are identical for every learner
on that daf, so this is build-once-serve-all, not a per-user morning job — much
cheaper than a nightly per-user run. The per-user job actually worth building
is pulling tomorrow's daf onto the phone for offline learning.

## Six weeks

Week 0 is not a week. It is two tests to run before committing the other five.

**Week 0 — the two open kill-tests.** (The third, the day-one test, is done.)
1. *Code-switched ASR.* Record twenty minutes of real learning, with the
   language switching mid-sentence as it actually does, and run it at the
   candidate providers. This is the largest unproven risk in the project and it
   is an afternoon to settle.
2. *The licensing fork.* Free or paid decides which text layer everything sits on.

**Week 1 — packs.** Pipeline end-to-end on one masechta. Discourse-marker
extraction for the sugya map. The grounding gate, which must exist from the
first day rather than be retrofitted.

**Week 2 — disagreement, in text.** The hardest behaviour in the product and
the one most likely to fail, so prove it in the cheapest possible medium before
paying for voice. Type at it, misread on purpose, and see whether it catches
you and shows you why from the page. If this is flat, no amount of audio saves
it.

**Weeks 3–4 — voice and the reading surface.** The linear daf, the panel, the
listening loop, the interruption budget.

**Week 5 — real sessions.** Learn on it daily. Fix what actually breaks, which
will not be what was planned for.

**Week 6 — buffer.** Tishrei will take it. Plan for that rather than discover it.

Disagreement moved from late to Week 2 deliberately. It is the reason the
product exists, it is the thing most likely not to work, and it is the cheapest
to test before voice is in the way.
