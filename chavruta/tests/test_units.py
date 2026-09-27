# -*- coding: utf-8 -*-
"""Unit tests, against real recorded Sefaria data.   python3 -m unittest -v tests.test_units"""

import importlib
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import fake_openai, fake_sefaria  # noqa: E402

SEF, SEF_URL = fake_sefaria.start()
OAI, OAI_URL = fake_openai.start()
os.environ.update(CHAVRUTA_SEFARIA_API=SEF_URL, OPENAI_BASE_URL=OAI_URL, OPENAI_API_KEY="sk-test",
                  CHAVRUTA_PACKS=tempfile.mkdtemp())

from chavruta import sefaria  # noqa: E402
importlib.reload(sefaria)
from chavruta import align, ground, partner, retrieve  # noqa: E402
from chavruta.llm import LLM, speakable  # noqa: E402
from chavruta.pack import Pack  # noqa: E402

PACK = sefaria.build("Berakhot 2a")


class Sefaria(unittest.TestCase):
    def test_amud_has_its_real_lines(self):
        self.assertEqual(len(PACK["segments"]), 14)
        self.assertEqual((PACK["next"], PACK["prev"]), ("Berakhot 2b", None))

    def test_every_line_has_commentary_attached(self):
        # The first version trimmed the anchor and attached nothing to anything.
        self.assertTrue(all(s["commentaries"] for s in PACK["segments"]))

    def test_backbone_and_rishonim_are_named_properly(self):
        for name in ("Rashi", "Tosafot", "Steinsaltz", "Rif", "Rashba", "Meiri"):
            self.assertIn(name, PACK["commentators"])

    def test_diburim_in_both_styles(self):
        first = lambda n: next(e for s in PACK["segments"] for e in s["commentaries"].get(n, []))
        self.assertEqual(first("Tosafot")["dibur"], "מאימתי קורין וכו'")          # dash style
        self.assertEqual(first("Rashba")["dibur"], "מעשה ובאו בניו מבית המשתה")    # bold style

    def test_no_bulky_cross_reference_text_in_the_pack(self):
        self.assertNotIn("xref_text", str(PACK)[:100])
        self.assertIn("Deuteronomy 6:7", sum((s["xrefs"] for s in PACK["segments"]), []))

    def test_a_bare_version_title_is_refused_like_the_real_api(self):
        self.assertFalse(fake_sefaria.texts("Berakhot 2a", ["William Davidson Edition - Vocalized Aramaic"])["versions"])

    def test_berakhot_runs_2a_to_64a(self):
        a = sefaria.amudim("Berakhot")
        self.assertEqual((len(a), a[0], a[-1]), (125, "Berakhot 2a", "Berakhot 64a"))


class Following(unittest.TestCase):
    page = align.Page(PACK)

    def listen(self, text):
        return align.listen(self.page, text)

    def test_reading_is_followed(self):
        r = self.listen("מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן")
        self.assertEqual((r["mode"], r["line"], r["stopped_mid_clause"]), ("reading", 1, False))

    def test_asr_spelling_does_not_break_it(self):
        self.assertEqual(self.listen("מאימתי קורים את שמע בערבים משעה שהכהנים נכנסים לאכל")["line"], 1)

    def test_stopping_mid_clause_is_noticed(self):
        r = self.listen("עד סוף האשמורה הראשונה דברי רבי אליעזר וחכמים אומרים עד חצות רבן גמליאל אומר עד")
        self.assertTrue(r["stopped_mid_clause"])
        self.assertEqual((r["line"], r["words_left_in_clause"]), (3, 3))

    def test_talking_is_not_reading(self):
        self.assertEqual(self.listen("so he's saying you read shema before bed")["mode"], "talking")

    def test_an_english_sentence_quoting_aramaic_points_at_its_line(self):
        r = self.listen("so when he says תנא אקרא קאי he means the tanna stands on the verse")
        self.assertEqual((r["mode"], r["line"]), ("quoting", 8))


class Grounding(unittest.TestCase):
    known = {"Rashi on Berakhot 2a:1:2", "Tosafot on Berakhot 2a:1:1", "Mishneh Torah, Reading the Shema 1:9"}

    def ok(self, text):
        return ground.check(text, self.known).ok

    def test_cited(self):
        self.assertTrue(self.ok("רש״י [[Rashi on Berakhot 2a:1:2]] אומר שזה שליש הלילה"))
        self.assertTrue(self.ok("Tosafot [[Tosafot on Berakhot 2a:1:1]] asks four questions."))
        self.assertTrue(self.ok("הרמב״ם [[Mishneh Torah, Reading the Shema 1:9]] פוסק כחכמים"))

    def test_floating_names_in_hebrew(self):
        for text in ("רש״י אומר שזה שליש הלילה", "ולפי תוספות זה לא מסתדר", 'והרשב"א חולק', "ולרש״י זה ברור"):
            self.assertFalse(self.ok(text), text)

    def test_invented_reference(self):
        self.assertFalse(self.ok("Rashi [[Rashi on Berakhot 9a:1:1]] says so"))

    def test_words_that_merely_contain_a_name(self):
        self.assertTrue(self.ok("המאירים והרנים שמרים"))


class Routing(unittest.TestCase):
    pack = Pack(PACK)

    def test_spoken_names(self):
        present = set(self.pack.commentators())
        for spoken, want in (("Rashba", "Rashba"), ('רשב"א', "Rashba"), ("Tosfos", "Tosafot"), ("Nonsense", None)):
            self.assertEqual(retrieve._canonical(spoken, present), want)

    def test_nothing_extra_by_default(self):
        self.assertEqual(retrieve.extras(self.pack, 1, {"kind": "meaning"}, "daf"), [])

    def test_naming_a_rishon_brings_him(self):
        got = retrieve.extras(self.pack, 3, {"kind": "logic", "names": ["Rashba"]}, "daf")
        self.assertTrue(any(name == "Rashba" for name, _ in got))

    def test_halacha_brings_the_halachic_sources(self):
        got = {name for name, _ in retrieve.extras(self.pack, 1, {"kind": "halacha"}, "daf")}
        self.assertTrue({"Rif", "Meiri"} & got)


class Partner(unittest.TestCase):
    pack = Pack(PACK)

    def test_whole_amud_in_view(self):
        ctx = partner.amud_context(self.pack)
        self.assertEqual(ctx.count("=== LINE"), 14)
        self.assertIn("[[Tosafot on Berakhot 2a:1:1]]", ctx)

    def test_never_correct_their_words(self):
        self.assertIn("Never correct their Hebrew", partner.CONSTITUTION)

    def test_nudge_only_at_the_real_machlokes(self):
        self.assertIn("Rashi", partner.nudge(self.pack, 1, "en")[0])
        self.assertIsNone(partner.nudge(self.pack, 7, "en"))

    def test_a_turn_is_grounded(self):
        text, verdict, history, trace = partner.Partner(self.pack, LLM()).ask(1, [], "so he's saying you read shema at bedtime")
        self.assertTrue(verdict.ok, text)
        self.assertEqual(len(history), 2)

    def test_an_ungrounded_answer_is_retried(self):
        text, verdict, _, _ = partner.Partner(self.pack, LLM()).ask(1, [], "UNGROUNDED please")
        self.assertTrue(verdict.ok, text)


class Speaking(unittest.TestCase):
    def test_quotes_and_citations_are_not_spoken(self):
        said = speakable("תסתכל על «עד סוף האשמורה» [[Rashi on Berakhot 2a:1:2]] — רש״י אומר שליש הלילה.")
        self.assertNotIn("האשמורה", said)
        self.assertNotIn("[[", said)
        self.assertIn("רש״י אומר", said)   # its own Hebrew is spoken

    def test_unmarked_gemara_is_still_not_spoken(self):
        page = align.Page(PACK)
        said = align.unspeak("So look: עד סוף האשמורה הראשונה דברי רבי אליעזר — that is his view.", page)
        self.assertNotIn("האשמורה", said)
        self.assertIn("that is his view", said)
        own = "רש״י אומר שזה שליש הלילה, ולכן חכמים חולקים עליו"
        self.assertEqual(align.unspeak(own, page), own)   # the partner's own Hebrew stays

    def test_effort_ladder_survives_a_refusal(self):
        fake_openai.STATE["log"].clear()
        LLM().say("x", [{"role": "user", "content": "y"}], heavy=False)
        efforts = [e["effort"] for e in fake_openai.STATE["log"] if e["path"] == "chat"]
        self.assertEqual(efforts[:2], ["none", "minimal"])


class Server(unittest.TestCase):
    def test_only_berakhot(self):
        from chavruta import server
        self.assertTrue(server.allowed("Berakhot 64a"))
        self.assertFalse(server.allowed("Berakhot 64b"))
        self.assertFalse(server.allowed("Shabbat 2a"))
        self.assertFalse(server.allowed("../../etc/passwd"))

    def test_packs_from_older_code_are_rebuilt(self):
        import json
        from chavruta import server
        importlib.reload(server)
        path = server.pack_path("Berakhot 2b")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump({"ref": "Berakhot 2b", "segments": [{"n": 1, "ref": "Berakhot 2b:1", "he": "x",
                                                          "commentaries": {}}]}, f)
        pack = server.load_pack("Berakhot 2b")
        self.assertEqual(pack.data.get("pack_version"), sefaria.PACK_VERSION)
        self.assertGreater(len(pack.segments), 1)


if __name__ == "__main__":
    unittest.main()
