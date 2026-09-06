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

# Whether BIN_DIR is on PATH is decided later, once the rc file is known: on
# macOS ~/.local/bin is not on the default PATH, so merely printing a note here
# leaves gws-account installed but invisible.
PATH_NEEDED=0
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) PATH_NEEDED=1 ;;
esac

# --- 3. Shell integration -------------------------------------------------

SOURCE_LINE="source \"$ACCOUNTS_HOME/shell.sh\"   # gws @account support"
PATH_LINE="export PATH=\"$BIN_DIR:\$PATH\"   # gws-account"

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
      info "appended to $SHELL_RC"
    fi

    if [ "$PATH_NEEDED" = 1 ]; then
      if grep -qF "$BIN_DIR" "$SHELL_RC"; then
        info "$BIN_DIR already added to PATH in $SHELL_RC"
      else
        printf '%s\n' "$PATH_LINE" >> "$SHELL_RC"
        info "added $BIN_DIR to PATH in $SHELL_RC"
      fi
      PATH_NEEDED=0
    fi

    info "run: source $SHELL_RC"
  else
    info "add these lines to your shell rc file:"
    [ "$PATH_NEEDED" = 1 ] && info "    $PATH_LINE"
    info "    $SOURCE_LINE"
  fi
fi

# --no-shell, or no rc file found: PATH is still the user's to fix.
if [ "$PATH_NEEDED" = 1 ]; then
  info ""
  info "NOTE: $BIN_DIR is not on your PATH, so gws-account will not be found."
  info "      Add this to your shell rc file:"
  info "          $PATH_LINE"
fi

# --- 4. Claude Code skills ------------------------------------------------

# The multi-account skill is ours and always installed: without it Claude only
# ever drives the default account, since the upstream skills know nothing about
# gws-account.
step "Installing the multi-account skill for Claude Code"

LOCAL_SKILL=""
for cand in "$SCRIPT_DIR/../skills/gws-accounts" "$SCRIPT_DIR/skills/gws-accounts"; do
  [ -d "$cand" ] && { LOCAL_SKILL="$cand"; break; }
done

if [ -n "$LOCAL_SKILL" ]; then
  mkdir -p "$SKILLS_DIR"
  rm -rf "$SKILLS_DIR/gws-accounts"
  cp -R "$LOCAL_SKILL" "$SKILLS_DIR/"
  info "installed $SKILLS_DIR/gws-accounts"
else
  info "NOTE: skills/gws-accounts not found next to this script; skipped."
  info "      Without it, Claude Code will only use your default account."
fi

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
1. In the Google Cloud Console (no gcloud needed), create a project, enable the
   Drive/Docs/Sheets/Gmail/Calendar APIs, add every Gmail address you plan to
   connect under Google Auth Platform -> Audience -> Test users, and create a
   Desktop app OAuth client under Google Auth Platform -> Clients.
     https://console.cloud.google.com/auth/audience
     https://console.cloud.google.com/auth/clients
   Full walkthrough, including the 7-day token expiry in Testing mode:
     docs/google-workspace-cli.md

2. Install the downloaded OAuth client JSON:
     gws-account client ~/Downloads/client_secret_XXXX.json

3. Add your accounts (the first one becomes the default):
     gws-account add personal
     gws-account add second

4. Use them from your shell:
     gws drive files list             # default account
     gws @second drive files list     # the other one
     gws-account list                 # see all accounts
     gws-account use second           # change the default

5. Use them from Claude Code. Just ask in plain language -- "check my work
   inbox", "list files in my personal Drive". To cut permission prompts,
   allowlist these in ~/.claude/settings.json:
     "Bash(gws:*)", "Bash(gws-account:*)"
EOS
