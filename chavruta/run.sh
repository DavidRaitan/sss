#!/usr/bin/env bash
# One command.
#
#   ./run.sh              open the app in your browser
#   ./run.sh doctor       check the key, Sefaria and the models, and say what to fix
#   ./run.sh prefetch     build every page of Berakhot now, so each opens instantly
#   ./run.sh test         run the tests
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is not installed. On a Mac, run:  xcode-select --install"
  exit 1
fi

VENV=".venv"
PY="$VENV/bin/python"
STAMP="$VENV/.installed"

if [ ! -x "$PY" ]; then
  echo "setting up (first run only)…"
  python3 -m venv "$VENV"
fi
# Reinstall whenever requirements.txt changes, not only the first time.
if [ ! -f "$STAMP" ] || [ requirements.txt -nt "$STAMP" ]; then
  "$PY" -m pip install --quiet --upgrade pip
  "$PY" -m pip install --quiet -r requirements.txt
  touch "$STAMP"
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

case "${1:-}" in
  test)
    exec "$PY" -W ignore -m unittest tests.test_units ;;
  doctor|prefetch)
    exec "$PY" -m chavruta "$@" ;;
esac

if ! grep -qE '^(OPENAI|ANTHROPIC)_API_KEY=.+' .env; then
  echo
  echo "  Put your API key in .env, then run ./run.sh again:"
  echo "    open -e $(pwd)/.env"
  echo
  exit 1
fi

exec "$PY" -m chavruta "$@"
