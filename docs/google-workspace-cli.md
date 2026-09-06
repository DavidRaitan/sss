# Google Workspace CLI (`gws`) — setup with multiple accounts

[`gws`](https://github.com/googleworkspace/cli) is Google's official CLI for
Google Workspace. It builds its command surface at runtime from Google's
Discovery Service, so it covers essentially every Workspace API — Gmail, Drive,
Calendar, Docs, Sheets, Slides, Tasks, Chat, People and more — plus hand-written
helpers like `gws gmail +send` and `gws calendar +agenda`.

It has **no built-in notion of profiles or accounts**: it reads one config
directory, chosen by `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` (default `~/.config/gws`).
The scripts in `scripts/` add multi-account support on top of that.

## How multi-account works here

```
~/.config/gws-accounts/
├── client_secret.json     shared OAuth client, used by every account
├── personal/              ← one config dir per account
│   ├── client_secret.json
│   └── credentials.json   (encrypted, AES-256-GCM)
└── work/
    └── ...

~/.config/gws -> ~/.config/gws-accounts/personal      ← the default account
```

The default account is a **symlink**, not an environment variable. That matters:
`gws` resolves `~/.config/gws` itself, so a bare `gws ...` picks up the default
everywhere — interactive shells, scripts, cron jobs, and agents like Claude Code
— with nothing to export. The `@account` prefix overrides it per command.

---

## 1. Install

```bash
git clone https://github.com/davidraitan/sss.git
cd sss
./scripts/gws-install.sh --with-skills
```

This installs the `gws` binary (via Homebrew, npm or cargo — whichever you
have), the `gws-account` manager into `~/.local/bin`, and shell integration into
your `~/.zshrc` or `~/.bashrc`. `--with-skills` also copies the upstream
[gws Claude Code skills](https://github.com/googleworkspace/cli/tree/main/skills)
into `~/.claude/skills`, so Claude Code knows how to drive the CLI.

Then restart your shell, or `source ~/.zshrc`.

## 2. Create a Google Cloud project and OAuth client

`gws` talks to Google's APIs as *your own* OAuth application, so you need a
Google Cloud project. This is free and takes about five minutes.

If you have the [`gcloud` CLI](https://cloud.google.com/sdk/docs/install)
installed, `gws auth setup` automates most of this. Otherwise, do it by hand:

1. Create a project at [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
   Name it anything — `gws-cli` works.

2. **Enable the APIs you want.** In *APIs & Services → Library*, enable each of:
   Google Drive API, Google Docs API, Google Sheets API, Gmail API, Google
   Calendar API. Nothing works until the matching API is enabled; `gws` prints a
   direct enable-link when it hits a disabled one, so you can also do this
   lazily.

3. **Configure the OAuth consent screen** (*APIs & Services → OAuth consent screen*):
   - User type: **External**
   - Fill in app name and your email; you can skip the optional fields.
   - Leave it in **Testing** mode — you do not need Google verification.

4. **Add every account as a Test user.** On the consent screen, go to
   *Test users → Add users* and enter each Gmail address you plan to connect.
   **Do this for all of them, including the first.** An account that is not
   listed fails login with a generic "Access blocked" error that does not
   explain the cause.

5. **Create the OAuth client** (*APIs & Services → Credentials → Create
   credentials → OAuth client ID*):
   - Application type: **Desktop app**
   - Download the JSON.

One client serves all your accounts — you do not need a project per account.

## 3. Install the client and add accounts

```bash
gws-account client ~/Downloads/client_secret_1234-abcd.json

gws-account add personal     # the first account added becomes the default
gws-account add side
```

Each `add` opens a browser for Google's consent flow. Two things to watch:

- **Pick the right Google account in the browser.** `gws` stores whatever
  account you sign in as; it cannot check that it matches the name you typed.
  Signing into the wrong one silently binds those credentials to that name.
- On the "Google hasn't verified this app" screen, click **Advanced → Continue**.
  That warning is expected for a testing-mode app; it is your own client.

Verify with `gws-account list`, which shows the real email behind each name:

```
* personal       you@gmail.com
  side           you.side@gmail.com

(* = default; used by a bare `gws ...`)
```

## 4. Daily use

```bash
# The default account — no prefix needed
gws drive files list
gws gmail +triage
gws calendar +agenda

# A specific account, one command at a time
gws @side drive files list
gws @side gmail +send --to a@b.com --subject Hi --body "hello"

# Manage accounts
gws-account list             # who is who, and which is default
gws-account use side         # change the default
gws-account add third        # connect another account
gws-account login personal   # re-run consent (e.g. to add scopes)
gws-account status           # auth state for every account
gws-account remove side      # revoke and delete
```

Anything not prefixed with `@` goes to the default account, including calls made
by scripts and by Claude Code.

### Useful command shapes

```bash
gws drive files list --params '{"pageSize": 100}' --page-all | jq -r '.files[].name'
gws sheets +read <spreadsheet-id> --range 'Sheet1!A1:D20'
gws docs +write <doc-id> --text "appended line"
gws drive +upload ./report.pdf
gws schema drive.files.list          # inspect any method's request/response
```

---

## Scopes, and the testing-mode limit

Accounts are authorized with the services in `GWS_SERVICES`, which defaults to:

```
drive,docs,sheets,gmail,calendar
```

That flag (`gws auth login -s ...`) filters the scope picker; you tick the
specific read/write scopes you want on the consent screen.

**A testing-mode OAuth app is capped at roughly 25 scopes per consent.** For
`@gmail.com` accounts this is the limit you will hit, and it is why
`gws auth login --full` (the 85+ scope `recommended` preset) fails there. Two
consequences:

- Select the scopes you need rather than "select all" — full read/write on
  Drive, Docs, Sheets, Gmail and Calendar fits comfortably.
- To narrow further, set the variable before adding an account:
  ```bash
  GWS_SERVICES=drive,docs,sheets gws-account add personal
  ```

To change scopes later, re-run `gws-account login <name>` and re-consent.

## Where credentials live

Tokens are encrypted at rest with AES-256-GCM. The key comes from your OS
keyring (Keychain on macOS), falling back to `.encryption_key` inside the config
directory. Note that the keyring entry is keyed as `("gws-cli", $USER)` — one key
shared across accounts — but each account's *credentials* live in its own
directory, so the accounts stay properly separated.

On a headless machine with no keyring, set `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND=file`.

Never commit `client_secret.json` or any `credentials.json`. Everything lives
under `~/.config/`, outside this repo, and `.gitignore` blocks them anyway.

## Environment variables

| Variable | Purpose |
|---|---|
| `GWS_ACCOUNTS_HOME` | Account root (default `~/.config/gws-accounts`) |
| `GWS_SERVICES` | Services offered in the scope picker on `add`/`login` |
| `GWS_BIN_DIR` | Where `gws-account` is installed (default `~/.local/bin`) |
| `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` | Config dir for one invocation — what `@name` sets |
| `GOOGLE_WORKSPACE_CLI_TOKEN` | Pre-obtained access token; **overrides everything else** |
| `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE` | Credentials/service-account JSON path |
| `GOOGLE_WORKSPACE_CLI_KEYRING_BACKEND` | `keyring` (default) or `file` |

Auth precedence is: `_TOKEN` → `_CREDENTIALS_FILE` → encrypted credentials →
plaintext `credentials.json`. If `@account` seems to be ignored, check whether
one of the first two is set in your environment — they win over the config dir.

## Troubleshooting

**"Access blocked" / "app not verified" on login.** The account is not in the
consent screen's *Test users* list. Add it, then re-run `gws-account login <name>`.

**Login fails asking for too many scopes.** Testing-mode scope cap. Re-run with a
shorter list: `GWS_SERVICES=drive,docs,sheets gws-account login <name>`.

**A 403 mentioning an API that is not enabled.** Enable it in the Cloud Console;
the error text contains a direct link.

**`gws @name` says "no such account"** but the name exists — `gws` is resolving
to the raw binary rather than the shell function. Confirm the integration is
loaded (`type gws` should print "function"), then `source ~/.zshrc`.

**Commands hit the wrong account.** Run `gws-account list` — it reports the real
email per account, which catches a login into the wrong Google account.

**An existing single-account install is in the way.** If `~/.config/gws` is a
real directory, `gws-account` refuses to replace it. Adopt it as an account:
`gws-account migrate <name>`.

## Upgrading

```bash
brew upgrade googleworkspace-cli     # or: npm update -g @googleworkspace/cli
```

Then re-run `./scripts/gws-install.sh` to refresh `gws-account` and the skills.
