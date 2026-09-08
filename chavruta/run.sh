#!/usr/bin/env bash
# One command: set up if needed, then open the app.
#
#   ./run.sh            open the app in a browser
#   ./run.sh doctor     check the key, Sefaria, and the models are reachable
set -euo pipefail
cd "$(dirname "$0")"

VENV=".venv"
PY="$VENV/bin/python"

if [ ! -x "$PY" ]; then
  echo "setting up (first run only)…"
  python3 -m venv "$VENV"
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r requirements.txt
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo
  echo "  Put your API key in .env, then run this again:"
  echo "    $(pwd)/.env"
  echo
  exit 1
fi

if ! grep -qE '^(OPENAI|ANTHROPIC)_API_KEY=.+' .env; then
  echo "  .env has no API key yet — add one and run again."
  exit 1
fi

exec "$PY" -m chavruta "$@"
