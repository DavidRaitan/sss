# AI Chavruta

A voice-first study partner for Talmud. The learner reads aloud from an open
gemara; the system has already read the page and its commentaries, listens,
answers when asked, and pushes back when the reading does not hold.

See `../01d432aa-chavrutaspecv0.1.md` for the product spec and
`docs/decisions.md` for what has been settled since.

## Layout

    pack/build_pack.py   builds a daf pack from Sefaria
    packs/               built packs (cached artifacts, one per amud)
    docs/decisions.md    design decisions and open questions

## Daf packs

A pack is everything about one amud, precomputed once and served to every user
who learns that page. It holds no generated content: text, translation,
commentaries, halachic landing points and cross-references are all retrieved,
so any claim the chavruta makes can be traced to a reference the learner can
open.

    python3 pack/build_pack.py "Berakhot 2a" -o packs/

Per segment a pack carries the vocalized text, an unpointed copy for matching
against speech, the clause boundaries (where the printed text stops — see
decisions.md §4), the Steinsaltz gloss with its daf-words/expansion split
intact, the commentaries keyed by their dibur hamatchil, and the Ein Mishpat
links out to Rambam, Tur and Shulchan Arukh.

Requires outbound access to `www.sefaria.org`.
