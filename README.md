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

Full walkthrough, including the Google Cloud project and OAuth setup:
**[docs/google-workspace-cli.md](docs/google-workspace-cli.md)**

| Script | Purpose |
|---|---|
| `scripts/gws-install.sh` | Installs `gws`, the account manager, shell integration, and optionally the gws Claude Code skills |
| `scripts/gws-account.sh` | Account manager — `add`, `list`, `use`, `run`, `login`, `status`, `remove`, `migrate` |
| `scripts/gws-shell.sh` | Shell integration providing the `gws @account ...` prefix |
