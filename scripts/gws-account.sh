#!/usr/bin/env bash
# gws-account — multi-account manager for the Google Workspace CLI (gws).
#
# gws has no native profile support: it reads one config dir, chosen by
# GOOGLE_WORKSPACE_CLI_CONFIG_DIR (default ~/.config/gws). This wraps that.
#
#   Each account gets its own dir:  ~/.config/gws-accounts/<name>
#   The default account is exposed by symlinking ~/.config/gws -> that dir,
#   so a bare `gws ...` (scripts, cron, agents) uses the default with no env set.
#
# Usage: gws-account <command> [args]
#   add <name>          Create an account and run OAuth login for it
#   list                List accounts, marking the default
#   use <name>          Make <name> the default account
#   run <name> -- ...   Run one gws command as <name>
#   login <name>        Re-run OAuth login for <name> (add/change scopes)
#   status [name]       Show auth status (all accounts if omitted)
#   path [name]         Print the config dir for <name> (default if omitted)
#   remove <name>       Delete an account's credentials and config dir
#   client <file.json>  Install the shared OAuth client_secret.json
#   migrate <name>      Adopt a pre-existing ~/.config/gws dir as <name>

set -euo pipefail

ACCOUNTS_HOME="${GWS_ACCOUNTS_HOME:-$HOME/.config/gws-accounts}"
DEFAULT_LINK="${GWS_DEFAULT_LINK:-$HOME/.config/gws}"
SHARED_CLIENT="$ACCOUNTS_HOME/client_secret.json"
# Services passed to `gws auth login -s` to filter the consent scope picker.
GWS_SERVICES="${GWS_SERVICES:-drive,docs,sheets,gmail,calendar}"

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*" >&2; }

need_gws() {
  command -v gws >/dev/null 2>&1 || die "gws is not on PATH. Run scripts/gws-install.sh first."
}

valid_name() {
  case "$1" in
    ''|*[!a-zA-Z0-9._-]*) return 1 ;;
    .|..) return 1 ;;
    *) return 0 ;;
  esac
}

acct_dir() { printf '%s/%s' "$ACCOUNTS_HOME" "$1"; }

# Name of the current default, derived from where the symlink points.
current_default() {
  [ -L "$DEFAULT_LINK" ] || return 1
  local target
  target="$(readlink "$DEFAULT_LINK")"
  case "$target" in
    "$ACCOUNTS_HOME"/*) basename "$target" ;;
    *) return 1 ;;
  esac
}

# Ask gws which account a config dir is actually authenticated as.
acct_email() {
  local dir="$1" out
  out="$(GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" gws auth status 2>/dev/null)" || { printf 'not authenticated'; return; }
  # Pull the first email-looking token out of the status output.
  local email
  email="$(printf '%s' "$out" | grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}' | head -1)"
  printf '%s' "${email:-authenticated}"
}

require_shared_client() {
  [ -f "$SHARED_CLIENT" ] || die "no OAuth client installed.
Create a *Desktop app* OAuth client at
  https://console.cloud.google.com/auth/clients
download the JSON, then run:
  gws-account client /path/to/client_secret.json
See docs/google-workspace-cli.md for the full walkthrough."
}

# Point ~/.config/gws at an account dir, refusing to clobber a real directory.
set_default() {
  local name="$1" dir
  dir="$(acct_dir "$name")"
  [ -d "$dir" ] || die "no such account: $name"

  if [ -e "$DEFAULT_LINK" ] && [ ! -L "$DEFAULT_LINK" ]; then
    die "$DEFAULT_LINK exists as a real directory, not a symlink.
It is probably an existing single-account gws install. Adopt it first:
  gws-account migrate <name-for-it>"
  fi

  mkdir -p "$(dirname "$DEFAULT_LINK")"
  ln -sfn "$dir" "$DEFAULT_LINK"
  info "default account is now '$name' ($DEFAULT_LINK -> $dir)"
}

cmd_client() {
  local src="${1:-}"
  [ -n "$src" ] || die "usage: gws-account client <client_secret.json>"
  [ -f "$src" ] || die "no such file: $src"
  grep -q '"client_id"' "$src" || die "$src does not look like an OAuth client JSON (no client_id)."
  mkdir -p "$ACCOUNTS_HOME"
  install -m 600 "$src" "$SHARED_CLIENT"
  info "installed shared OAuth client at $SHARED_CLIENT"
  # Backfill into any accounts created before the client existed.
  local dir
  for dir in "$ACCOUNTS_HOME"/*/; do
    [ -d "$dir" ] || continue
    install -m 600 "$SHARED_CLIENT" "${dir}client_secret.json"
  done
}

cmd_add() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account add <name>   (letters, digits, . _ - only)"
  need_gws
  require_shared_client

  local dir
  dir="$(acct_dir "$name")"
  [ -d "$dir" ] && die "account '$name' already exists. Use 'gws-account login $name' to re-auth."

  mkdir -p "$dir"
  chmod 700 "$dir"
  install -m 600 "$SHARED_CLIENT" "$dir/client_secret.json"
  info "created account '$name' at $dir"

  # First account added becomes the default automatically.
  if ! current_default >/dev/null 2>&1; then
    set_default "$name"
  fi

  cmd_login "$name"
}

cmd_login() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account login <name>"
  need_gws
  local dir
  dir="$(acct_dir "$name")"
  [ -d "$dir" ] || die "no such account: $name"

  info ""
  info "Opening OAuth consent for account '$name'."
  info "Sign in with the Google account you want '$name' to refer to —"
  info "gws cannot verify which account you pick, so choosing the wrong one"
  info "silently binds these credentials to it."
  info ""
  GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" gws auth login -s "$GWS_SERVICES"

  info ""
  info "'$name' is now: $(acct_email "$dir")"
}

cmd_list() {
  [ -d "$ACCOUNTS_HOME" ] || die "no accounts yet. Run: gws-account add <name>"
  local def dir name marker
  def="$(current_default 2>/dev/null || printf '')"
  local found=0
  for dir in "$ACCOUNTS_HOME"/*/; do
    [ -d "$dir" ] || continue
    found=1
    name="$(basename "$dir")"
    if [ "$name" = "$def" ]; then marker="*"; else marker=" "; fi
    printf '%s %-14s %s\n' "$marker" "$name" "$(acct_email "${dir%/}")"
  done
  [ "$found" = 1 ] || die "no accounts yet. Run: gws-account add <name>"
  printf '\n(* = default; used by a bare `gws ...`)\n'
}

cmd_use() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account use <name>"
  set_default "$name"
}

cmd_run() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account run <name> -- <gws args...>"
  shift
  [ "${1:-}" = "--" ] && shift
  need_gws
  local dir
  dir="$(acct_dir "$name")"
  [ -d "$dir" ] || die "no such account: $name"
  GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" exec gws "$@"
}

cmd_status() {
  need_gws
  if [ -n "${1:-}" ]; then
    local dir
    dir="$(acct_dir "$1")"
    [ -d "$dir" ] || die "no such account: $1"
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" exec gws auth status
  fi
  local dir name
  for dir in "$ACCOUNTS_HOME"/*/; do
    [ -d "$dir" ] || continue
    name="$(basename "$dir")"
    printf '=== %s ===\n' "$name"
    GOOGLE_WORKSPACE_CLI_CONFIG_DIR="${dir%/}" gws auth status 2>&1 || true
    printf '\n'
  done
}

cmd_path() {
  if [ -n "${1:-}" ]; then
    local dir
    dir="$(acct_dir "$1")"
    [ -d "$dir" ] || die "no such account: $1"
    printf '%s\n' "$dir"
  else
    local def
    def="$(current_default 2>/dev/null)" || die "no default account set"
    printf '%s\n' "$(acct_dir "$def")"
  fi
}

cmd_remove() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account remove <name>"
  need_gws
  local dir
  dir="$(acct_dir "$name")"
  [ -d "$dir" ] || die "no such account: $name"

  printf 'Remove account "%s" (%s) and its stored credentials? [y/N] ' "$name" "$dir" >&2
  local reply; read -r reply
  case "$reply" in [yY]*) ;; *) die "aborted" ;; esac

  # Revoke the token before deleting the files that hold it.
  GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" gws auth logout >/dev/null 2>&1 || true
  rm -rf "$dir"
  info "removed account '$name'"

  # If it was the default, the symlink now dangles — repoint or clear it.
  if [ -L "$DEFAULT_LINK" ] && [ ! -e "$DEFAULT_LINK" ]; then
    local other
    other="$(find "$ACCOUNTS_HOME" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; 2>/dev/null | head -1)"
    if [ -n "$other" ]; then
      set_default "$other"
    else
      rm -f "$DEFAULT_LINK"
      info "no accounts left; cleared $DEFAULT_LINK"
    fi
  fi
}

cmd_migrate() {
  local name="${1:-}"
  valid_name "$name" || die "usage: gws-account migrate <name>"
  [ -d "$DEFAULT_LINK" ] && [ ! -L "$DEFAULT_LINK" ] || die "$DEFAULT_LINK is not a real directory; nothing to migrate."
  local dir
  dir="$(acct_dir "$name")"
  [ -e "$dir" ] && die "account '$name' already exists"
  mkdir -p "$ACCOUNTS_HOME"
  mv "$DEFAULT_LINK" "$dir"
  info "moved existing config $DEFAULT_LINK -> $dir"
  if [ -f "$dir/client_secret.json" ] && [ ! -f "$SHARED_CLIENT" ]; then
    install -m 600 "$dir/client_secret.json" "$SHARED_CLIENT"
    info "adopted its OAuth client as the shared client"
  fi
  set_default "$name"
}

usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; }

case "${1:-}" in
  add)     shift; cmd_add "$@" ;;
  list|ls) shift; cmd_list "$@" ;;
  use|default) shift; cmd_use "$@" ;;
  run)     shift; cmd_run "$@" ;;
  login)   shift; cmd_login "$@" ;;
  status)  shift; cmd_status "$@" ;;
  path)    shift; cmd_path "$@" ;;
  remove|rm) shift; cmd_remove "$@" ;;
  client)  shift; cmd_client "$@" ;;
  migrate) shift; cmd_migrate "$@" ;;
  ''|-h|--help|help) usage ;;
  *) die "unknown command: $1 (try --help)" ;;
esac
