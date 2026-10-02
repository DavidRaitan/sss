#!/usr/bin/env bash
# One command.
#
#   ./run.sh              open the app in your browser (the Cloudflare version, run on this Mac;
#                         without Node, the Python server)
#   ./run.sh python       the Python server, as before
#   ./run.sh doctor       check the key, Sefaria and the models, and say what to fix
#   ./run.sh prefetch     build every page of Berakhot now, so each opens instantly
#   ./run.sh test         run the tests
#   ./run.sh deploy       put it on Cloudflare (free): one address for the phone and the Mac, Mac off or on
#   ./run.sh worker       run the Cloudflare version on this Mac, as it runs there
set -euo pipefail
cd "$(dirname "$0")"

# -- Cloudflare ----------------------------------------------------------------
# The page, and a small Worker that holds the OpenAI key, reaches Sefaria and
# keeps the record of each sitting (D1). Needs Node (https://nodejs.org).
key_from_env() { grep -E '^OPENAI_API_KEY=' .env 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'"; }
case "${1:-}" in
  deploy)
    command -v npx >/dev/null 2>&1 || { echo "Node is needed: install it from https://nodejs.org, then run ./run.sh deploy again."; exit 1; }
    cd worker
    npm install --silent
    npx wrangler whoami >/dev/null 2>&1 || npx wrangler login
    npx wrangler d1 execute chavruta --remote --file schema.sql >/dev/null
    # The Worker must exist before it can hold secrets: deployed first, then the passcode, then the key
    # (each takes effect at once; with no passcode set it lets nobody in).
    npx wrangler deploy
    if ! npx wrangler secret list 2>/dev/null | grep -q PASSCODE; then
      echo
      echo "Choose a passcode. You type it once on each device (phone, Mac); without it nobody can use your key."
      read -r -s -p "Passcode: " CODE; echo
      printf %s "$CODE" | npx wrangler secret put PASSCODE
    fi
    if ! npx wrangler secret list 2>/dev/null | grep -q OPENAI_API_KEY; then
      KEY="$(cd .. && key_from_env)"
      if [ -z "$KEY" ]; then read -r -s -p "Your OpenAI API key: " KEY; echo; fi
      printf %s "$KEY" | npx wrangler secret put OPENAI_API_KEY
    fi
    echo
    echo "Done. Open the address above (https://chavruta.<you>.workers.dev) on the phone, and in Safari:"
    echo "Share -> Add to Home Screen."
    exit 0 ;;
  ""|worker)
    if command -v npx >/dev/null 2>&1; then
      [ -f .env ] || cp .env.example .env
      if [ -z "$(key_from_env)" ]; then
        echo; echo "  Put your OpenAI key in .env, then run ./run.sh again:"; echo "    open -e $(pwd)/.env"; echo; exit 1
      fi
      cd worker
      npm install --silent
      printf 'OPENAI_API_KEY=%s\nOPEN=1\n' "$(cd .. && key_from_env)" > .dev.vars
      npx wrangler d1 execute chavruta --local --file schema.sql >/dev/null
      (sleep 4 && command -v open >/dev/null 2>&1 && open "http://localhost:8765/") &
      exec npx wrangler dev --port 8765 --ip 127.0.0.1
    elif [ "${1:-}" = "worker" ]; then
      echo "Node is needed: https://nodejs.org"; exit 1
    fi ;;
  python)
    shift ;;
esac

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
