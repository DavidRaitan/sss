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

# Copy one skill directory into SKILLS_DIR as a directory named after it.
#
# The destination is always spelled out in full. `cp -R src/ dest/` copies the
# directory's *contents* rather than the directory on macOS's BSD cp, which
# silently scattered every skill's SKILL.md into one directory where each
# overwrote the last. Naming the destination behaves identically on BSD and GNU.
install_skill() {
  local src="$1" name="$2" dest="$SKILLS_DIR/$name"
  rm -rf "$dest"
  cp -R "$src" "$dest"
  # Trust nothing: a skill Claude cannot read is worse than a loud failure.
  [ -f "$dest/SKILL.md" ] || die "failed to install skill '$name': $dest/SKILL.md is missing after copy"
}

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
step "Installing this repo's skills for Claude Code"

LOCAL_SKILLS=""
for cand in "$SCRIPT_DIR/../skills" "$SCRIPT_DIR/skills"; do
  [ -d "$cand" ] && { LOCAL_SKILLS="$cand"; break; }
done

if [ -n "$LOCAL_SKILLS" ]; then
  mkdir -p "$SKILLS_DIR"
  local_count=0
  for sk in "$LOCAL_SKILLS"/*/; do
    [ -f "${sk}SKILL.md" ] || continue
    name="$(basename "$sk")"
    install_skill "${sk%/}" "$name"
    info "installed $SKILLS_DIR/$name"
    local_count=$((local_count + 1))
  done
  [ "$local_count" = 0 ] && info "NOTE: no skills found in $LOCAL_SKILLS"
else
  info "NOTE: no skills/ directory next to this script; skipped."
  info "      Without gws-accounts, Claude Code only uses your default account."
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
    [ -f "${s}SKILL.md" ] || continue
    install_skill "${s%/}" "$(basename "$s")"
    count=$((count + 1))
  done
  info "installed $count skills into $SKILLS_DIR"
fi

# --- 5. Next steps --------------------------------------------------------

# Re-running the installer to pick up updates is routine, and replaying the
# full first-run walkthrough then reads as "there is still setup to do".
CONFIGURED=0
for d in "$ACCOUNTS_HOME"/*/; do
  [ -d "$d" ] && { CONFIGURED=1; break; }
done

if [ "$CONFIGURED" = 1 ]; then
  step "Done. Accounts already configured"
  if have gws-account; then
    gws-account list 2>/dev/null || true
  else
    info "(open a new shell, or run: source ${SHELL_RC:-your shell rc}, then: gws-account list)"
  fi
  cat <<EOS

Nothing else to do. Setup steps are in docs/google-workspace-cli.md if you
ever need them again (adding an account, changing scopes, publishing the app).
EOS
  exit 0
fi

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
