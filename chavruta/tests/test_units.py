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
                  CHAVRUTA_PACKS=tempfile.mkdtemp(), CHAVRUTA_ZMANIM_API=SEF_URL[:-4] + "/zmanim",
                  CHAVRUTA_WIKISOURCE_API=SEF_URL[:-4] + "/w/api.php",
                  CHAVRUTA_NOTES=os.path.join(tempfile.mkdtemp(), "notes.jsonl"),
                  CHAVRUTA_SESSIONS=tempfile.mkdtemp(),
                  CHAVRUTA_WEB_REWRITE='{"https://halachayomit.co.il": "%s/hy", "https://www.dafyomi.co.il": "%s/daf"}' % (SEF_URL[:-4], SEF_URL[:-4]))

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


class FourthSitting(unittest.TestCase):
    pack = Pack(PACK)

    def test_the_meiri_is_one_voice_not_the_default(self):
        got = retrieve.extras(self.pack, 1, {"kind": "meaning", "names": []}, "acharonim")
        names = [n for n, _ in got]
        self.assertLessEqual(len(got), 3)
        self.assertLessEqual(names.count("Meiri"), 1)
        halacha = [n for n, _ in retrieve.extras(self.pack, 1, {"kind": "halacha", "names": []}, "acharonim")]
        self.assertEqual(halacha.count("Meiri"), 1)

    def test_who_was_just_cited_goes_to_the_back(self):
        got = [n for n, _ in retrieve.extras(self.pack, 1, {"kind": "meaning", "names": [], "avoid": ["Meiri"]}, "rishonim")]
        self.assertNotIn("Meiri", got)

    def test_asking_it_to_answer_is_not_small_talk(self):
        from chavruta import smalltalk
        for said in ("So go ahead and answer.", "Answer the question I asked you.", "Yeah, so answer."):
            self.assertIsNone(smalltalk.reply(said), said)
        self.assertEqual(smalltalk.reply("What?")[0], "again")
        self.assertEqual(smalltalk.reply("No, I didn't hear you.")[0], "again")

    def test_a_name_reported_through_a_cited_source_is_covered(self):
        known = {"Tur, Orach Chayim 235"}
        text = "The Tur [[Tur, Orach Chayim 235]] brings Rashi's view against Rabbeinu Tam's defense."
        self.assertTrue(ground.check(text, known).ok)
        self.assertFalse(ground.check("Rashi says so. The Tur [[Tur, Orach Chayim 235]] agrees.", known).ok)

    def test_tonight_in_real_numbers(self):
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, {"kind": "halacha", "names": [],
                                                          "said": "give me numbers, summer and winter"})]
        self.assertEqual(sum(1 for j in jobs if j[0] == "zmanim"), 3)
        entry = library.zmanim("2026-09-28")
        self.assertIn("midnight (chatzot halayla): 2026-09-28 23:51", entry["he"])
        self.assertIn("dawn (alot hashachar): 2026-09-29 05:04", entry["he"])


class FifthRound(unittest.TestCase):
    pack = Pack(PACK)

    def test_when_did_he_live_uses_whoever_was_just_cited(self):
        jobs = [j for j, _ in retrieve.plan(self.pack, 4, {"kind": "people", "names": [],
                                                          "avoid": ["Meiri", "Rashba"]})]
        self.assertEqual(jobs, [("person", "Meiri", "Meiri on Berakhot", "Berakhot 2a"),
                                ("person", "Rashba", "Rashba on Berakhot", "Berakhot 2a")])
        found, missed, _ = library.gather(jobs)
        text = " ".join(e["he"] for _, e in found)
        self.assertIn("lived 1249–1315", text)
        self.assertIn("lived 1235–1310", text)
        self.assertIn("student of Ramban", text)

    def test_a_sage_off_the_page_is_found_by_name(self):
        entry = library.person("Rabban Gamliel")
        self.assertIn("tanna (sage of the Mishnah era), generation 3", entry["he"])
        self.assertIn("teachers: Rabban Yochanan ben Zakkai", entry["he"])
        self.assertIn("students: Rabbi Yehudah ben Ilai", entry["he"])

    def test_answer_it_finds_the_question(self):
        history = [{"role": "user", "content": "[note]\nHow come it's okay to pray Arvit before nightfall? What is the basis?"},
                   {"role": "assistant", "content": "..."},
                   {"role": "user", "content": "[note]\nWhat was my previous question?"},
                   {"role": "assistant", "content": "You asked why early Arvit is allowed."}]
        self.assertIn("pray Arvit before nightfall", partner.pending_question(history, "So go ahead and answer."))
        self.assertIsNone(partner.pending_question(history, "What does chatzot mean?"))

    def test_turns_are_short_by_default(self):
        self.assertIn("25-45 words", partner.SIZE["meaning"])
        self.assertIn("It is a conversation: short turns", partner.CONSTITUTION)


class Streaming(unittest.TestCase):
    pack = Pack(PACK)

    def test_an_answer_is_spoken_sentence_by_sentence(self):
        parts = []
        text, verdict, _, trace = partner.Partner(self.pack, LLM()).ask(
            1, [], "so he's saying you read shema whenever you go to sleep", on_part=parts.append)
        self.assertTrue(verdict.ok)
        self.assertEqual(len(parts), 2)
        self.assertEqual(" ".join(parts), text)
        self.assertEqual((trace["streamed"], trace["retried"], trace["unsaid"]), (2, False, ""))
        self.assertEqual(trace["effort"], "minimal")          # a meaning question thinks briefly

    def test_a_citation_after_the_full_stop_stays_with_its_sentence(self):
        p = partner.Partner(self.pack, LLM())
        p.llm = type("L", (), {"say_stream": lambda self_, *a, **k: iter(
            ["Rashi reads it as a third. ", "[[Rashi on Berakhot 2a:1:2]] ", "And that is all."])})()
        parts = []
        p.stream([], None, None, self.pack.refs(), parts.append)
        self.assertEqual(parts, ["Rashi reads it as a third. [[Rashi on Berakhot 2a:1:2]]", "And that is all."])

    def test_what_is_held_back_is_said_at_the_end(self):
        p = partner.Partner(self.pack, LLM())
        p.llm = type("L", (), {"say_stream": lambda self_, *a, **k: iter(
            ["The night has three watches. ", "Rashi says a third.\n", "Tosafot [[Tosafot on Berakhot 2a:1:1]] asks. ",
             "Rashi [[Rashi on Berakhot 2a:1:2]] answers."])})()
        parts = []
        text, spoken = p.stream([], None, None, self.pack.refs(), parts.append)
        self.assertEqual(parts, ["The night has three watches."])   # stops at the unsourced Rashi
        self.assertTrue(p.unsaid.startswith("Rashi says a third."))

    def test_speed_by_voice(self):
        from chavruta import smalltalk
        self.assertEqual(smalltalk.reply("Talk a bit faster please")[0], "faster")
        self.assertEqual(smalltalk.reply("תדבר יותר לאט")[0], "slower")
        self.assertIsNone(smalltalk.reply("why is he faster than the other"))
        self.assertEqual(smalltalk.reply("Okay, enough.")[0], "skip")
        self.assertEqual(smalltalk.reply("די")[0], "skip")


class SixthSitting(unittest.TestCase):
    pack = Pack(PACK)

    def test_sunset_in_a_named_place_is_fetched_not_guessed(self):
        self.assertEqual(library.place_in("Let's say in Tel Aviv."), "Tel Aviv")
        self.assertEqual(library.place_in("ומה בבני ברק?"), "Bnei Brak")
        self.assertIsNone(library.place_in("Rabbi Eliezer says until the first watch"))
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, {"kind": "other", "names": [],
                                                          "said": "How long till sunset?"})]
        self.assertEqual([j[0] for j in jobs], ["zmanim"])
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, {"kind": "other", "names": [], "place": "Tel Aviv",
                                                          "said": "Let's say in Tel Aviv."})]
        self.assertEqual(jobs[0][2], "Tel Aviv")
        found, missed, _ = library.gather(jobs)
        self.assertIn("Zmanim for Tel Aviv", found[0][1]["ref"])
        self.assertIn("sunset", found[0][1]["he"])

    def test_the_place_is_remembered(self):
        memory = {}
        p = partner.Partner(self.pack, LLM())
        p.ask(1, [], "Let's say in Tel Aviv.", route={"kind": "other", "names": []}, memory=memory)
        self.assertEqual(memory["place"], "Tel Aviv")
        self.assertIn("Zmanim for Tel Aviv", memory["fetched"][0][1]["ref"])

    def test_a_name_many_people_share_brings_all_of_them(self):
        entry = library.person("Rabban Gamliel")
        self.assertIn("Several people are called Rabban Gamliel", entry["he"])
        self.assertIn("Rabban Gamliel haZaken (I)", entry["he"])
        self.assertIn("Rabban Gamliel of Yavneh (II)", entry["he"])
        self.assertNotIn("Shimon", entry["he"])
        one = library.person("Rabbi Eliezer")
        self.assertNotIn("Several", one["he"])
        self.assertIn("Hyrcanus", one["he"])

    def test_sefaria_says_which_namesake_is_on_this_page(self):
        entry = library.person("Rabban Gamliel", page="Berakhot 2a")
        self.assertIn("Sefaria ties this page (Berakhot 2a:4-5)", entry["he"])
        self.assertIn("Yavneh", entry["he"])
        self.assertNotIn("haZaken", entry["he"])
        # On a page Sefaria ties to neither, both stay and the partner decides.
        self.assertIn("haZaken", library.person("Rabban Gamliel", page="Berakhot 40a")["he"])

    def test_an_empty_stub_is_not_a_person(self):
        self.assertIsNone(library._topic("rashba"))

    def test_what_was_fetched_a_turn_ago_is_still_citable(self):
        seen = []

        class Model:
            effort = None

            def say(self, system, messages, **k):
                seen.append(messages[-1]["content"])
                return "Rabban Gamliel [[About Rabban Gamliel]] led Yavneh."

        memory = {}
        p = partner.Partner(self.pack, LLM())
        p.llm = Model()
        p.ask(1, [], "when did Rabban Gamliel live?", route={"kind": "people", "names": ["Rabban Gamliel"]},
              memory=memory)
        _, verdict, _, trace = p.ask(1, [], "so which came first?", route={"kind": "other", "names": []},
                                     memory=memory)
        self.assertTrue(verdict.ok, trace.get("first_try"))
        self.assertIn("fetched earlier in this conversation", seen[-1])

    def test_lets_continue_is_not_answer_it(self):
        history = [{"role": "user", "content": "[note]\nHow about the time they lived, maybe it's chronological?"},
                   {"role": "assistant", "content": "No -- the order is not their ages. Rabban Gamliel was of "
                                                    "Yavneh and Rabbi Eliezer his contemporary and brother-in-law."}]
        self.assertIsNone(partner.pending_question(history, "Okay, so let's continue."))
        self.assertIsNone(partner.pending_question(history, "continue"))
        stub = history[:1] + [{"role": "assistant", "content": "Good question."}]
        self.assertIn("time they lived", partner.pending_question(stub, "continue"))
        self.assertIn("time they lived", partner.pending_question(history, "you didn't answer my question"))

    def test_um_and_okay_get_no_reply(self):
        from chavruta import smalltalk
        self.assertEqual(smalltalk.reply("Um."), ("filler", ""))
        self.assertEqual(smalltalk.reply("Okay."), ("filler", ""))
        self.assertEqual(smalltalk.reply("אוקיי"), ("filler", ""))
        self.assertIsNone(smalltalk.reply("Okay.", asked=True))          # a yes to "want it?"
        self.assertIsNone(smalltalk.reply("Go ahead.", asked=True))
        self.assertEqual(smalltalk.reply("Okay, so let's continue.")[0], "reading")
        self.assertEqual(smalltalk.reply("Can you hear me?")[0], "hear_me")
        self.assertIsNone(smalltalk.reply("Okay, now I have a different question."))

    def test_saying_there_is_no_tosafot_needs_no_citation(self):
        known = self.pack.refs()
        self.assertTrue(ground.check("Right -- no Tosafot here.", known).ok)
        self.assertFalse(ground.check("Tosafot says it is the synagogue Shema.", known).ok)

    def test_rashi_reported_inside_the_tosafot_that_quotes_him(self):
        known = self.pack.refs()
        p = partner.Partner(self.pack, LLM())
        text = ("Tosafot challenges Rashi: then people should say all three paragraphs at bedtime. "
                "Rabbeinu Tam says the synagogue Shema is primary. [[Tosafot on Berakhot 2a:1:1]]")
        self.assertFalse(ground.check(text, known).ok)
        self.assertTrue(ground.check(text, known, p.texts).ok)
        # ...but not across a paragraph.
        self.assertFalse(ground.check("Rashi says it is bedtime.\n\nTosafot [[Tosafot on Berakhot 2a:1:1]] asks.",
                                      known, p.texts).ok)

    def test_a_sentence_waits_for_the_citation_at_the_end_of_its_paragraph(self):
        p = partner.Partner(self.pack, LLM())
        p.llm = type("L", (), {"say_stream": lambda self_, *a, **k: iter(
            ["Tosafot challenges Rashi: why only one paragraph at bedtime? ",
             "Rabbeinu Tam says the synagogue Shema is primary. ", "[[Tosafot on Berakhot 2a:1:1]]"])})()
        parts = []
        text, spoken = p.stream([], None, None, self.pack.refs(), parts.append, p.texts)
        self.assertEqual(len(parts), 1)
        self.assertEqual(p.unsaid, "")

    def test_what_we_have_not_come_to_yet(self):
        note = partner.covered_note(self.pack, 5, [
            {"role": "assistant", "content": "Rashi [[Rashi on Berakhot 2a:1:2]] says a third."}])
        self.assertIn("Rashi on Berakhot 2a:1:2]] (cited in this conversation)", note)
        self.assertIn("Tosafot on Berakhot 2a:1:1]] (not cited yet)", note)
        self.assertTrue(partner.SO_FAR.search("is there a Rashi or Tosfot until now that we didn't read?"))

    def test_read_it_for_me(self):
        self.assertTrue(partner.READ_TO_ME.search("Can you read it for me?"))
        self.assertTrue(partner.READ_TO_ME.search("תקרא לי את השורה"))
        self.assertFalse(partner.READ_TO_ME.search("I'm gonna read the Mishnah"))


class TheirQuestion(unittest.TestCase):
    """The learner asks what a commentator asks: say whose it is, and offer to read it or tell it."""
    pack = Pack(PACK)
    TZELACH = "Tziyyun LeNefesh Chayyah on Berakhot 2a:6"

    def test_every_commentary_near_the_line_is_scanned_for_its_question(self):
        asked = retrieve.asked_here(self.pack, 1)
        refs = [e["ref"] for _, e, _ in asked]
        self.assertIn(self.TZELACH, refs)
        q = next(q for _, e, q in asked if e["ref"] == self.TZELACH)
        self.assertIn("למה הוצרך לומר הכהנים", q)
        self.assertNotIn("Steinsaltz", {name for name, _, _ in asked})
        # The gemara's own question, quoted, is not the commentator's.
        self.assertFalse(retrieve.ASKS.search("אם כן למה קורין אותה בבית הכנסת"))
        # Nor is the name of a Tosafot: "בתד"ה קשיא".
        rashash = next(q for _, e, q in asked if e["ref"] == "Rashash on Berakhot 2a:1")
        self.assertIn('ק"ל דמאי יענה', rashash)

    def test_it_offers_then_does_what_they_chose(self):
        seen = []
        answers = iter([
            "That's a real question -- it's the Tzelach's [[%s]]. Read it together, or the gist?" % self.TZELACH,
            "«לכאורה יש לדקדק למה הוצרך לומר הכהנים» -- he asks why the priests are named [[%s]]. "
            "What do you make of it?" % self.TZELACH])

        class Model:
            effort = None

            def say(self, system, messages, **k):
                seen.append(messages[-1]["content"])
                return next(answers)

        memory = {}
        p = partner.Partner(self.pack, LLM())
        p.llm = Model()
        _, verdict, history, trace = p.ask(1, [], "why does the mishna need to say the priests at all?",
                                           route={"kind": "meaning", "names": []}, memory=memory)
        self.assertTrue(verdict.ok)
        self.assertIn("questions the commentaries around this line raise", seen[-1])
        self.assertEqual(trace["offered"], [self.TZELACH])
        self.assertEqual(partner.offer_choice(memory["offered"], "let's read it together"), "read")
        self.assertEqual(partner.offer_choice(memory["offered"], "just give me the gist"), "gist")
        self.assertEqual(partner.offer_choice(memory["offered"], "no need to read it, just tell me"), "gist")
        self.assertEqual(partner.offer_choice(memory["offered"], "בוא נקרא ביחד"), "read")
        self.assertEqual(partner.offer_choice(memory["offered"], "yes please"), "yes")
        self.assertIsNone(partner.offer_choice(memory["offered"], "what does Rashi say about midnight?"))
        _, verdict, _, trace = p.ask(1, history, "let's read it together", route={"kind": "other", "names": []},
                                     memory=memory)
        self.assertTrue(verdict.ok)
        self.assertEqual(trace["chose"], "read")
        self.assertIn("chose to read it together", seen[-1])
        self.assertIn("[[%s]] Tzelach" % self.TZELACH, seen[-1])       # the whole comment, opened
        self.assertNotIn("offered", memory)                              # asked once, answered once

    def test_the_desk_by_voice(self):
        from chavruta import server
        cmd = lambda said, lang="auto": server.desk_command(said, self.pack, lang)
        self.assertEqual(cmd("put the Rashba on the side")["add"], ["Rashba"])
        self.assertEqual(cmd("can you open the Meiri and the Tzelach on the screen")["add"], ["Meiri", "Tzelach"])
        got = cmd('תשים את המאירי ואת הצל"ח על המסך')
        self.assertEqual(got["add"], ["Meiri", "Tzelach"])
        self.assertEqual(got["text"], 'פתחתי את המאירי והצל"ח בצד.')
        self.assertEqual(cmd('תוסיף את הרש"ש לשולחן')["add"], ["Rashash"])
        self.assertTrue(cmd("close the desk")["close"])
        self.assertIsNone(cmd("open the Rashba"))                 # a question about him, not the desk
        self.assertIsNone(cmd("put the Ramban on the side"))      # not on this page

    def test_no_offer_when_it_just_answers(self):
        memory = {}
        p = partner.Partner(self.pack, LLM())
        p.llm = type("M", (), {"effort": None, "say": lambda self_, s, m, **k: "Rashi [[Rashi on Berakhot 2a:1:1]] "
                               "reads it as the evening."})()
        _, _, _, trace = p.ask(1, [], "what does the evening mean here?", route={"kind": "meaning", "names": []},
                               memory=memory)
        self.assertEqual(trace["offered"], [])
        self.assertNotIn("offered", memory)


class Shelf(unittest.TestCase):
    """The map of the sources: which kind of work answers which kind of question."""
    pack = Pack(PACK)

    def near(self, kind, n, names=()):
        return [name for name, _ in retrieve.extras(self.pack, n, {"kind": kind, "names": list(names)}, "daf")]

    def test_a_question_on_tosafot_goes_to_its_explainers(self):
        got = self.near("on_commentary", 1, ["Tosafot"])
        self.assertTrue(got)
        self.assertTrue(set(got) <= {"Tosafot HaRosh", "Gilyon HaShas", "Penei Yehoshua",
                                     "Chiddushei Rabbi Akiva Eiger", "Chidushei Halachot"}, got)

    def test_a_contradiction_goes_to_rabbi_akiva_eiger_first(self):
        got = self.near("conflict", 1)
        self.assertIn(got[0], ("Gilyon HaShas", "Chiddushei Rabbi Akiva Eiger", "Penei Yehoshua", "Petach Einayim"))
        self.assertLessEqual(len(got), 3)

    def test_why_goes_to_the_catalonians(self):
        got = self.near("logic", 1)
        self.assertTrue(set(got) & {"Rashba", "Ritva", "Ra'ah"}, got)

    def test_aggadah_has_its_own_ladder(self):
        self.assertIn("aggadah", retrieve.KINDS)
        n = next(s["n"] for s in self.pack.segments if s["commentaries"].get("Ben Yehoyada"))
        self.assertIn("Ben Yehoyada", self.near("aggadah", n))

    def test_the_maharsha_is_found_under_the_name_sefaria_files_him(self):
        pack = Pack(sefaria.build("Berakhot 2b"))
        n = next(s["n"] for s in pack.segments if s["commentaries"].get("Chidushei Halachot"))
        got = retrieve.extras(pack, n, {"kind": "on_commentary", "names": ["Maharsha"]}, "daf")
        self.assertIn("Chidushei Halachot", [name for name, _ in got])

    def test_on_berakhot_halacha_brings_rabbeinu_yonah(self):
        jobs = [job for job, _ in retrieve.plan(self.pack, 1, {"kind": "halacha", "names": []})]
        self.assertIn(("follow", "Rif Berakhot 1a:1", "Rabbeinu Yonah"), jobs)

    def test_the_meiri_is_an_overview_not_a_posek(self):
        from chavruta import commentators as who
        self.assertNotIn("halacha", who.WHO["Meiri"]["answers"])
        self.assertIn("light as an authority", who.WHO["Meiri"]["specialty"])


class Table(unittest.TestCase):
    """Settings: who the learner seats at the table, and how many voices a turn opens."""
    pack = Pack(PACK)

    def route(self, kind, favor=None, voices=3, names=()):
        from chavruta import commentators as who
        prefer, mute = who.seats(favor or {})
        return {"kind": kind, "names": list(names), "prefer": prefer, "mute": mute, "voices": voices}

    def test_a_favourite_comes_when_he_has_something_here(self):
        got = [n for n, _ in retrieve.extras(self.pack, 1, self.route("meaning", {"Ritva": 1}), "daf")]
        self.assertIn("Ritva", got)

    def test_one_left_out_stays_out_unless_named(self):
        got = [n for n, _ in retrieve.extras(self.pack, 1, self.route("structure", {"Meiri": -1}), "rishonim")]
        self.assertNotIn("Meiri", got)
        got = [n for n, _ in retrieve.extras(self.pack, 1, self.route("structure", {"Meiri": -1}, names=["Meiri"]),
                                             "rishonim")]
        self.assertIn("Meiri", got)

    def test_voices_caps_what_opens_unasked(self):
        got = retrieve.extras(self.pack, 1, self.route("logic", voices=1), "acharonim")
        self.assertEqual(len(got), 1)

    def test_codes_follow_the_table(self):
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, self.route(
            "halacha", {"Mishnah Berurah": -1, "Magen Avraham": 1, "Rambam": -1}))]
        self.assertNotIn(("follow", "Shulchan Arukh, Orach Chayim 235:1", "Mishnah Berurah"), jobs)
        self.assertIn(("follow", "Shulchan Arukh, Orach Chayim 235:1", "Magen Avraham"), jobs)
        self.assertFalse(any(j[0] == "text" and j[1].startswith("Mishneh Torah") for j in jobs))

    def test_the_whole_halachic_shelf_is_reachable(self):
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, self.route(
            "halacha", {"Kessef Mishneh": 1, "Darkhei Moshe": 1, "Peri Megadim": 1, "Arukh HaShulchan": 1}))]
        self.assertIn(("follow", "Mishneh Torah, Reading the Shema 1:9", "Kessef Mishneh"), jobs)
        self.assertIn(("follow", "Tur, Orach Chayim 235", "Darkhei Moshe"), jobs)
        self.assertIn(("follow", "Shulchan Arukh, Orach Chayim 235:1", "Peri Megadim"), jobs)
        self.assertIn(("text", "Arukh HaShulchan, Orach Chaim 235"), jobs)
        # Named, not seated: "what does the Raavad say?" reaches him too.
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, self.route("meaning", names=["Raavad"]))]
        self.assertIn(("follow", "Mishneh Torah, Reading the Shema 1:9", "Hasagot HaRaavad"), jobs)

    def test_sefarias_other_names_are_matched(self):
        from chavruta import commentators as who
        self.assertEqual(who.filed("Maharshal", {"Chokhmat Shlomo"}), ["Chokhmat Shlomo"])
        self.assertEqual(who.filed("Tzelach", {"Tziyyun LeNefesh Chayyah"}), ["Tziyyun LeNefesh Chayyah"])
        self.assertIn("the Ritva", who.note_for("Berakhot"))

    def test_the_partner_is_told(self):
        seen = []

        class Model:
            effort = None

            def say(self, system, messages, **k):
                seen.append(messages[-1]["content"])
                return "The gemara says so."

        p = partner.Partner(self.pack, LLM(), favor={"Ritva": 1, "Meiri": -1})
        p.llm = Model()
        p.ask(1, [], "what does this mean?", route={"kind": "meaning", "names": []})
        self.assertIn("they like to hear from Ritva", seen[0])
        self.assertIn("leave out Meiri", seen[0])


class Review(unittest.TestCase):
    """Coming back after a while: what we learned, and questions on it."""

    def setUp(self):
        from chavruta import review
        review.LOAD = lambda ref: Pack(sefaria.build(ref))
        review.SESSIONS_DIR = tempfile.mkdtemp()
        self.review = review

    def write(self, date, rows):
        import json
        with open(os.path.join(self.review.SESSIONS_DIR, date + ".jsonl"), "w") as f:
            for row in rows:
                f.write(json.dumps(row) + "\n")

    def test_the_last_n_pages_before_this_one(self):
        pages = self.review.which_pages
        self.assertEqual(pages("Berakhot 6a", "what were the last two pages about?", [], "2026-09-28"),
                         ["Berakhot 4a", "Berakhot 4b", "Berakhot 5a", "Berakhot 5b"])
        self.assertEqual(len(pages("Berakhot 6a", "remind me of the last six pages", [], "2026-09-28")), 8)
        self.assertEqual(pages("Berakhot 6a", "the last three amudim", [], "2026-09-28"),
                         ["Berakhot 4b", "Berakhot 5a", "Berakhot 5b"])
        self.assertEqual(pages("Berakhot 30a", "תזכיר לי את שלושת הדפים האחרונים", [], "2026-09-28")[0],
                         "Berakhot 27a")
        self.assertEqual(len(pages("Berakhot 40a", "the last twenty pages", [], "2026-09-28")), 12)   # capped

    def test_last_time_comes_from_the_sittings(self):
        self.write("2026-09-27", [{"kind": "heard", "ref": "Berakhot 4b"}, {"kind": "answer", "ref": "Berakhot 5a"},
                                  {"kind": "heard", "ref": "Berakhot 4b"}])
        self.write("2026-09-28", [{"kind": "heard", "ref": "Berakhot 6a"}])
        history = self.review.sittings()
        self.assertEqual(history[0], {"date": "2026-09-28", "refs": ["Berakhot 6a"]})
        self.assertEqual(self.review.which_pages("Berakhot 6a", "what did we learn yesterday?", history, "2026-09-28"),
                         ["Berakhot 4b", "Berakhot 5a"])

    def test_each_amud_is_recapped_once_and_kept(self):
        entry = self.review.recap("Berakhot 2a")
        self.assertIn("evening Shema", entry["he"])
        self.assertTrue(os.path.exists(self.review._path("Berakhot 2a")))
        self.assertTrue(library.cached(("recap", "Berakhot 2a")))

    def test_the_review_is_told_page_by_page_and_cited(self):
        p = partner.Partner(Pack(sefaria.build("Berakhot 2b")), LLM())
        text, verdict, _, trace = p.ask(1, [], "remind me what the last page was about",
                                        route={"kind": "review", "names": []})
        self.assertTrue(verdict.ok, text)
        self.assertIn("[[Berakhot 2a]]", text)
        self.assertEqual(trace["fetched"], ["Berakhot 2a", "D.A.F. outline: Berakhot 2"])

    def on_disk(self):
        self.review.ON_DISK = lambda ref: Pack(sefaria.build(ref)) if ref in ("Berakhot 2a", "Berakhot 2b") else None

    def test_did_we_learn_this_word(self):
        self.on_disk()
        learned = [{"date": "2026-09-27", "refs": ["Berakhot 2a"]}]
        hits = self.review.find_words(self.review.terms("did we already see «הקטר חלבים»?"), "Berakhot 2b", learned)
        self.assertEqual(hits[0][0], "Berakhot 2a:5")
        self.assertEqual(hits[0][2], ["2026-09-27"])
        self.assertEqual(self.review.find_words(["מילהשלאקיימת"], "Berakhot 2b", learned), [])

    def test_where_the_page_itself_points(self):
        found = self.review.parallels(Pack(PACK), 5, [{"date": "2026-09-20", "refs": ["Berakhot 9a"]}])
        self.assertIn(("Berakhot 9a:10", ["2026-09-20"]), found)
        self.assertTrue(all(not r.startswith(("Leviticus", "Mishnah")) for r, _ in found))   # the Bavli only

    def test_the_mishna_pages_back(self):
        mishna = self.review.find_mishna("Berakhot 2b", 5, lambda ref: Pack(sefaria.build(ref)))
        self.assertEqual(mishna["ref"], "Berakhot 2a:1-5")
        self.assertIn("Rabban Gamliel says", mishna["he"])
        self.assertEqual(mishna["amud"], "Berakhot 2a")

    def test_did_we_learn_this_is_answered_from_what_was_learned(self):
        self.on_disk()
        self.write("2026-09-27", [{"kind": "heard", "ref": "Berakhot 2a"}])
        p = partner.Partner(Pack(sefaria.build("Berakhot 2b")), LLM())
        _, verdict, _, trace = p.ask(5, [], "did we learn «הקטר חלבים» yesterday?",
                                     route={"kind": "recall", "names": []})
        self.assertIn("Berakhot 2a:5", trace["fetched"])
        self.assertIn("Berakhot 2a", trace["fetched"])          # its recap

    def test_remind_me_of_the_mishna(self):
        p = partner.Partner(Pack(sefaria.build("Berakhot 2b")), LLM())
        _, verdict, _, trace = p.ask(5, [], "remind me what the mishna was", route={"kind": "review", "names": []})
        self.assertEqual(trace["fetched"][:2], ["Berakhot 2a:1-5", "Berakhot 2a"])

    def test_questions_one_at_a_time(self):
        self.assertIn("one question", partner.SIZE["quiz"])
        self.assertIn("quiz", retrieve.KINDS)
        self.assertEqual(retrieve.extras(Pack(PACK), 1, {"kind": "quiz", "names": []}, "acharonim"), [])


class LearningAlong(unittest.TestCase):
    """Reading onto the next page, notes, progress, the phone link."""

    def test_reading_on_turns_the_page(self):
        from chavruta import server
        importlib.reload(server)
        two_a, two_b = server.load_pack("Berakhot 2a"), server.load_pack("Berakhot 2b")
        said = "דילמא ביאת אורו הוא ומאי וטהר טהר גברא"
        heard = align.listen(server.page_of(two_a), said)
        turned = server.onto_next_page(two_a, said, heard, 13)
        self.assertEqual(turned[0], "Berakhot 2b")
        self.assertEqual((turned[1]["mode"], turned[1]["line"]), ("reading", 1))
        # Across the break in one breath: the end of 2a, then the start of 2b.
        across = "וממאי דהאי ובא השמש ביאת השמש והאי וטהר טהר יומא דילמא ביאת אורו הוא ומאי וטהר טהר גברא"
        heard = align.listen(server.page_of(two_a), across)
        self.assertEqual((server.onto_next_page(two_a, across, heard, 14) or [None])[0], "Berakhot 2b")
        # Not from the middle of the page.
        middle = "אמר רבה בר רב שילא אם כן לימא קרא ויטהר"
        self.assertIsNone(server.onto_next_page(two_a, middle, align.listen(server.page_of(two_a), middle), 4))
        self.assertEqual(server.onto_next_page(two_a, middle, align.listen(server.page_of(two_a), middle), 14)[0],
                         "Berakhot 2b")

    def test_notes_by_voice(self):
        from chavruta import notes
        self.assertEqual(notes.taken("Note: Rashi reads it as a third of the night"), "Rashi reads it as a third of the night")
        self.assertEqual(notes.taken("save this"), "")
        self.assertEqual(notes.taken("תרשום: רבן גמליאל חולק"), "רבן גמליאל חולק")
        self.assertIsNone(notes.taken("Notes are important here, why?"))
        self.assertTrue(notes.ASK.search("what did I note on this page?"))
        notes.add("Berakhot 2a", 5, "the fence is for Shema, not the fats")
        notes.add("Berakhot 3b", 2, "David's harp")
        self.assertEqual([n["line"] for n in notes.on(ref="Berakhot 2a")], [5])
        self.assertEqual(len(notes.on(masechta="Berakhot")), 2)
        self.assertIn("line 5: the fence", notes.spoken(notes.on(ref="Berakhot 2a"), "en", here="Berakhot 2a"))

    def test_progress(self):
        import datetime
        from chavruta import daily
        today = datetime.date(2026, 9, 28)
        sittings = [{"date": "2026-09-28", "refs": ["Berakhot 2a", "Berakhot 2b"]},
                    {"date": "2026-09-27", "refs": ["Berakhot 3a"]},
                    {"date": "2026-09-25", "refs": ["Berakhot 3b"]}]
        p = daily.progress(sittings, today, ["Shabbat"])
        self.assertEqual(p["streak"], 2)                          # the 25th is not in a row
        self.assertEqual(p["daf_yomi"]["done"], True)             # the fake calendar's daf is Berakhot 2
        self.assertEqual({t["name"]: (t["done"], t["total"]) for t in p["tractates"]},
                         {"Berakhot": (4, 125), "Shabbat": (0, 312)})
        from chavruta import server
        self.assertIn("2 days in a row", server.progress_text(p, "en"))

    def test_the_phone_link_has_a_key_and_a_certificate(self):
        from chavruta import phone
        phone.DIR = tempfile.mkdtemp()
        key = phone.key()
        self.assertGreaterEqual(len(key), 20)
        self.assertEqual(phone.key(), key)                        # kept, not remade
        cert, private = phone.certificate("192.168.1.5")
        with open(cert) as handle:
            self.assertIn("BEGIN CERTIFICATE", handle.read())
        self.assertEqual(oct(os.stat(private).st_mode)[-3:], "600")


class VoiceSettings(unittest.TestCase):
    def test_only_real_settings_get_through(self):
        got = retrieve.settings_changes([
            {"name": "rate", "value": "faster"}, {"name": "language", "value": "fr"},
            {"name": "favor", "value": {"name": "meiri", "value": -1}},
            {"name": "mine", "value": {"masechta": "Shabbat"}}, {"name": "api_key", "value": "x"},
            {"name": "voices", "value": 9}])
        self.assertEqual(got, [{"name": "rate", "value": "faster"},
                               {"name": "favor", "value": {"name": "Meiri", "value": -1}},
                               {"name": "mine", "value": {"masechta": "Shabbat", "add": True}},
                               {"name": "voices", "value": 5}])

    def test_the_router_hands_over_the_changes(self):
        route = retrieve.classify(LLM(), "answer in Hebrew from now on and leave out the Meiri")
        self.assertEqual(route["kind"], "settings")
        self.assertEqual([c["name"] for c in route["settings"]], ["language", "favor"])

    def test_speed_however_it_is_said(self):
        from chavruta import smalltalk
        for said in ("Can you talk a little bit faster?", "go faster", "תדבר קצת יותר מהר בבקשה"):
            self.assertEqual(smalltalk.reply(said)[0], "faster", said)
        self.assertEqual(smalltalk.reply("what can I say?")[0], "help")

    def test_what_they_ask_now_beats_the_settings(self):
        self.assertIn("What they ask for now beats every setting", partner.CONSTITUTION)
        self.assertIn("ראשי תיבות", partner.CONSTITUTION)
        self.assertNotIn("Sefaria", partner.sources_note([], [("Tur", {"ref": "Tur, Orach Chayim 235", "he": "x"})]))


class TrustedSites(unittest.TestCase):
    pack = Pack(PACK)

    def test_only_domains_are_trusted(self):
        from chavruta import web
        self.assertEqual(web.clean_sites(["https://www.halachayomit.co.il/he/", "he.wikisource.org",
                                          "javascript:alert(1)", "not a site"]),
                         ["halachayomit.co.il", "he.wikisource.org"])

    def test_a_page_is_read_for_its_text_not_its_menus(self):
        from chavruta import web
        entry = web.page("https://halachayomit.co.il/he/ReadHalacha.aspx?HalachaID=4521", "halachayomit.co.il")
        self.assertEqual(entry["ref"], "Halacha Yomit: זמן קריאת שמע של ערבית")
        self.assertIn("עד עלות השחר", entry["he"])
        self.assertNotIn("תפריט", entry["he"])
        self.assertNotIn("var x", entry["he"])
        self.assertEqual(library.text(entry["ref"])["url"], entry["url"])     # opens in the panel

    def test_rav_ovadia_is_looked_up_on_halacha_yomit(self):
        route = {"kind": "halacha", "names": [], "said": "What does Rav Ovadia say about this?",
                 "sites": ["halachayomit.co.il", "he.wikisource.org"]}
        jobs = [j for j, _ in retrieve.plan(self.pack, 1, route)]
        site = [j for j in jobs if j[0] == "site"]
        self.assertEqual(site[0][1], "halachayomit.co.il")
        self.assertIn("שולחן ערוך אורח חיים סימן 235", site[0][2])
        found, missed, _ = library.gather(site)
        self.assertEqual(found[0][0], "Halacha Yomit")
        self.assertIn("עובדיה יוסף", found[0][1]["he"])

    def test_not_trusted_not_searched(self):
        route = {"kind": "halacha", "names": [], "said": "What does Rav Ovadia say?", "sites": ["he.wikisource.org"]}
        self.assertFalse([j for j, _ in retrieve.plan(self.pack, 1, route) if j[0] == "site"])

    def test_the_shaar_hatziyun_is_found_on_wikisource(self):
        route = {"kind": "halacha", "names": [], "said": "and the Sha'ar HaTziyun?",
                 "sites": ["he.wikisource.org"]}
        wiki = [j for j, _ in retrieve.plan(self.pack, 1, route) if j[0] == "wiki"]
        self.assertEqual(wiki, [("wiki", "שער הציון רלה")])
        found, _, _ = library.gather(wiki)
        self.assertEqual(found[0][1]["ref"], "Wikisource: שער הציון/רלה")

    def test_the_daf_outline_of_any_page(self):
        from chavruta import web
        entry = web.outline("Berakhot", 2, lambda q, d: [])
        self.assertEqual(entry["ref"], "D.A.F. outline: Berakhot 2")
        self.assertIn("THE TIME FOR THE EVENING SHEMA", entry["he"])
        self.assertNotIn("Home | Daf Yomi", entry["he"])                       # not the menu
        self.assertTrue(entry["url"].endswith("/berachos/points/br-ps-002.htm"))

    def test_a_tractate_not_listed_is_learned_once(self):
        from chavruta import web
        asked = []
        find = lambda q, d: asked.append(q) or [("https://www.dafyomi.co.il/shabbos/points/sh-ps-002.htm", "")]
        self.assertTrue(web.outline("Shabbat", 31, find)["url"].endswith("/shabbos/points/sh-ps-031.htm"))
        self.assertEqual(web.outline("Shabbat", 32, find)["ref"], "D.A.F. outline: Shabbat 32")
        self.assertEqual(len(asked), 1)                                        # searched once, then known

    def test_rav_ovadia_only_through_the_site(self):
        known = {"Halacha Yomit: זמן קריאת שמע של ערבית"}
        self.assertFalse(ground.check("Rav Ovadia rules until dawn.", known).ok)
        self.assertTrue(ground.check("Rav Ovadia [[Halacha Yomit: זמן קריאת שמע של ערבית]] rules until dawn.",
                                     known).ok)

    def test_the_answer_quotes_the_site(self):
        p = partner.Partner(self.pack, LLM(), sites=["halachayomit.co.il"], sites_halacha=True)
        text, verdict, _, trace = p.ask(1, [], "what's the halacha, and what does Rav Ovadia hold?",
                                        route={"kind": "halacha", "names": []})
        self.assertTrue(verdict.ok, text)
        self.assertIn("Halacha Yomit", text)
        self.assertIn("Halacha Yomit: זמן קריאת שמע של ערבית", trace["fetched"])


class CuttingIn(unittest.TestCase):
    """Spoken over an answer still being said: an aside, a correction, a new question, or for later."""
    CUT = {"asked": "was this codified in the Tur?", "said": "The Tur brings the Rosh", "unsaid": "and the Beit Yosef"}

    def judged(self, said, model=None):
        class Model:
            def json(self, system, messages, heavy=False):
                assert "cut_in" in system and messages[-1]["content"].startswith("[you were answering")
                return dict({"kind": "meaning"}, **(model or {}))
        return retrieve.classify(Model(), said, self.CUT)["cut_in"]

    def test_the_plain_cases_need_no_judgment(self):
        self.assertEqual(self.judged("no, I mean in the Rambam", {"cut_in": "new"}), "merge")
        self.assertEqual(self.judged("לא, התכוונתי לרמב״ם"), "merge")
        self.assertEqual(self.judged("and what about the Rama?"), "merge")
        self.assertEqual(self.judged("let's come back to that later", {"cut_in": "aside"}), "later")
        self.assertEqual(self.judged("נחזור לזה אחר כך"), "later")

    def test_the_rest_is_the_models_call_and_short_means_an_aside(self):
        self.assertEqual(self.judged("who was Rabban Gamliel?", {"cut_in": "new"}), "new")
        self.assertEqual(self.judged("wait, what does chatzot mean?"), "aside")
        self.assertEqual(self.judged("so I have a completely separate thing I have been wondering about the "
                                     "structure of the whole tractate and its order"), "new")

    def test_no_cut_no_judgment(self):
        class Model:
            def json(self, system, messages, heavy=False):
                assert "cut_in" not in system
                return {"kind": "meaning"}
        self.assertIsNone(retrieve.classify(Model(), "what does chatzot mean?")["cut_in"])

    def test_the_partner_is_told_how_far_it_got(self):
        seen = []
        p = partner.Partner(Pack(PACK), LLM())
        p.llm = type("M", (), {"effort": None, "say": lambda self_, s, m, **k: seen.append(m[-1]["content"]) or
                               "Midnight [[Rashi on Berakhot 2a:1:1]]."})()
        p.ask(1, [], "what does chatzot mean?", route={"kind": "meaning", "names": []},
              cut=dict(self.CUT, kind="aside"))
        self.assertIn("quick aside", seen[-1])
        self.assertIn("The Tur brings the Rosh", seen[-1])
        self.assertIn("one or two sentences", seen[-1])
        p.ask(1, [], "no, I mean in the Rambam", route={"kind": "meaning", "names": []},
              cut=dict(self.CUT, kind="merge"))
        self.assertIn("did not hear: «and the Beit Yosef»", seen[-1])


class Server(unittest.TestCase):
    def test_all_of_shas_and_nothing_else(self):
        from chavruta import server
        self.assertTrue(server.allowed("Berakhot 64a"))
        self.assertFalse(server.allowed("Berakhot 64b"))
        self.assertTrue(server.allowed("Shabbat 2a"))
        self.assertTrue(server.allowed("Bava Batra 176b"))
        self.assertFalse(server.allowed("Shabbat 158a"))
        self.assertTrue(server.allowed("Tamid 25b"))
        self.assertFalse(server.allowed("Tamid 25a"))       # Tamid opens on 25b
        self.assertFalse(server.allowed("Nazir 33b"))       # Sefaria has no 33b
        self.assertFalse(server.allowed("../../etc/passwd"))
        self.assertEqual(len(sefaria.amudim("Shabbat")), 312)

    def test_todays_daf(self):
        import datetime
        from chavruta import daily
        found = daily.daf_yomi(datetime.date(2026, 9, 28))
        self.assertEqual(found["ref"], "Berakhot 2")
        self.assertEqual(found["amudim"], ["Berakhot 2a", "Berakhot 2b"])
        self.assertEqual(found["he"], "ברכות ב׳")

    def test_preparing_a_tractate_builds_what_is_missing(self):
        import threading
        from chavruta import daily
        built, done = [], threading.Event()
        have = {"Horayot 2a", "Horayot 2b"}
        p = daily.Preparer(build=lambda ref: (built.append(ref), have.add(ref)), exists=lambda ref: ref in have,
                           finish=lambda m: done.set(), pause=0)
        self.assertTrue(p.start("Horayot"))
        self.assertTrue(done.wait(5))
        self.assertNotIn("Horayot 2a", built)
        self.assertEqual(built[0], "Horayot 3a")
        s = p.status("Horayot")
        self.assertEqual((s["done"], s["total"]), (25, 25))
        self.assertFalse(p.start("Shekalim"))                 # not on Sefaria's Bavli

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
