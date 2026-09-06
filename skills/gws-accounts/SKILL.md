---
name: gws-accounts
description: "gws CLI: Target a specific Google account when several are configured. Use whenever a gws command should run against a named account rather than the default, or when the user names an account, says 'my work account' / 'my other account', or asks which Google accounts are connected."
metadata:
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
        - gws-account
    cliHelp: "gws-account --help"
---

# gws — Multiple accounts

The `gws` CLI has no built-in account switching. This machine adds it: each
Google account has its own config directory under `~/.config/gws-accounts/`,
selected by the `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` environment variable.

## Which account am I using?

```bash
gws-account list
```

Prints every account with the real Google address behind it, marking the
default with `*`. Run this first whenever it is unclear which account a request
refers to, or when the user names an account you have not seen before.

## Running a command as a specific account

**Use `gws-account run`.** It works in every shell:

```bash
gws-account run work -- drive files list
gws-account run work -- gmail +triage
gws-account run personal -- calendar +agenda
```

Everything after `--` is passed to `gws` unchanged, so any `gws` command from
the other gws skills works — just move it after the `--`.

> The `gws @work ...` form documented for humans is a **shell function** defined
> in the user's interactive shell profile. Non-interactive shells do not load
> it, so `gws @work ...` fails here. Always use `gws-account run` instead.

## Running as the default account

Plain `gws` already uses the default account — `~/.config/gws` is a symlink to
it — so no prefix or environment variable is needed:

```bash
gws drive files list
```

## Choosing the right account

- The user names an account ("my work account", "on personal") → use
  `gws-account run <name> -- ...`.
- The user says nothing about accounts → use the default with plain `gws`.
- The request mentions a specific email address → run `gws-account list` to map
  that address to an account name, then use that name.
- **Do not guess between accounts.** If the request could plausibly mean either,
  ask which one before acting — this is especially important for anything that
  sends, shares, deletes or modifies data.

## Managing accounts

```bash
gws-account list             # accounts and their emails; * marks the default
gws-account use <name>       # change the default account
gws-account add <name>       # connect another Google account (opens a browser)
gws-account login <name>     # re-authenticate an existing account
gws-account status           # auth state for every account
```

`add` and `login` open a browser for Google's consent flow and need a human, so
do not run them unattended — tell the user to run them instead.

## Troubleshooting

- **`invalid_grant`, or an account that worked last week and now fails.** The
  OAuth app is in Testing mode, where Google revokes refresh tokens after 7
  days. The user must run `gws-account login <name>`. The permanent fix is to
  set the app's publishing status to "In production" at
  https://console.cloud.google.com/auth/audience
- **A 403 naming an API that is not enabled.** The error contains a direct link
  to enable it; pass that link to the user.
- **`gws: unknown account`, or `@name` treated as a command.** The shell
  function is not loaded. Use `gws-account run <name> -- ...`.
