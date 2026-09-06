# gws shell integration — source this from ~/.zshrc or ~/.bashrc:
#
#     source ~/.config/gws-accounts/shell.sh
#
# Gives you an @account prefix on top of the real gws binary:
#
#     gws drive files list              # default account
#     gws @work drive files list        # one-off, as 'work'
#     gws-account use work              # change the default
#
# The default account works without this file too — ~/.config/gws is a symlink
# to it, so scripts, cron jobs and agents that call `gws` directly get it as
# well. This wrapper only adds the @-prefix override.

gws() {
  local accounts_home="${GWS_ACCOUNTS_HOME:-$HOME/.config/gws-accounts}"

  case "${1:-}" in
    @)
      gws-account list
      return
      ;;
    @*)
      local name="${1#@}"
      local dir="$accounts_home/$name"
      if [ ! -d "$dir" ]; then
        printf 'gws: no such account: %s\n' "$name" >&2
        printf 'known accounts:\n' >&2
        gws-account list >&2
        return 1
      fi
      shift
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR="$dir" command gws "$@"
      return
      ;;
  esac

  command gws "$@"
}

# Short alias for the account manager.
alias gwsa='gws-account'
