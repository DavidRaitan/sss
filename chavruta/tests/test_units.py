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
from chavruta import align, ground, library, partner, retrieve, sugya  # noqa: E402
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


class Sections(unittest.TestCase):
    def test_berakhot_2a_divides_as_the_page_does(self):
        got = [(s["label"], s["from"], s["to"]) for s in PACK["sections"]]
        self.assertEqual(got, [("משנה", 1, 5), ("גמרא", 6, 11), ("אמר מר", 12, 14)])

    def test_commentary_from_another_tractate_is_not_on_this_page(self):
        names = {e["ref"] for s in PACK["segments"] for es in s["commentaries"].values() for e in es}
        self.assertFalse(any("Pesachim" in r or "Zevachim" in r for r in names))


class Index(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import importlib.util, json
        from chavruta.masechta_index import Index as Ix
        spec = importlib.util.spec_from_file_location("build_index", os.path.join(
            os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "pack", "build_index.py"))
        mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
        mod.main(["Berakhot"])
        cls.index = Ix.load(os.environ["CHAVRUTA_PACKS"], "Berakhot")

    def test_whole_masechta_indexed(self):
        self.assertEqual(len(self.index.pages), 125)

    def test_a_phrase_is_found_on_its_page(self):
        hits = self.index.phrase("תנא היכא קאי דקתני מאימתי")
        self.assertTrue(any(h["ref"].startswith("Berakhot 2a") for h in hits))

    def test_elsewhere_leads_are_citable_in_a_turn(self):
        pack = Pack(PACK)
        p = partner.Partner(pack, LLM(), index=self.index)
        text, verdict, _, trace = p.ask(6, [], "didn't we learn something like this elsewhere? explain the structure")
        self.assertIn("elsewhere", trace)
        self.assertTrue(verdict.ok, text)


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

    def test_halacha_opens_where_the_meiri_rules_not_where_he_starts(self):
        refs = [e["ref"] for _, e in retrieve.extras(self.pack, 1, {"kind": "halacha"}, "daf")]
        self.assertIn("Meiri on Berakhot 2a:2", refs)       # "ולענין פסק הלכה"
        self.assertNotIn("Meiri on Berakhot 2a:1", refs)
        self.assertTrue(any(r.startswith("Rosh on Berakhot") for r in refs))  # hung on line 12

    def test_a_mic_check_opens_nothing_whatever_the_depth(self):
        self.assertEqual(retrieve.extras(self.pack, 1, {"kind": "ping"}, "rishonim"), [])
        self.assertEqual(retrieve.plan(self.pack, 1, {"kind": "ping"}), [])

    def test_halacha_plans_the_codes_from_the_ein_mishpat(self):
        jobs = [job for job, _ in retrieve.plan(self.pack, 1, {"kind": "halacha", "names": []})]
        self.assertIn(("text", "Tur, Orach Chayim 235"), jobs)
        self.assertIn(("text", "Shulchan Arukh, Orach Chayim 235:1"), jobs)
        self.assertIn(("text", "Mishneh Torah, Reading the Shema 1:9"), jobs)
        self.assertIn(("follow", "Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"), jobs)

    def test_a_rishon_off_the_page_is_reached_through_the_rif(self):
        jobs = [job for job, _ in retrieve.plan(self.pack, 1, {"kind": "meaning", "names": ["Rabbeinu Yonah"]})]
        self.assertEqual(jobs, [("follow", "Rif Berakhot 1a:1", "Rabbeinu Yonah")])
        found, missed, _ = library.gather(jobs)
        self.assertEqual(found[0][0], "Rabbeinu Yonah")


class Library(unittest.TestCase):
    def test_the_mishnah_berurah_on_this_seif_only(self):
        got = library.follow("Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah")
        refs = [e["ref"] for _, e in got]
        self.assertEqual(refs[0], "Mishnah Berurah 235:1")
        self.assertEqual(len(refs), 15)          # not 233:5 or 90:32, which quote it
        self.assertTrue(all(r.startswith("Mishnah Berurah 235:") for r in refs))

    def test_the_rema_comes_inside_the_shulchan_arukh(self):
        self.assertIn("הגה", library.text("Shulchan Arukh, Orach Chayim 235:1")["he"])

    def test_names_as_people_say_them(self):
        self.assertEqual(library.name_of("Tur, Orach Chayim 235"), "Tur")
        self.assertEqual(library.name_of("Mishnah Berurah 235:4"), "Mishnah Berurah")
        self.assertEqual(library.name_of("Rabbeinu Yonah on Berakhot 1a:1"), "Rabbeinu Yonah")


class Partner(unittest.TestCase):
    pack = Pack(PACK)

    def test_whole_amud_in_view(self):
        ctx = partner.amud_context(self.pack)
        self.assertEqual(ctx.count("=== LINE"), 14)
        self.assertIn("[[Tosafot on Berakhot 2a:1:1]]", ctx)

    def test_never_correct_their_accent_but_ask_about_a_different_word(self):
        self.assertIn("never comment on how a word was pronounced", partner.CONSTITUTION)
        self.assertIn("never \"yes\" when it shows a swapped word", partner.CONSTITUTION)

    def test_a_mic_check_gets_a_few_words_and_no_thinking(self):
        fake_openai.STATE["log"].clear()
        text, verdict, history, trace = partner.Partner(self.pack, LLM()).ask(1, [], "can you hear me?")
        self.assertEqual(text, "Yes, I hear you.")
        self.assertTrue(trace["quick"])
        self.assertEqual([e["model"] for e in fake_openai.STATE["log"] if e["path"] == "chat"], ["gpt-5.6-luna"] * 2)

    def test_did_i_read_it_right_is_answered_from_what_was_heard(self):
        page = align.Page(PACK)
        said = "מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול מעשר עד סוף האשמורה השנייה"
        heard = align.listen(page, said)
        text, verdict, _, _ = partner.Partner(self.pack, LLM()).ask(
            1, [], "did I read it correctly?", recent=[{"said": said, "heard": heard}])
        self.assertIn("מעשר?", text)
        self.assertIn("בתרומתן", text)

    def test_a_halacha_question_goes_and_gets_the_codes(self):
        said_meanwhile = []
        text, verdict, _, trace = partner.Partner(self.pack, LLM()).ask(
            1, [], "was this codified in the Tur or Shulchan Aruch or the Rama?", announce=said_meanwhile.append)
        self.assertTrue(verdict.ok, text)
        self.assertIn("[[Tur, Orach Chayim 235]]", text)
        self.assertIn("Tur, Orach Chayim 235", trace["fetched"])
        self.assertIn("Shulchan Arukh, Orach Chayim 235:1", trace["fetched"])
        self.assertTrue(any(r.startswith("Mishnah Berurah 235:") for r in trace["fetched"]))
        self.assertIn("the Tur", said_meanwhile[0])

    def test_the_fallback_names_what_it_checked_and_passes_the_gate(self):
        entry = {"ref": "Tur, Orach Chayim 235", "he": "x"}
        text = partner.fallback([("Tur", entry)], "en")
        self.assertIn("the Tur [[Tur, Orach Chayim 235]]", text)
        self.assertTrue(ground.check(text, {"Tur, Orach Chayim 235"}).ok)
        self.assertNotIn("look it up", text)

    def test_the_nudge_waits_for_the_end_of_the_unit(self):
        self.assertIsNone(partner.unit_nudge(self.pack, {"line": 1}, "en", set()))
        text, ref, n = partner.unit_nudge(self.pack, {"line": 5}, "en", set())
        self.assertIn("Rashi", text)
        self.assertEqual(n, 1)
        self.assertIsNone(partner.unit_nudge(self.pack, {"line": 5}, "en", {(self.pack.ref, 1)}))

    def test_tosafot_voices_are_kept_apart(self):
        line = partner.argument_line(PACK["segments"][0]["commentaries"]["Tosafot"][0]["structure"])
        self.assertIn("position (by רש״י) -> difficulty x4 -> alternative (by ר״ת)", line)
        self.assertIn("alternative (by ר״י)", line)

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
    def test_short_quotes_are_spoken_and_citations_are_not(self):
        # In use the silenced quotes left "it begins … and ends …".
        said = speakable("Rashi [[Rashi on Berakhot 2a:1:2]] reads «עד סוף האשמורה» as a third of the night.")
        self.assertEqual(said, "Rashi reads עד סוף האשמורה as a third of the night.")

    def test_a_citation_used_as_a_word_leaves_no_hole(self):
        # In use: "we need the actual text at and and."
        said = speakable("We need the text at [[Tur, Orach Chayim 235]] and [[Shulchan Arukh, Orach Chayim 235:1]].")
        self.assertEqual(said, "We need the text at the Tur and the Shulchan Aruch.")

    def test_a_table_is_read_row_by_row(self):
        said = speakable("Three opinions.\n| Who | Holds |\n|---|---|\n| ר' אליעזר | «סוף האשמורה» [[Rashi on Berakhot 2a:1:2]] |\n| חכמים | עד חצות |\nSo the Rabbis are in the middle.")
        self.assertNotIn("|", said)
        self.assertNotIn("Who", said)
        self.assertIn("ר' אליעזר, סוף האשמורה.", said)
        self.assertIn("חכמים, עד חצות.", said)
        self.assertIn("in the middle", said)

    def test_a_long_stretch_of_gemara_is_not_read_back(self):
        page = align.Page(PACK)
        line = "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה"
        said = align.unspeak("So look: %s — that is his view." % line, page)
        self.assertNotIn("בתרומתן", said)
        self.assertIn("מאימתי קורין", said)          # the first words still point
        self.assertIn("that is his view", said)
        short = "he reads עד סוף האשמורה הראשונה as a third"
        self.assertEqual(align.unspeak(short, page), short)
        own = "רש״י אומר שזה שליש הלילה, ולכן חכמים חולקים עליו"
        self.assertEqual(align.unspeak(own, page), own)

    def test_effort_ladder_survives_a_refusal(self):
        fake_openai.STATE["log"].clear()
        LLM().say("x", [{"role": "user", "content": "y"}], heavy=False)
        efforts = [e["effort"] for e in fake_openai.STATE["log"] if e["path"] == "chat"]
        self.assertEqual(efforts[:2], ["none", "minimal"])


class Reading(unittest.TestCase):
    page = align.Page(PACK)

    def test_a_different_word_is_noticed(self):
        heard = align.listen(self.page, "מאימתי קורין את שמע בערבית משעה שהכהנים נכנסים לאכול מעשר "
                                        "עד סוף האשמורה השנייה")
        self.assertEqual(heard["mode"], "reading")
        self.assertEqual(heard["slips"]["swapped"], [["מעשר", "בתרומתן"], ["השנייה", "הראשונה"]])

    def test_how_they_say_it_is_not_noticed(self):
        heard = align.listen(self.page, "מאימתי קרינן את שמע בערבית משעה שהכהנים נכנסין לאכול בתרומתם "
                                        "עד סוף אשמורה הראשונה")
        self.assertNotIn("slips", heard)

    def test_words_that_are_not_on_the_page(self):
        heard = align.listen(self.page, "ממתי קוראים את שמע בערבית? משעה שנכנסים לאכול מעשר, "
                                        "באמצע הלילה אני אוהב לאכול תפוח.")
        self.assertIn("תפוח", heard["slips"]["after"])
        self.assertIn("שהכהנים", heard["slips"]["skipped"])

    def test_who_speaks_in_a_tosafot(self):
        struct = sugya.structure("x", PACK["segments"][0]["commentaries"]["Tosafot"][0]["he"])
        self.assertEqual([m["by"] for m in struct["moves"] if m["by"]], ["רש״י", "ר״ת", "ר״י"])


class SmallTalk(unittest.TestCase):
    def test_small_talk_is_answered_without_a_model(self):
        from chavruta import smalltalk
        self.assertEqual(smalltalk.reply("Hey, what's up?")[0], "hello")
        self.assertEqual(smalltalk.reply("Okay, so I'm gonna read, okay?")[0], "reading")
        self.assertEqual(smalltalk.reply("Can you hear me?")[0], "hear_me")
        self.assertIn(":", smalltalk.reply("What time is it?")[1])
        self.assertIn(smalltalk.reply("שומע אותי?", "he")[1], ["כן, שומע אותך.", "כאן, שומע."])

    def test_a_question_is_not_small_talk(self):
        from chavruta import smalltalk
        self.assertIsNone(smalltalk.reply("Hey, what's the summary here?"))
        self.assertIsNone(smalltalk.reply("Can you hear me? What does Rashi say?"))
        self.assertIsNone(smalltalk.reply("so he's saying you read shema whenever you go to sleep"))

    def test_a_question_around_a_reading_is_answered(self):
        page = align.Page(PACK)
        asked = align.listen(page, "Are you sure? Let me read it again. מאימתי קורין את שמע בערבית? "
                                   "משעה שהכהנים נכנסים לאכול בתרומתן.")
        self.assertEqual(asked["mode"], "quoting")
        plain = align.listen(page, "Okay, so I'm gonna read again. מאימתי קורין את שמע בערבית? "
                                   "משעה שהכהנים נכנסים לאכול בתרומתן.")
        self.assertEqual(plain["mode"], "reading")   # the page's own question is not theirs

    def test_chat_does_not_open_commentaries_at_any_depth(self):
        self.assertEqual(retrieve.extras(Pack(PACK), 1, {"kind": "other"}, "acharonim"), [])

    def test_every_model_call_is_on_a_short_leash(self):
        self.assertLessEqual(LLM.LEASH["hear"][0], 20)
        self.assertLessEqual(max(r for _, r in LLM.LEASH.values()), 1)


class Voice(unittest.TestCase):
    def test_it_knows_its_own_voice(self):
        from chavruta import server
        server.SPOKEN[:] = [set(server.word_list(
            "בערבין? I have «בערבין» here—the Mishnah opens with the evening Shema, and only later asks about the morning."))]
        # Heard back through the speakers, as in the third sitting.
        self.assertTrue(server.echo_of_itself(
            "בערבין. I have. בערבין. Here, the Mishnah opens with the evening Shema and only later asks about the morning."))
        self.assertFalse(server.echo_of_itself("so what does Rashi say about the first watch?"))

    def test_one_voice_never_a_substitute(self):
        import inspect
        from chavruta import llm
        self.assertNotIn("alloy", inspect.getsource(llm.LLM.speak_stream))
        self.assertNotIn("alloy", inspect.getsource(llm.LLM.speak))
        self.assertIn("never two speakers", llm.VOICE_DIRECTION)


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
