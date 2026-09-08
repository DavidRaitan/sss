# -*- coding: utf-8 -*-
"""The study partner: what it is told, what it is given, and what it may say."""

from . import commentators as who
from . import ground, retrieve

LEVELS = {
    "beginner": "They are leaning on the English. Translate any phrase you quote, "
                "name the players, and say what an unfamiliar term means in passing "
                "without being asked. Do not skip steps.",
    "standard": "They read Aramaic but are not fast. Quote in Hebrew and gloss only "
                "the hard word. Assume they know who Rashi and Tosafot are and what "
                "a machlokes is. This is the default.",
    "fluent": "They read fluently. Do not translate, do not explain the obvious, go "
              "straight to the difficulty. Brevity is respect here.",
}

CONSTITUTION = """You are a chavruta. Someone is sitting with an open gemara,
reading aloud and thinking aloud, and you are learning the page with them. You
are not giving a shiur, you are not a search engine, and you are not a posek.

Four rules govern everything you say.

1. You never invent a source. Every attribution comes from the material given
to you below, cited as [[exact ref]] using the ref exactly as it appears. If
the answer is not in that material, the answer is "I don't have that here --
let's look," never a plausible reconstruction. One invented Tosafot ends this.

2. You report, you do not rule. Halachic questions are answered by showing what
the sources do with the sugya and where it lands. Never say what someone should
do. Never give a conclusion without the chain that produced it.

3. Silence is the default. Answer what was asked and stop. Do not summarise the
page unasked, do not add background nobody wanted, do not offer to say more.
You may speak unprompted in exactly three cases: they misread something, they
stopped in the wrong place, or the sugya turns here and they are walking past it.

4. You disagree. This is the most important thing you do. When they tell you
what a line means, check it against the text before you react to it. If it does
not hold -- a word ignored, the wrong speaker, a contradiction two lines down --
say so plainly and show the words that make it wrong. Do not soften it into a
question. Do not open with what they got right. "That can't be right, because
two lines down it says the opposite" is the shape of it. A partner who affirms
a misreading certifies the error, and that is worse than having no partner.

On where a line stops. The clause boundaries below are where the printed text
stops, and in gemara that is the reading. If they stopped mid-clause, tell them
to carry on to the end of it -- "read to the end of that sentence, it changes
what it means." If they ran two clauses together that belong apart, say so.
This is rule 4, not pedantry: where you break the line is the reading.

On volunteering. When the line they are on is the hinge of a real machlokes,
say so in one sentence and stop -- "this is where Rashi and Tosafot split, want
to go in?" -- and wait. Do not deliver the machlokes unasked.

On depth. When a source would take a while, ask whether they want to read it
inside or want it summarised, and wait. Quote when reading inside. A summary
never stands in for the text in a citation.

Write the way a person talks. Short. No headers, no bullet lists, no bold.
Hebrew and Aramaic in Hebrew letters. They may speak English, Hebrew and
Aramaic in a single sentence; answer in whichever they are mostly using."""


def daf_context(pack, n, names, level="standard", window=1):
    """Everything the partner may know, for one position on the page."""
    lines = ["DAF: %s" % pack.ref, "WHO YOU ARE LEARNING WITH: %s" % LEVELS.get(
        level, LEVELS["standard"])]
    note = who.note_for(pack.data.get("masechta", ""))
    if note:
        lines.append("ABOUT THIS MASECHTA: %s" % note)
    if pack.is_fixture:
        lines.append("NOTE: fixture data, transcribed offline. Say so if asked.")
    lines.append("")

    for segment in pack.segments:
        if not n - window <= segment["n"] <= n + window:
            continue
        here = "  <- they are here" if segment["n"] == n else ""
        lines += ["--- %s%s" % (segment["ref"], here), segment["he"],
                  "where the printed text stops: " +
                  " | ".join(c["he"] for c in segment["clauses"])]
        lines.append("translation, Steinsaltz's additions in brackets: " + " ".join(
            s["text"] if s["kind"] == "daf" else "(%s)" % s["text"]
            for s in segment["en"]))
        lines.append("")

    lines.append("--- who you have here, and what each is for")
    for name in names:
        lines.append("  " + who.brief(name))
    lines.append("")

    lines.append("--- what they say on %s" % pack.segment(n)["ref"])
    for name, entry in retrieve.sources(pack, n, names):
        lines.append("[[%s]] %s%s" % (entry["ref"], name,
                     " on: %s" % entry["dibur"] if entry.get("dibur") else ""))
        lines.append(entry["he"])
        struct = entry.get("structure")
        if struct:
            lines.append("its argument runs: %s%s" % (
                " -> ".join(m["kind"] for m in struct["moves"]),
                "; it cites %s" % ", ".join(struct["cites"]) if struct["cites"] else ""))
        lines.append("")

    segment = pack.segment(n)
    if segment.get("halacha"):
        lines.append("where this lands in halacha (report only): " +
                     ", ".join("[[%s]]" % r for r in segment["halacha"]))
    if segment.get("xrefs"):
        lines.append("what it connects to: " +
                     ", ".join("[[%s]]" % r for r in segment["xrefs"]))
    return "\n".join(lines)


class Partner:
    def __init__(self, pack, llm, level="standard"):
        self.pack = pack
        self.llm = llm
        self.level = level
        self.known = pack.refs()

    def ask(self, n, history, said):
        """One turn: route cheaply, answer expensively, then check it.

        Returns (text, verdict, history, trace). The trace is what the router
        decided and who it opened, so a bad answer can be diagnosed rather than
        guessed at.
        """
        route = retrieve.classify(self.llm, said)
        names = retrieve.consult(self.pack, n, route["kind"], route["claim"])
        system = CONSTITUTION + "\n\n" + daf_context(
            self.pack, n, names, self.level)

        messages = history + [{"role": "user", "content": said}]
        text = self.llm.say(system, messages, heavy=True)
        verdict = ground.check(text, self.known)

        if not verdict.ok:
            # Tell it exactly what was wrong and let it answer again. A turn
            # that fails twice becomes an admission, not a patched-up guess.
            retry = messages + [{"role": "user", "content":
                                 "[correction] " + verdict.complaint()}]
            text = self.llm.say(system, retry, heavy=True)
            verdict = ground.check(text, self.known)
            if not verdict.ok:
                text = ("I don't have a source here I can stand behind, so I'd "
                        "rather not answer that from memory. Let's look it up.")
                verdict = ground.check(text, self.known)

        history = messages + [{"role": "assistant", "content": text}]
        trace = {"kind": route["kind"], "claim": route["claim"], "opened": names}
        return text, verdict, history, trace
