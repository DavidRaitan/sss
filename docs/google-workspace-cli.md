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

From a clone of this repo:

```bash
git clone https://github.com/davidraitan/sss.git
cd sss
./scripts/gws-install.sh --with-skills
```

Or, from the three scripts saved anywhere on disk — they only need to sit in the
same directory:

```bash
chmod +x gws-install.sh gws-account.sh
./gws-install.sh --with-skills
```

This installs the `gws` binary (via Homebrew, npm or cargo — whichever you
have), the `gws-account` manager into `~/.local/bin`, and shell integration into
your `~/.zshrc` or `~/.bashrc`. `--with-skills` also copies the upstream
[gws Claude Code skills](https://github.com/googleworkspace/cli/tree/main/skills)
into `~/.claude/skills`, so Claude Code knows how to drive the CLI.

Then restart your shell, or `source ~/.zshrc`.

## 2. Create the Google Cloud project and OAuth client (Console)

`gws` talks to Google's APIs as *your own* OAuth application, so you need a
Google Cloud project. It is free, and takes about ten minutes of clicking.

> `gws auth setup` can automate parts of this, but it requires the `gcloud` CLI.
> The steps below are the manual equivalent and need no local tooling at all —
> `gws-account` never calls `gcloud`.

Google reorganized this area of the Console in 2025: what used to be
*APIs & Services → OAuth consent screen* is now **Google Auth Platform**, split
into **Branding**, **Audience**, **Data access** and **Clients**. Old links still
redirect, but the page names below are the current ones.

### 2.1 Create a project

Go to [console.cloud.google.com/projectcreate](https://console.cloud.google.com/projectcreate).
Name it anything — `gws-cli` is fine. Note the **project ID** it generates; the
links below take `?project=PROJECT_ID`.

### 2.2 Enable the APIs

Nothing works until the matching API is enabled for the project. Open each and
click **Enable**:

| API | Link |
|---|---|
| Google Drive | [drive.googleapis.com](https://console.cloud.google.com/apis/library/drive.googleapis.com) |
| Google Docs | [docs.googleapis.com](https://console.cloud.google.com/apis/library/docs.googleapis.com) |
| Google Sheets | [sheets.googleapis.com](https://console.cloud.google.com/apis/library/sheets.googleapis.com) |
| Gmail | [gmail.googleapis.com](https://console.cloud.google.com/apis/library/gmail.googleapis.com) |
| Google Calendar | [calendar-json.googleapis.com](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) |

Make sure the project selector at the top is on your new project. You can also
do this lazily — `gws` prints a direct enable-link when it hits a disabled API.

### 2.3 Configure Branding

Open **[Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding)**.
If the project has never been configured, you get a **Get started** wizard
instead; fill in the same fields.

- **App name**: anything, e.g. `gws-cli`
- **User support email**: your own address
- **Audience**: **External** (required for `@gmail.com` accounts; *Internal*
  only exists for Workspace domains)
- **Contact information**: your own address

### 2.4 Add your accounts as test users

Open **[Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience)**.
This page holds both the publishing status and the test user list.

Under **Test users**, click **Add users** and enter **every Gmail address you
plan to connect** — including the first one. The cap is 100.

> An account that is not on this list fails login with a generic
> **"Access blocked"** screen that never explains the cause. This is the single
> most common reason setup stalls.

### 2.5 Create the OAuth client

Open **[Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)**
→ **Create client** (direct link:
[/auth/clients/create](https://console.cloud.google.com/auth/clients/create)).

- **Application type**: **Desktop app** — this matters. `gws` completes OAuth
  through a localhost callback, which is what the Desktop type allows. A "Web
  application" client will fail with `redirect_uri_mismatch`.
- **Name**: anything.

Create it, then **Download JSON**. One client serves all your accounts — you do
not need a project or client per account.

### 2.6 Decide on publishing status

See [The 7-day refresh token problem](#the-7-day-refresh-token-problem) below
before you settle on **Testing**. It is the one decision here worth making
deliberately.

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

## 4. Daily use (your shell)

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

## 5. Using it from Claude Code

`gws` is a CLI, not an MCP server. It reaches Claude through **skills** — plain
Markdown files in `~/.claude/skills/` that teach Claude how to drive the
commands. The installer puts them there:

- `gws-accounts` — the multi-account skill from this repo. **Always installed.**
- ~50 upstream skills (`gws-gmail`, `gws-drive`, `gws-calendar`, …) — installed
  with `--with-skills`.

The `gws-accounts` skill is not optional decoration. The upstream skills know
nothing about `gws-account`, so without it Claude only ever uses your default
account, silently, even when you asked for a different one.

Once installed, just ask in plain language:

> "What's unread in my work inbox?"
> "Copy the Q3 numbers from my personal Drive into a new sheet"
> "What's on my calendar tomorrow across both accounts?"

To cut permission prompts, allowlist these in `~/.claude/settings.json`:

```json
{ "permissions": { "allow": ["Bash(gws:*)", "Bash(gws-account:*)"] } }
```

### Why Claude uses `gws-account run`, not `gws @name`

The `@account` prefix is a **shell function**, defined only in interactive
shells that source your rc file. Claude Code runs commands in non-interactive
shells, which do not load it — so `gws @work ...` fails there. The `gws-accounts`
skill tells Claude to use the real executable instead:

```bash
gws-account run work -- gmail +triage
```

Both forms do the same thing. Use `@work` yourself; let Claude use
`gws-account run`.

### How this differs from the Google Drive connector

The Drive connector on claude.ai is a separate, single-account integration.
It cannot hold several Google accounts at once, and it does not cover Gmail or
Calendar. Keep it if you use it — the two do not conflict — but multi-account
read/write is what this setup is for.

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

Note that this cap tracks *unverified*, not *testing*. Publishing the app to
production (Option B below) stops refresh tokens expiring, but the app stays
unverified, so assume the scope limit still applies and keep selecting scopes
rather than taking all of them.

## The 7-day refresh token problem

This is the biggest operational gotcha, and it is not obvious from the CLI.

**While your app's publishing status is "Testing" and its audience is
"External", Google revokes every refresh token after exactly 7 days.** When that
happens, `gws` fails with `invalid_grant`, and you have to re-run
`gws-account login <name>` for *each* account, weekly.

You have two options.

### Option A — stay in Testing, re-auth weekly

Nothing more to configure. When a command starts failing with `invalid_grant`:

```bash
gws-account login personal
```

Fine if you use the CLI occasionally. Annoying as a daily driver, and it scales
badly with the number of accounts.

### Option B — publish the app (recommended for daily use)

On **[Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience)**,
under *Publishing status*, click **Publish app** to move it to **In production**.
Refresh tokens then stop expiring on a timer.

What this does and does not mean:

- You are **not** submitting for verification, and you do not need a security
  audit. The app stays unverified.
- Because it is unverified, the consent screen keeps showing
  **"Google hasn't verified this app"** — click *Advanced → Continue*. That
  warning is about your own client; it is expected.
- Unverified apps requesting sensitive or restricted scopes (Gmail and full
  Drive are both restricted) are capped at 100 users. Irrelevant when the users
  are your own accounts.
- Full verification — with the security audit — is only needed to remove the
  warning screen and distribute the app to the public. You are not doing that.

Google can tighten this behaviour for restricted scopes, so treat Option B as
"works today, verify it still holds if logins start expiring again." If publish
is blocked for your project, fall back to Option A.

Either way, the tokens themselves are unaffected by *which* option you pick —
only how long they live.

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

**"Access blocked" on login.** The account is not in the *Test users* list on
[Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience).
Add it, then re-run `gws-account login <name>`.

**"Google hasn't verified this app".** Expected — it is your own unverified
client. Click *Advanced → Continue*.

**`invalid_grant`, or an account that worked last week and now does not.** The
7-day testing-mode refresh token expiry. Re-run `gws-account login <name>`, and
see [The 7-day refresh token problem](#the-7-day-refresh-token-problem) to stop
it recurring.

**`redirect_uri_mismatch`.** The OAuth client is the wrong type. `gws` needs a
**Desktop app** client, not a Web application one. Create a new one on
[Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients)
and re-run `gws-account client <new.json>`.

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
