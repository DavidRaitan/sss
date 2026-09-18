# sss

Personal tooling.

## Google Workspace CLI

Setup for [`gws`](https://github.com/googleworkspace/cli), Google's official
Workspace CLI, with multi-account support layered on top (it has none of its
own) — read and write Gmail, Drive, Calendar, Docs and Sheets from several
Google accounts, with one of them as the default.

```bash
./scripts/gws-install.sh --with-skills
gws-account client ~/Downloads/client_secret_*.json
gws-account add personal
gws-account add side

gws drive files list           # default account
gws @side drive files list     # a specific account
```

From Claude Code, just ask — "check my work inbox", "list files in my personal
Drive". The installed `gws-accounts` skill is what lets Claude target a specific
account instead of always using the default.

Full walkthrough, including the Google Cloud project and OAuth setup:
**[docs/google-workspace-cli.md](docs/google-workspace-cli.md)**

**Claude Desktop:** its chat has no shell and loads no skills, so it needs the
bundled MCP server to reach either account —
**[docs/claude-desktop-mcp.md](docs/claude-desktop-mcp.md)**

| Script | Purpose |
|---|---|
| `scripts/gws-install.sh` | Installs `gws`, the account manager, shell integration, and optionally the gws Claude Code skills |
| `scripts/gws-account.sh` | Account manager — `add`, `list`, `use`, `run`, `login`, `status`, `remove`, `migrate` |
| `scripts/gws-shell.sh` | Shell integration providing the `gws @account ...` prefix |
| `skills/gws-accounts/` | Claude Code skill teaching Claude to target a named account |
| `skills/gws-my-accounts/` | Which account a task belongs to (YouTube/Descript vs. default) |
| `mcp/gws_mcp_server.py` | Zero-dependency MCP server exposing both accounts to Claude Desktop |

## Wedding invitations

A couple's invitation site in one HTML file — their printed invitation, the
date and venue, calendar buttons, a map, and an RSVP form that writes to
their own Google Sheet, in as many languages as they want.

```bash
./scripts/install-skills.sh wedding-invitation   # then restart Claude Code
```

From Claude Code, hand it the couple's details and their invitation
pictures and ask for the site. Built ones live in
**[sites/invitations/](sites/invitations/)**.

| Script | Purpose |
|---|---|
| `scripts/install-skills.sh` | Installs this repo's skills into `~/.claude/skills` (`--list` to see what is there) |
| `skills/wedding-invitation/` | Claude Code skill: the site template, the image embedder, and the RSVP spreadsheet |
