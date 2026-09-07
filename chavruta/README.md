# AI Chavruta

A study partner for Talmud. You read aloud from an open gemara; it has already
read the page and its commentaries, it answers when asked, and it tells you
when your reading does not hold.

Spec: `../01d432aa-chavrutaspecv0.1.md`. Decisions since: `docs/decisions.md`.
Plan, and what probing established: `docs/plan.md`.

## Run it

    pip install -r requirements.txt
    export ANTHROPIC_API_KEY=...          # or: ant auth login

    python3 pack/build_pack.py "Berakhot 2a" -o packs/   # needs sefaria.org
    python3 pack/verify_pack.py packs/berakhot_2a.json   # check it matches
    python3 -m chavruta.cli packs/berakhot_2a.json

Read a line, say what you think it means, and push back. Misread something on
purpose and see whether it catches you — that is the test that matters.

The reading surface is separate, and static:

    python3 -m http.server 8000     # then open http://localhost:8000/web/

## What is here

    pack/build_pack.py     builds a daf pack from Sefaria
    pack/extract_sugya.py  reads the argument structure out of a commentary
    pack/verify_pack.py    diffs a pack against live Sefaria, char for char
    pack/make_fixture.py   builds a pack offline from pack/fixture_source.py
    chavruta/pack.py       loading a pack and asking it questions
    chavruta/ground.py     the grounding gate
    chavruta/partner.py    what the partner is told and what it is given
    chavruta/cli.py        learning with it in text
    web/index.html         the daf and its connections panel

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
