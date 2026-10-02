# -*- coding: utf-8 -*-
"""Reading .env, so a key lives in a gitignored file and never in the repo."""

import os


def load(path=".env"):
    """Set anything in .env that is not already in the environment."""
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key, value = key.strip(), value.strip().strip("'\"")
            # A real environment variable always wins over the file.
            os.environ.setdefault(key, value)
