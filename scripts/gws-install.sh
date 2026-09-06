#!/usr/bin/env bash
# gws-install — install the Google Workspace CLI plus the multi-account wrapper.
#
# Usage: scripts/gws-install.sh [options]
#   --method auto|npm|brew|cargo   How to install gws (default: auto)
#   --with-skills                  Also install the gws Claude Code skills
#   --shell-rc <file>              Append the source line to this rc file
#   --no-shell                     Skip shell integration entirely
#
# Installs:
#   gws                       the CLI itself
#   ~/.local/bin/gws-account  the multi-account manager
#   ~/.config/gws-accounts/   account config dirs + shared OAuth client

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ACCOUNTS_HOME="${GWS_ACCOUNTS_HOME:-$HOME/.config/gws-accounts}"
BIN_DIR="${GWS_BIN_DIR:-$HOME/.local/bin}"
SKILLS_DIR="${GWS_SKILLS_DIR:-$HOME/.claude/skills}"

METHOD=auto
WITH_SKILLS=0
SHELL_RC=""
NO_SHELL=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --method) METHOD="${2:-}"; shift 2 ;;
    --with-skills) WITH_SKILLS=1; shift ;;
    --shell-rc) SHELL_RC="${2:-}"; shift 2 ;;
    --no-shell) NO_SHELL=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

# --- 1. Install the gws binary -------------------------------------------

step "Installing the gws CLI"

if have gws; then
  info "gws is already installed: $(command -v gws) ($(gws --version 2>/dev/null | head -1))"
else
  if [ "$METHOD" = auto ]; then
    if have brew; then METHOD=brew
    elif have npm; then METHOD=npm
    elif have cargo; then METHOD=cargo
    else die "need one of brew, npm or cargo to install gws.
Alternatively download a binary from https://github.com/googleworkspace/cli/releases and put it on your PATH."
    fi
    info "auto-selected install method: $METHOD"
  fi

  case "$METHOD" in
    brew)  brew install googleworkspace-cli ;;
    npm)   npm install -g @googleworkspace/cli ;;
    cargo) cargo install --git https://github.com/googleworkspace/cli --locked ;;
    *) die "unknown --method: $METHOD" ;;
  esac

  have gws || die "gws still not on PATH after install. Open a new shell, or add the install dir to PATH."
  info "installed: $(gws --version 2>/dev/null | head -1)"
fi

# --- 2. Install the account manager --------------------------------------

step "Installing the multi-account manager"

mkdir -p "$BIN_DIR" "$ACCOUNTS_HOME"
chmod 700 "$ACCOUNTS_HOME"
install -m 755 "$SCRIPT_DIR/gws-account.sh" "$BIN_DIR/gws-account"
install -m 644 "$SCRIPT_DIR/gws-shell.sh" "$ACCOUNTS_HOME/shell.sh"
info "installed $BIN_DIR/gws-account"
info "installed $ACCOUNTS_HOME/shell.sh"

case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) info "NOTE: $BIN_DIR is not on your PATH. Add it:"
     info "      export PATH=\"\$HOME/.local/bin:\$PATH\"" ;;
esac

# --- 3. Shell integration -------------------------------------------------

SOURCE_LINE="source \"$ACCOUNTS_HOME/shell.sh\"   # gws @account support"

if [ "$NO_SHELL" = 0 ]; then
  step "Shell integration"
  if [ -z "$SHELL_RC" ]; then
    case "${SHELL##*/}" in
      zsh)  SHELL_RC="$HOME/.zshrc" ;;
      bash) SHELL_RC="$HOME/.bashrc" ;;
    esac
  fi

  if [ -n "$SHELL_RC" ] && [ -f "$SHELL_RC" ]; then
    if grep -qF "$ACCOUNTS_HOME/shell.sh" "$SHELL_RC"; then
      info "already sourced from $SHELL_RC"
    else
      printf '\n%s\n' "$SOURCE_LINE" >> "$SHELL_RC"
      info "appended to $SHELL_RC — run: source $SHELL_RC"
    fi
  else
    info "add this line to your shell rc file:"
    info "    $SOURCE_LINE"
  fi
fi

# --- 4. Optional: Claude Code skills --------------------------------------

if [ "$WITH_SKILLS" = 1 ]; then
  step "Installing gws Claude Code skills"
  tmp="$(mktemp -d)"
  trap 'rm -rf "$tmp"' EXIT
  git clone --depth 1 https://github.com/googleworkspace/cli "$tmp/cli" >/dev/null 2>&1 \
    || die "could not clone googleworkspace/cli to fetch skills"
  [ -d "$tmp/cli/skills" ] || die "no skills/ directory in the upstream repo"
  mkdir -p "$SKILLS_DIR"
  count=0
  for s in "$tmp/cli/skills"/*/; do
    [ -d "$s" ] || continue
    rm -rf "$SKILLS_DIR/$(basename "$s")"
    cp -R "$s" "$SKILLS_DIR/"
    count=$((count + 1))
  done
  info "installed $count skills into $SKILLS_DIR"
fi

# --- 5. Next steps --------------------------------------------------------

step "Done. Next steps"
cat <<EOS
1. Create a Google Cloud project and a Desktop-app OAuth client, and add each
   Gmail address you plan to connect under "Test users".
   Full walkthrough: docs/google-workspace-cli.md

2. Install the downloaded OAuth client JSON:
     gws-account client ~/Downloads/client_secret_XXXX.json

3. Add your accounts (the first one becomes the default):
     gws-account add personal
     gws-account add second

4. Use them:
     gws drive files list             # default account
     gws @second drive files list     # the other one
     gws-account list                 # see all accounts
     gws-account use second           # change the default
EOS
