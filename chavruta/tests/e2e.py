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
    os.environ.update(CHAVRUTA_SEFARIA_API=sef, OPENAI_BASE_URL=oai, OPENAI_API_KEY="sk-test",
                      CHAVRUTA_PACKS=packs)
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
        page.on("console", lambda m: errors.append("console: " + m.text) if m.type == "error" else None)

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
        check("status ready", page.inner_text("#statustext") in ("מוכן", "ספריא לא זמינה"), page.inner_text("#statustext"))
        check("printed text has no nikud", not any(0x591 <= ord(c) <= 0x5c7 for c in page.inner_text("#gtext")))
        shot("01-daf")

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
            # 1. They read line 1 aloud: followed silently, then the one nudge.
            queue_transcript(control, "מאימתי קורין את שמע בערבין משעה שהכהנים נכנסים לאכול בתרומתן "
                                      "עד סוף האשמורה הראשונה דברי רבי אליעזר")
            # 2. Then they say what they think it means.
            queue_transcript(control, "so he's saying you read shema whenever you happen to go to sleep")
            page.click("#mic")
            page.wait_for_function("['listening','capturing'].includes(document.querySelector('#mic').dataset.state)",
                                   timeout=8000)
            check("mic opens and listens", True, page.inner_text("#state"))
            page.wait_for_function("document.querySelectorAll('.w.read').length > 5", timeout=25000)
            check("follows the reading on the page", page.locator(".w.read").count() >= 10,
                  "(%d words marked)" % page.locator(".w.read").count())
            page.wait_for_function("/Tosafot|תוספות/.test(document.querySelector('#reply').textContent)", timeout=25000)
            check("speaks up once at the Tosafot, in the language read", "רש״י" in page.inner_text("#reply"),
                  page.inner_text("#reply")[:80])
            check("marks exactly the words read", page.locator(".w.read").count() == 17,
                  "(%d of line 1's 17)" % page.locator(".w.read").count())
            shot("03-reading")
            page.wait_for_function("document.querySelector('#reply').textContent.includes(\"can't be right\")",
                                   timeout=40000)
            check("answers the explanation", True, page.inner_text("#reply")[:90])
            check("cites with a tappable chip", page.locator(".chip").count() >= 1,
                  str(page.locator(".chip").all_inner_texts()))
            check("lights the quoted words on the page", page.locator(".w.quoted").count() >= 3,
                  "(%d)" % page.locator(".w.quoted").count())
            shot("04-answer")
            log = json.loads(urllib.request.urlopen(control + "/control/log").read())
            spoken = [e for e in log if e["path"] == "speech"]
            check("reply was spoken", bool(spoken))
            # The chavruta's own Hebrew is spoken; the text of the daf never is.
            check("gemara never sent to the voice",
                  not any("עד סוף האשמורה" in e["input"] or "[[" in e["input"] for e in spoken),
                  " | ".join(e["input"][:50] for e in spoken))
            heard = [e for e in log if e["path"] == "transcribe"]
            check("transcription primed with the page",
                  bool(heard) and any("מאימתי" in e["prompt"] for e in heard),
                  heard[0]["prompt"][-60:] if heard else "")
            page.click(".chip")
            page.wait_for_selector("#over.open", timeout=5000)
            check("chip opens the source", page.locator(".src.flash").count() == 1)
            shot("05-source")
            page.keyboard.press("Escape")
            page.click("#mic")
            check("mic closes", page.get_attribute("#mic", "data-state") == "idle")

        page.click("#open-settings")
        check("settings open", page.locator(".set").count() >= 8)
        shot("06-settings")
        page.keyboard.press("Escape")
        page.click("#open-log")
        check("transcript shows the turns", page.locator(".turn").count() >= 2 if args.part != "picker" else True)
        page.keyboard.press("Escape")

        errors = [e for e in errors if "favicon" not in e and "fonts.g" not in e and "ERR_TUNNEL" not in e
                  and "ERR_CERT" not in e]  # this sandbox's proxy blocks Google Fonts
        check("no JavaScript errors", not errors, "; ".join(errors[:3]))
        browser.close()
    print("\n%s" % ("ALL PASSED" if not problems else "FAILED: " + ", ".join(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
