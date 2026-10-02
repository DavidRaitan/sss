# -*- coding: utf-8 -*-
"""The stand-ins for Sefaria and OpenAI, for the JavaScript tests: prints their
addresses as one line of JSON, then serves until its stdin closes."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from tests import fake_openai, fake_sefaria  # noqa: E402

_, sef = fake_sefaria.start()
_, oai = fake_openai.start()
print(json.dumps({"sefaria": sef, "openai": oai, "control": oai[:-3]}), flush=True)
sys.stdin.read()
