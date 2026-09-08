# -*- coding: utf-8 -*-
"""Deciding which sources enter the conversation, and when.

The design asked for a backbone that loads with the page and a wider bench read
in as the conversation goes. Building it turned up a cheaper shape for the same
behaviour: Sefaria returns every link on a daf in one request, so fetching the
wide bench costs nothing extra once you have asked at all. What actually costs
-- in money and in the model's attention -- is how much of it goes into the
prompt.

So the pack holds everything and this module is the valve. The backbone is
always in context. The wider Rishonim are present on disk from the first
moment, and enter the prompt only when the question reaches for them, which
means widening is instant instead of a mid-sentence pause.
"""

from . import commentators as who

# What the learner is doing, which decides who gets consulted.
KINDS = list(who.ROUTES) + ["reading", "other"]

ROUTER_SYSTEM = """Classify one thing a person studying Talmud just said to their
study partner. Answer only with JSON.

{"kind": one of %s,
 "claim": true if they are asserting what the text means (as opposed to asking),
 "about": a short phrase naming what they are asking about, or ""}

What the kinds mean:
%s
- reading: they are reading the text aloud, not saying anything about it
- other: small talk, navigation, anything else

A claim is the important flag: if they are telling you what the sugya says,
their partner has to check it before responding to it.""" % (
    KINDS, "\n".join("- %s: %s" % (k, v) for k, v in who.ROUTES.items()))


def classify(llm, said):
    """Cheap model, one short call. Falls back to consulting broadly."""
    try:
        out = llm.json(ROUTER_SYSTEM, [{"role": "user", "content": said}], heavy=False)
    except Exception:
        return {"kind": "other", "claim": False, "about": ""}
    kind = out.get("kind")
    return {
        "kind": kind if kind in KINDS else "other",
        "claim": bool(out.get("claim")),
        "about": str(out.get("about") or "")[:120],
    }


def consult(pack, n, kind, claim):
    """Which commentators belong in the prompt for this turn.

    The backbone is always there -- it is what the learner is looking at. A
    checked claim also pulls in whoever argues about the page, because
    disagreeing well means having the objection in hand, not improvising one.
    """
    masechta = pack.data.get("masechta", "")
    names = list(who.backbone_for(masechta))
    if kind in who.ROUTES:
        names += who.wide_for(masechta, [kind])[:3]
    if claim or kind == "conflict":
        names += [nm for nm, _ in pack.machlokes_on(n)]
    have = set(pack.segment(n)["commentaries"])
    return [nm for nm in dict.fromkeys(names) if nm in have]


def sources(pack, n, names):
    """The chosen sources on this line, heaviest first."""
    chosen = []
    for name, entry in pack.sources_for(n):
        if name in names:
            chosen.append((name, entry))
    return chosen
