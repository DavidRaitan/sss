#!/usr/bin/env bash
# install-skills — copy this repo's Claude Code skills into ~/.claude/skills
#
# Usage: scripts/install-skills.sh [name ...]
#   With no names, every skill in skills/ is installed.
#   Names install just those: scripts/install-skills.sh wedding-invitation
#
# Options:
#   --dir <path>   install somewhere else (default: ~/.claude/skills)
#   --list         show what is in skills/ and what is installed, change nothing
#
# Re-running is how you update: each skill is replaced whole.
# Restart Claude Code afterwards — skills are read at startup.

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SRC_DIR="$SCRIPT_DIR/../skills"
SKILLS_DIR="${CLAUDE_SKILLS_DIR:-$HOME/.claude/skills}"
LIST_ONLY=0

die() { printf 'error: %s\n' "$*" >&2; exit 1; }
info() { printf '%s\n' "$*"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --dir) SKILLS_DIR="${2:-}"; shift 2 ;;
    --list) LIST_ONLY=1; shift ;;
    -h|--help) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) die "unknown option: $1" ;;
    *) break ;;
  esac
done

[ -d "$SRC_DIR" ] || die "no skills/ directory at $SRC_DIR"

if [ "$LIST_ONLY" = 1 ]; then
  for sk in "$SRC_DIR"/*/; do
    [ -f "${sk}SKILL.md" ] || continue
    name="$(basename "$sk")"
    if [ -f "$SKILLS_DIR/$name/SKILL.md" ]; then
      info "$name  (installed in $SKILLS_DIR)"
    else
      info "$name  (not installed)"
    fi
  done
  exit 0
fi

# Which skills to install: the ones named, or all of them.
names=("$@")
if [ "${#names[@]}" = 0 ]; then
  for sk in "$SRC_DIR"/*/; do
    [ -f "${sk}SKILL.md" ] || continue
    names+=("$(basename "$sk")")
  done
fi
[ "${#names[@]}" != 0 ] || die "no skills found in $SRC_DIR"

mkdir -p "$SKILLS_DIR"

for name in "${names[@]}"; do
  src="$SRC_DIR/$name"
  [ -f "$src/SKILL.md" ] || die "no such skill: $name (looked in $src)"
  dest="$SKILLS_DIR/$name"
  # Spell the destination out in full. `cp -R src/ dest/` copies a directory's
  # *contents* on BSD cp, which scatters each skill's files into one directory;
  # naming the destination behaves the same on macOS and Linux.
  rm -rf "$dest"
  cp -R "$src" "$dest"
  # A skill Claude cannot read is worse than a loud failure.
  [ -f "$dest/SKILL.md" ] || die "failed to install '$name': $dest/SKILL.md missing after copy"
  info "installed $dest"
done

info ""
info "Restart Claude Code to pick them up."
