# -*- coding: utf-8 -*-
"""End to end: a browser, a microphone, the app, and stand-ins for Sefaria and OpenAI.

The microphone is Chromium's fake capture device playing a file of speech-like
bursts, so the whole voice loop runs for real -- detecting speech, recording,
posting, following the reading, answering aloud -- with only the two remote
services swapped out. Run:

    python3 tests/e2e.py [--shots DIR]
"""

import argparse
import json
import math
import os
import random
import struct
import sys
import tempfile
import threading
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

from tests import fake_openai, fake_sefaria  # noqa: E402


def speechlike(path, pattern=((0.6, 0), (1.8, 1), (2.6, 0), (1.8, 1), (4.0, 0)), rate=16000):
    """Bursts of voiced noise and silence -- enough for any VAD to find turns."""
    rnd = random.Random(7)
    frames = []
    t = 0
    for seconds, on in pattern:
        for i in range(int(seconds * rate)):
            s = 0.0
            if on:
                env = 0.55 + 0.45 * math.sin(2 * math.pi * 4 * t / rate)
                s = env * (0.28 * math.sin(2 * math.pi * 170 * t / rate) +
                           0.12 * math.sin(2 * math.pi * 340 * t / rate) + 0.06 * (rnd.random() - 0.5))
            frames.append(struct.pack("<h", int(max(-1, min(1, s)) * 32000)))
            t += 1
    data = b"".join(frames)
    with open(path, "wb") as f:
        f.write(b"RIFF" + struct.pack("<I", 36 + len(data)) + b"WAVEfmt " +
                struct.pack("<IHHIIHH", 16, 1, 1, rate, rate * 2, 2, 16) +
                b"data" + struct.pack("<I", len(data)) + data)


def start_stack():
    s1, sef = fake_sefaria.start()
    s2, oai = fake_openai.start()
    packs = tempfile.mkdtemp()
    # Yesterday's sitting, so coming back has something to review.
    sessions = tempfile.mkdtemp()
    import datetime
    yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()
    with open(os.path.join(sessions, yesterday + ".jsonl"), "w") as f:
        for ref in ("Berakhot 2a", "Berakhot 2b"):
            f.write(json.dumps({"kind": "heard", "ref": ref, "at": yesterday + " 21:00:00"}) + "\n")
    os.environ.update(CHAVRUTA_SEFARIA_API=sef, OPENAI_BASE_URL=oai, OPENAI_API_KEY="sk-test",
                      CHAVRUTA_PACKS=packs, CHAVRUTA_SESSIONS=sessions,
                      CHAVRUTA_NOTES=os.path.join(sessions, "notes.jsonl"), CHAVRUTA_WIKISOURCE_API=sef[:-4] + "/w/api.php",
                      CHAVRUTA_WEB_REWRITE='{"https://halachayomit.co.il": "%s/hy", "https://www.dafyomi.co.il": "%s/daf"}' % (sef[:-4], sef[:-4]))
    import importlib
    import chavruta.sefaria as sf
    importlib.reload(sf)
    import chavruta.server as srv
    importlib.reload(srv)
    from http.server import ThreadingHTTPServer
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), srv.Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return "http://127.0.0.1:%d/" % httpd.server_address[1], oai.replace("/v1", "")


def queue_transcript(control, text):
    urllib.request.urlopen(urllib.request.Request(control + "/control/transcript",
                           data=json.dumps({"text": text}).encode(),
                           headers={"Content-Type": "application/json"}))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--shots", default=None)
    ap.add_argument("--part", default="all")
    args = ap.parse_args()
    from playwright.sync_api import sync_playwright

    app, control = start_stack()
    mic = os.path.join(tempfile.mkdtemp(), "mic.wav")
    speechlike(mic)
    problems = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path="/opt/pw-browsers/chromium", args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            "--use-file-for-fake-audio-capture=%s" % mic, "--autoplay-policy=no-user-gesture-required"])
        ctx = browser.new_context(viewport={"width": 1400, "height": 900}, permissions=["microphone"])
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        # A web font refused by this sandbox's network proxy is not the page's error.
        page.on("console", lambda m: errors.append("console: " + m.text)
                if m.type == "error" and "ERR_CERT_AUTHORITY_INVALID" not in m.text else None)

        def check(label, ok, detail=""):
            print("%s %s %s" % ("✓" if ok else "✗", label, detail))
            if not ok:
                problems.append(label)

        def shot(name):
            if args.shots:
                page.screenshot(path=os.path.join(args.shots, name + ".png"))

        page.goto(app, wait_until="domcontentloaded")
        page.wait_for_selector(".seg", timeout=20000)
        check("opens Berakhot 2a", page.locator(".seg").count() == 14, "(%d lines)" % page.locator(".seg").count())
        check("Rashi column filled", page.locator("#col-inner .c").count() >= 10,
              "(%d)" % page.locator("#col-inner .c").count())
        check("Tosafot column filled", page.locator("#col-outer .c").count() >= 4,
              "(%d)" % page.locator("#col-outer .c").count())
        check("runner in Hebrew", "ברכות" in page.inner_text("#runner"), page.inner_text("#runner"))
        check("the units of the page are marked", page.locator(".unit").all_inner_texts() == ["משנה", "גמרא", "אמר מר"],
              str(page.locator(".unit").all_inner_texts()))
        check("status ready", page.inner_text("#statustext") in ("מוכן", "ספריא לא זמינה"), page.inner_text("#statustext"))
        check("printed text has no nikud", not any(0x591 <= ord(c) <= 0x5c7 for c in page.inner_text("#gtext")))
        shot("01-daf")

        # Coming back after a day: where you were, and a review on one tap.
        page.wait_for_selector("#chips .chip:has-text('חזרה על מה שלמדנו')", timeout=10000)
        check("coming back, it says where you stopped", "בפעם הקודמת" in page.inner_text("#reply"),
              page.inner_text("#reply")[:60])
        page.click("#chips .chip:has-text('חזרה על מה שלמדנו')")
        page.wait_for_function("S.turns.some(t => /\\[\\[Berakhot 2b\\]\\]/.test(t.text || ''))", timeout=20000)
        check("↺ reviews last time's pages, each cited",
              page.evaluate("S.turns.some(t => /Berakhot 2a/.test(t.text) && /Berakhot 2b/.test(t.text))"))
        page.wait_for_function("!saying && !speechQ.length", timeout=20000)

        # The picker: daf ג, amud ב.
        page.select_option("#daf", "3")
        page.click("#am-b")
        page.wait_for_function("document.querySelector('#runner').textContent.includes('דף ג׳ · עמוד ב׳')")
        page.wait_for_selector(".seg", timeout=20000)
        page.wait_for_function("document.querySelectorAll('.seg').length === 32", timeout=20000)
        check("picker opens ג ע״ב with its 32 lines", page.locator(".seg").count() == 32)
        check("amud bet puts Rashi on the left",
              "bet" in page.get_attribute("#page", "class"))
        page.click("#next")
        page.wait_for_function("document.querySelector('#runner').textContent.includes('ד׳')", timeout=20000)
        check("next flips to ד ע״א", "ד׳" in page.inner_text("#runner"), page.inner_text("#runner"))
        page.wait_for_function("S.pack && S.pack.ref === 'Berakhot 4a'", timeout=20000)
        page.keyboard.press("ArrowRight")
        page.wait_for_function("document.querySelector('#runner').textContent.includes('דף ג׳ · עמוד ב׳')", timeout=20000)
        check("→ key flips back to ג ע״ב", "עמוד ב׳" in page.inner_text("#runner"), page.inner_text("#runner"))
        shot("02-bet")

        # Back to 2a for the conversation.
        page.select_option("#daf", "2"); page.click("#am-a")
        page.wait_for_function("document.querySelectorAll('.seg').length === 14", timeout=20000)

        page.click("#v-lin")
        page.wait_for_selector(".line")
        check("Steinsaltz view: vocalized lines", page.locator(".line").count() == 14 and
              any(0x591 <= ord(c) <= 0x5c7 for c in page.inner_text("#linear")))
        page.click("#v-daf")
        page.wait_for_selector(".seg")

        if args.part in ("all", "voice"):
            # The sitting that taught us what was wrong, replayed.
            line1 = ("מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן "
                     "עד סוף האשמורה הראשונה דברי רבי אליעזר")
            queue_transcript(control, line1)                                  # 1. read right: silence
            queue_transcript(control, line1.replace("בתרומתן", "מעשר"))      # 2. a different word: asked
            queue_transcript(control, "וחכמים אומרים עד חצות רבן גמליאל אומר עד שיעלה עמוד השחר "
                                      "מעשה ובאו בניו מבית המשתה אמרו לו לא קרינו את שמע אמר להם "
                                      "אם לא עלה עמוד השחר חייבין אתם לקרות ולא זו בלבד אמרו אלא כל מה "
                                      "שאמרו חכמים עד חצות מצותן עד שיעלה עמוד השחר הקטר חלבים ואברים "
                                      "מצותן עד שיעלה עמוד השחר וכל הנאכלים ליום אחד מצותן עד שיעלה "
                                      "עמוד השחר אם כן למה אמרו חכמים עד חצות כדי להרחיק אדם מן העבירה")  # 3. to the end of the mishna
            queue_transcript(control, "so he's saying you read shema whenever you happen to go to sleep")
            queue_transcript(control, "and was this codified in the Tur or Shulchan Aruch or the Rama?")
            queue_transcript(control, "can you hear me?")
            page.click("#mic")
            page.wait_for_function("['listening','capturing'].includes(document.querySelector('#mic').dataset.state)",
                                   timeout=8000)
            check("mic opens and listens", True, page.inner_text("#state"))
            page.wait_for_function("document.querySelectorAll('.w.read').length > 5", timeout=25000)
            check("follows the reading on the page", page.locator(".w.read").count() >= 10,
                  "(%d words marked)" % page.locator(".w.read").count())
            def said(pattern, t=60000):
                try:
                    page.wait_for_function("S.log.some((t) => !t.me && %s.test(t.text))" % pattern, timeout=t)
                except Exception:
                    print("waited for %s; the log was:" % pattern,
                          page.evaluate("JSON.stringify(S.log.map((t) => [t.me, t.mode, (t.text || '').slice(0, 60)]))"))
                    raise
            said("/מעשר\\?/")
            log = page.evaluate("S.log.map((t) => [t.me ? 'me' : 'it', t.mode || '', t.text])")
            log = log[next(i for i, t in enumerate(log) if t[1] == "reading"):]   # after the review at the start
            check("a clean reading gets no reply", log[0][:2] == ["me", "reading"] and log[1][0] == "me",
                  str(log[:2])[:160])
            check("a different word is asked about, once", sum("מעשר?" in t[2] for t in log) == 1,
                  next((t[2] for t in log if "מעשר?" in t[2]), "")[:90])
            said("/takes on Rashi/")
            check("speaks up at the end of the mishna, not the first line", True)
            shot("03-reading")
            said("/can't be right/")
            check("answers the explanation", True)
            said("/pull up/")
            said("/rules like Rabban Gamliel/")
            log = page.evaluate("S.log.map((t) => [t.me ? 'me' : 'it', t.interim ? 'interim' : '', t.text])")
            fetching = next(t[2] for t in log if t[1] == "interim" and "the Tur" in t[2]) \
                if any("the Tur" in t[2] for t in log if t[1] == "interim") else ""
            check("says it is fetching, then answers from the Tur", "the Tur" in fetching, fetching)
            said("/hear you/")
            check("a mic check gets a few words", True)
            shot("04-answer")
            # Replies wait for a pause in the learner's speech, and the fake
            # microphone talks a lot: give them time to be said.
            for _ in range(40):
                spoken = [e for e in json.loads(urllib.request.urlopen(control + "/control/log").read())
                          if e["path"] == "speech"]
                if len(spoken) >= 4:
                    break
                time.sleep(0.5)
            check("replies are spoken", len(spoken) >= 4, "(%d)" % len(spoken))
            check("the fetching line is spoken before the answer",
                  any("pull up" in e["input"] for e in spoken))
            check("short quotes are spoken, the gemara is not read back",
                  any("בתרומתן" in e["input"] for e in spoken) and
                  not any("נכנסים לאכול בתרומתן עד סוף האשמורה הראשונה" in e["input"] for e in spoken),
                  " | ".join(e["input"][:40] for e in spoken[:4]))
            check("no citation markers reach the voice", not any("[[" in e["input"] for e in spoken))
            heard = [e for e in json.loads(urllib.request.urlopen(control + "/control/log").read())
                     if e["path"] == "transcribe"]
            check("transcription primed with the page",
                  bool(heard) and any("מאימתי" in e["prompt"] for e in heard),
                  heard[0]["prompt"][-60:] if heard else "")
            report = page.evaluate("sessionReport()")
            check("session export has the whole sitting",
                  "heard as reading" in report and "differs from the page" in report and
                  "Tur, Orach Chayim 235" in report and "while fetching" in report and "quick reply" in report,
                  "(%d chars)" % len(report))
            if args.shots:
                open(os.path.join(args.shots, "session.md"), "w").write(report)
            recorded = os.listdir(os.environ["CHAVRUTA_SESSIONS"])
            check("each turn is recorded on disk", bool(recorded), str(recorded))
            page.click("#mic")
            page.wait_for_function("!saying && !speakingDone", timeout=15000)
            # Citations sit in the sentence and open what they cite.
            page.evaluate("showReply(S.log.find((t) => /can't be right/.test(t.text)).text)")
            check("a citation sits inside the sentence", page.locator("#reply .chip.inline").count() >= 1)
            page.click("#reply .chip.inline")
            page.wait_for_selector("#over.open", timeout=5000)
            check("chip opens the source", page.locator(".src.flash").count() == 1)
            shot("05-source")
            page.keyboard.press("Escape")
            page.evaluate("showReply(S.log.find((t) => /rules like Rabban Gamliel/.test(t.text)).text)")
            page.click("#reply .chip.inline")
            page.wait_for_function("/הלכה כר/.test((document.querySelector('.tl .body') || {}).textContent || '')",
                                   timeout=8000)
            check("a code off the page opens in the panel, fetched from Sefaria", True)
            shot("06-tur")
            page.keyboard.press("Escape")
            check("mic closes", page.get_attribute("#mic", "data-state") == "idle")

            # ⏸ stops it without talking over it; ▶ carries on.
            page.evaluate("void say('Rabban Gamliel holds the whole night is bedtime, and the Sages set midnight "
                          "as a fence so that a person does not come to miss it altogether. ' .repeat(2))")
            page.wait_for_selector("#hold:not([hidden])", timeout=15000)
            page.click("#hold")
            check("⏸ pauses the voice", page.get_attribute("#mic", "data-state") == "paused"
                  and page.inner_text("#hold") == "▶")
            page.click("#hold")
            check("▶ resumes it", page.get_attribute("#mic", "data-state") == "speaking"
                  and page.inner_text("#hold") == "⏸", page.get_attribute("#mic", "data-state"))
            page.keyboard.press("Escape")
            page.wait_for_selector("#hold", state="hidden", timeout=5000)
            check("Esc stops it", True)

            # Mic on/off/on quickly: never stuck, never two microphones.
            for _ in range(3):
                page.click("#mic")
            page.wait_for_function("['listening','capturing','hearing'].includes(document.querySelector('#mic').dataset.state)",
                                   timeout=8000)
            page.click("#mic")
            check("mic toggles cleanly", page.get_attribute("#mic", "data-state") == "idle"
                  and page.evaluate("ears === null && !S.listening"))

            # Typing: the panel stays open, the gemara stays in view, the turn appears.
            page.click("#open-log")
            page.fill("#panel input", "can you hear me?")
            page.press("#panel input", "Enter")
            page.wait_for_function("/hear you|I'm here/.test(document.querySelector('#turns').textContent)",
                                   timeout=15000)
            check("typing answers in the open transcript", page.locator("#over.open").count() == 1)
            # Their question is a commentator's: whose, and read it together or the gist.
            page.fill("#panel input", "why does the mishna need to say the priests at all?")
            page.press("#panel input", "Enter")
            page.wait_for_function("/it's exactly the/.test(document.querySelector('#turns').textContent)",
                                   timeout=15000)
            check("their question is a commentator's, and it offers to read it", True)
            page.fill("#panel input", "let's read it together")
            page.press("#panel input", "Enter")
            page.wait_for_function("/why the priests are named/.test(document.querySelector('#turns').textContent)",
                                   timeout=15000)
            chose = [json.loads(l) for f in os.listdir(os.environ["CHAVRUTA_SESSIONS"]) if f.endswith(".jsonl")
                     for l in open(os.path.join(os.environ["CHAVRUTA_SESSIONS"], f))
                     if '"chose"' in l]
            check("…and reads it with them, in full", chose and chose[-1]["trace"]["chose"] == "read")
            # The desk: what is read opens beside the page, the words lit as they are read.
            page.wait_for_selector("#desk:not([hidden]) .dc", timeout=5000)
            check("reading it together opens it on the desk", page.locator("#desk .dc").count() == 1)
            page.wait_for_function("document.querySelectorAll('#desk .dw.quoted').length >= 3", timeout=8000)
            check("…with the words being read lit", True)
            check("…at the comment being read", page.locator("#desk .dc-entry.focus").count() == 1)
            page.fill("#panel input", "put the Meiri and the Rashba on the side")
            page.press("#panel input", "Enter")
            page.wait_for_function("document.querySelectorAll('#desk .dc').length === 3", timeout=15000)
            names = lambda: page.evaluate("[...document.querySelectorAll('#desk .dc-name')].map((n) => n.textContent)")
            check("more commentators by voice", names()[1:] == ["מאירי", "רשב״א"], str(names()))
            page.locator("#desk .dc").nth(2).locator(".dc-btn").first.click()
            check("rearranged", names()[1:] == ["רשב״א", "מאירי"], str(names()))
            page.click("#desk-below")
            check("the desk under the page", page.evaluate(
                "getComputedStyle(document.querySelector('main')).flexDirection") == "column")
            page.click("#desk-side")
            page.click("#desk-add")
            page.locator("#desk-pick .chip:not(.on)").first.click()
            check("＋ adds from everyone on the amud", page.locator("#desk .dc").count() == 4)
            page.locator("#desk .dc").nth(3).locator(".dc-btn", has_text="✕").click()
            check("✕ takes one off", page.locator("#desk .dc").count() == 3)
            # Saved: one tap, a name, Enter.
            page.click(".lay-save")
            page.fill(".lay-form input", "הלימוד שלי")
            page.press(".lay-form input", "Enter")
            check("a layout saved under a name", page.locator(".lay.on", has_text="הלימוד שלי").count() == 1)
            shot("07-desk")
            page.click("#desk-close")
            check("the desk closes", page.locator("#desk[hidden]").count() == 1)
            # Settings by voice: done at once, and said in a few words.
            page.fill("#panel input", "answer in Hebrew from now on")
            page.press("#panel input", "Enter")
            page.wait_for_function("S.settings.language === 'he'", timeout=15000)
            page.wait_for_function("S.turns.some(t => /מעכשיו בעברית/.test(t.text || ''))", timeout=15000)
            check("a setting changed by voice", True)
            # Turning the voice off is asked first.
            page.fill("#panel input", "turn off your voice")
            page.press("#panel input", "Enter")
            page.wait_for_function("S.pendingSettings && S.pendingSettings.length === 1", timeout=15000)
            check("turning the voice off is asked first", page.evaluate("S.settings.speak") is True)
            page.fill("#panel input", "no")
            page.press("#panel input", "Enter")
            page.wait_for_function("!S.pendingSettings", timeout=15000)
            check("…and 'no' keeps it", page.evaluate("S.settings.speak") is True)
            page.evaluate("S.settings.language = 'en'; saveSettings()")
            page.wait_for_function("!saying && !speechQ.length", timeout=20000)
            # A follow-up said while the first question is still being thought
            # about is answered with it, once. (The model is slowed down here so
            # the first is certainly still thinking.)
            latency = lambda s: urllib.request.urlopen(urllib.request.Request(
                control + "/control/latency", data=json.dumps({"seconds": s}).encode(),
                headers={"Content-Type": "application/json"}))
            latency(0.8)
            page.fill("#panel input", "so he's saying you read shema whenever you happen to go to sleep")
            page.press("#panel input", "Enter")
            page.fill("#panel input", "and was this codified in the Tur or Shulchan Aruch or the Rama?")
            page.press("#panel input", "Enter")
            page.wait_for_function("S.turns.some(t => /so he's saying/.test(t.asked) && /codified/.test(t.asked))",
                                   timeout=15000)
            check("a follow-up while it thinks is answered with the question, once",
                  page.evaluate("S.turns.filter(t => /^and was this codified/.test(t.asked) && open(t)).length") == 0,
                  page.evaluate("JSON.stringify(S.turns.map(t => [t.asked.slice(0, 30), t.status]))"))
            # Asked while an answer is being said: the bar shows the one being
            # answered, the new one waits in the queue, and ⏩ goes straight to it.
            page.wait_for_function("saying && saying.turn && /codified/.test(saying.turn.asked)", timeout=20000)
            page.fill("#panel input", "what does chatzot mean here?")
            page.press("#panel input", "Enter")
            page.wait_for_selector("#queue .qitem", timeout=15000)
            check("a question asked while it speaks waits in a visible queue",
                  "chatzot" in page.inner_text("#queue") and "chatzot" not in page.inner_text("#asked"),
                  page.inner_text("#asked")[:40] + " | " + page.inner_text("#queue")[:60])
            shot("08-queue")
            page.click("#queue .qbtn:last-child")
            page.wait_for_function("/chatzot/.test(document.querySelector('#asked').textContent)", timeout=15000)
            latency(0)
            check("⏩ jumps to the latest question", page.locator("#queue .qitem").count() == 0)
            box = page.evaluate("(() => { const g = document.querySelector('#col-gemara').getBoundingClientRect();"
                                " const p = document.querySelector('#panel').getBoundingClientRect();"
                                " return [g.left, g.right, p.left, p.right]; })()")
            check("the gemara stays in view beside the panel", box[1] <= box[2] + 1 or box[0] >= box[3] - 1, str(box))
            shot("07-docked")
            # ✕ is always in reach, however far down the panel is scrolled.
            page.evaluate("document.querySelector('#panel').scrollTo({top: 99999})")
            close = page.evaluate("(() => { const r = document.querySelector('#close-panel').getBoundingClientRect();"
                                  " return r.top >= 0 && r.bottom <= innerHeight; })()")
            check("✕ stays in reach when the panel is scrolled", close)
            # Drag the edge: the panel takes more of the screen, and it is remembered.
            before = page.evaluate("document.querySelector('#over').getBoundingClientRect().width")
            g = page.locator("#grip").bounding_box()
            page.mouse.move(g["x"] + 5, g["y"] + g["height"] / 2)
            page.mouse.down()
            page.mouse.move(g["x"] - 200, g["y"] + g["height"] / 2, steps=8)
            page.mouse.up()
            after = page.evaluate("document.querySelector('#over').getBoundingClientRect().width")
            check("dragging the edge resizes the panel", after > before + 100, "%d -> %d" % (before, after))
            page.click("#close-panel")
            check("✕ closes it", page.locator("#over.open").count() == 0)

        page.click("#open-settings")
        check("settings open", page.locator(".set").count() >= 8)
        # Seat the Ritva, leave out the Meiri: kept, and sent with every question.
        page.wait_for_selector(".seat[title='Ritva']", timeout=8000)
        page.click(".seat[title='Ritva']")
        page.click(".seat[title='Meiri']")
        page.click(".seat[title='Meiri']")
        # What I'm learning: Berakhot goes to the top of the picker.
        page.click(".learning .btn[data-masechta='Berakhot']")
        page.wait_for_selector(".prepline", timeout=8000)
        check("my tractates come first in the picker",
              page.evaluate("document.querySelector('#mas optgroup').label") == "שלי"
              and page.evaluate("document.querySelectorAll('#mas option').length") >= 37,
              page.inner_text(".prep")[:60])
        # 📅 goes to today's daf (the fake calendar says Berakhot 2).
        page.click("#today")
        page.wait_for_function("S.pack && S.pack.ref === 'Berakhot 2a'", timeout=15000)
        check("📅 opens today's daf", "ברכות" in page.inner_text("#today"), page.inner_text("#today"))
        check("who sits at the table is chosen in settings",
              page.evaluate("JSON.stringify(S.settings.favor)") == '{"Ritva":1,"Meiri":-1}',
              page.inner_text(".seats")[:80])
        shot("06-settings")
        page.keyboard.press("Escape")
        page.click("#open-log")
        check("transcript shows the turns", page.locator(".turn").count() >= 2 if args.part != "picker" else True)
        page.keyboard.press("Escape")

        errors = [e for e in errors if "favicon" not in e and "fonts.g" not in e and "ERR_TUNNEL" not in e
                  and "ERR_CERT" not in e]  # this sandbox's proxy blocks Google Fonts
        # One pace for every sentence: measured as they are said, in both languages alike.
        check("each sentence's pace is measured", page.evaluate("PACES.length") >= 2, str(page.evaluate("PACES.length")))
        check("syllables counted alike in Hebrew and English",
              page.evaluate("syllables('מאימתי קורין את שמע')") == 9 and page.evaluate("syllables('from when do we read the Shema')") == 8,
              str(page.evaluate("[syllables('מאימתי קורין את שמע'), syllables('from when do we read the Shema')]")))
        # Progress, in settings: days in a row, pages per tractate.
        page.click("#open-settings")
        page.wait_for_selector(".progress .prog-row", timeout=10000)
        check("progress shows pages learned", "ברכות" in page.inner_text(".progress"), page.inner_text(".progress")[:80])
        # A note by voice: kept, and 📝 on its line.
        page.evaluate("S.settings.view = 'daf'; render(); selectLine(3)")
        page.evaluate("onUtterance({ text: 'note: check what Tosafot says here' })")
        page.wait_for_selector("#gtext .note-mark", timeout=15000)
        check("a note by voice is pinned to its line", page.locator("#gtext .note-mark").count() == 1)
        # Reading on past the last line turns to the next amud.
        page.evaluate("selectLine(14)")
        page.evaluate("onUtterance({ text: 'אמר רבה בר רב שילא אם כן לימא קרא ויטהר מאי וטהר טהר יומא' })")
        page.wait_for_function("S.pack && S.pack.ref === 'Berakhot 2b'", timeout=20000)
        check("reading on turns the page", page.evaluate("S.line") <= 3, "line %s" % page.evaluate("S.line"))
        # Back at the same line after closing and opening.
        page.evaluate("selectLine(7)")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("S.pack && S.pack.ref === 'Berakhot 2b' && S.line === 7", timeout=20000)
        check("opens again at the line you were on", True)
        check("the desk was for that sitting only", page.evaluate("DESK.cards.length === 0 && !DESK.open"))
        page.click("#open-desk")
        page.click(".lay-go:has-text('הלימוד שלי')")
        check("…but a saved layout opens in one tap", page.locator("#desk .dc").count() == 3)
        page.click(".lay.on .lay-x:has-text('☆')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("S.pack && DESK.open && document.querySelectorAll('#desk .dc').length === 3",
                               timeout=20000)
        check("the ★ layout opens by itself", page.evaluate("DESK.place") == "side")
        check("no JavaScript errors", not errors, "; ".join(errors[:3]))
        browser.close()
    print("\n%s" % ("ALL PASSED" if not problems else "FAILED: " + ", ".join(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
