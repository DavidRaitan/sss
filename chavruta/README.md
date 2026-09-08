# AI Chavruta

A study partner for Talmud. You open a daf, read it, and say what you think it
means. It has already read the page and its commentaries, it cites everything,
and it tells you when your reading does not hold.

Spec: `../01d432aa-chavrutaspecv0.1.md`. Decisions: `docs/decisions.md`.
Plan and findings: `docs/plan.md`.

## Run it

    ./run.sh

First run makes a virtualenv, installs, and writes a `.env` for your API key.
Put the key in, run it again, and the app opens in your browser. Type a daf —
`Berakhot 2a`, `Bava Metzia 59a` — and it is fetched from Sefaria, cached, and
opened. Pick a line, then talk to it.

    ./run.sh doctor

Checks the three things that can be wrong — your key, Sefaria, and whether the
models named in `.env` are actually reachable — and names which one failed.

**Never commit `.env`.** It is gitignored. If a key is ever pasted anywhere
public, rotate it immediately.

## What it costs

Two models, because two jobs. Deciding *what kind of question was that* is
classification and runs on the budget model for a fraction of a cent. Telling
you your reading cannot stand and showing why runs on the mid-tier model, once
per turn, against a system prompt that barely changes — which providers cache
automatically at roughly a tenth of the price, so a long session pays full
price for the page about once.

Defaults are `gpt-5.6-terra` (heavy) and `gpt-5.6-luna` (cheap), chosen on
published September 2026 pricing. Model names move; `doctor` asks your key what
it can actually see and tells you if a default has gone stale. Override in
`.env`, or set `CHAVRUTA_PROVIDER=anthropic` to use Claude instead.

## The backbone, and widening

What is printed on the daf — Steinsaltz, Rashi, Tosafot, and Rabbeinu Chananel
where he appears — is the backbone. It loads with the page and is always in
front of the model.

Everything else is on the bench. Sefaria returns every link on a daf in one
request, so the wider Rishonim are already on disk from the first moment; what
costs money and attention is how much of it enters the prompt. So a cheap model
classifies what you just said, `commentators.py` says who answers that kind of
question in this masechta, and only those come in. Widening is instant rather
than a pause mid-sentence.

`chavruta/commentators.py` is the judgement layer: who the heavy hitters are,
what each is actually for, who is strong in which masechta, and where the
printed page is not what you would assume — Nedarim's "Rashi" is not Rashi's,
Bava Batra is Rashbam from 29a. That file is opinionated and partly wrong.
Correct it as you learn; that is the moat.

## Levels

`standard` is the default: you read Aramaic but not fast, quotes stay in
Hebrew, only the hard word gets glossed. `beginner` leans on English and
explains terms unasked. `fluent` does not translate and goes straight to the
difficulty. Switch it in the header.

## What is here

    run.sh                  one command: set up, then open the app
    chavruta/server.py      the local app
    chavruta/commentators.py who to ask, for what, where they are strong
    chavruta/retrieve.py    which sources enter the conversation, and when
    chavruta/partner.py     what the partner is told and what it is given
    chavruta/ground.py      the grounding gate
    chavruta/llm.py         the model layer: OpenAI or Claude, cheap and heavy
    chavruta/sefaria.py     fetching a daf and building its pack
    chavruta/sugya.py       reads the argument structure out of a commentary
    chavruta/pack.py        loading a pack and asking it questions
    chavruta/cli.py         the same conversation in a terminal
    pack/build_pack.py      pre-warm a pack you know you will learn
    pack/verify_pack.py     diffs a pack against live Sefaria, char for char
    web/index.html          the daf, the panel, and the conversation

### Daf packs

A pack is everything about one amud, precomputed once and served to everyone
who learns that page. Text, translation, commentaries, halachic landing points
and cross-references are all retrieved, never generated, so any claim the
partner makes can be traced to a reference you can open.

Per segment: the vocalized text, an unpointed copy for matching against speech,
the clause boundaries — where the printed text stops, which is what lets it
tell you that you stopped a word early — the Steinsaltz gloss with its
daf-words and expansion still separated, the commentaries keyed by their dibur
hamatchil, the Ein Mishpat links out to Rambam / Tur / Shulchan Arukh, and the
category counts the panel is drawn from.

### The sugya structure

`extract_sugya.py` reads the argument a commentary states about itself, from
the fixed phrases it states it in — `פירש רש"י`, `ועוד קשה`, `ויש לומר`,
`לכן פירש ר"ת`, `ומכאן נראה`, and the `(דף ה.)` citations. On the first Tosafot
of shas it recovers, correctly: position → four difficulties → Rabbeinu Tam's
alternative → a question → its answer → where the Ri lands → the conclusion,
with four cross-references.

That structure is retrieved rather than generated, so it can be shown with the
words that produced it, and it fails visibly instead of becoming a confident
paraphrase.

### The grounding gate

Two things are checked on every turn before it reaches you. A citation the pack
never held means the source was invented. A commentator named without a
citation means the attribution is floating — "Tosafot says" with nothing after
it. Either sends the turn back to be answered again with the specific
complaint; failing twice produces "I don't have that here, let's look."

## Fixture data

`packs/berakhot_2a.json` is built offline from `pack/fixture_source.py`, a
transcription of the first three segments of Berakhot 2a. It exists so
everything runs without network access. It is **not authoritative** — the
partner says so on screen, and `verify_pack.py` is the check. Rebuild from the
API before learning anything real off it.

## Licensing

The Steinsaltz / Davidson layer — the punctuation, the English, the Hebrew
biur, and the bold alignment — is CC BY-NC. Fine for a free product; all four
go at once if this ever charges. See `docs/plan.md`.
