# sss

Personal tooling.

## Sefaria book downloader

Sefaria shows a book one section at a time. This pulls the whole thing through
Sefaria's API and saves it as one readable file, with chapter headings kept and
markup and footnotes removed (footnotes can be kept as endnotes if you want them).
Hebrew text reads right to left.

**Point and click:** double-click `scripts/Sefaria to Text.command` in Finder
(or run `./scripts/sefaria-book.py` with no arguments). A page opens in your
browser. Paste a Sefaria link, pick `.txt` / `.md` / `.html`, and click
**Download book**. Files go to `~/Books` unless you choose another folder. Keep
the Terminal window it opens running while you use the page.

**Terminal:**

```bash
./scripts/sefaria-book.py "https://www.sefaria.org/The_Great_Partnership;_God,_Science,_and_the_Search_for_Meaning?tab=contents" -o ~/Books
./scripts/sefaria-book.py "Mesillat Yesharim" --lang he --format txt,md,html
```

Writes `<Title>.txt` and `.md` by default. `--format` also takes `html` and
`pdf` (the PDF is printed by Chrome/Chromium if installed; `CHROME_BIN` to point
at it).

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
| `scripts/sefaria-book.py` | Downloads a whole Sefaria book as txt / md / html / pdf; no arguments opens the page |
| `scripts/sefaria-book-ui.html` | The point-and-click page `sefaria-book.py` serves |
| `scripts/Sefaria to Text.command` | Double-click launcher for the page on macOS |
| `mcp/gws_mcp_server.py` | Zero-dependency MCP server exposing both accounts to Claude Desktop |
