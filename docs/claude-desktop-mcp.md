# Using both Google accounts in Claude Desktop

Claude Desktop does support Skills — but a skill is not enough here, and the
reason is *where the code runs*. Desktop skills execute in Claude's sandbox, not
on your Mac, so they cannot invoke `gws` and cannot reach the OAuth tokens under
`~/.config/gws-accounts`, which are encrypted against your login keychain.

An MCP server runs as a process **on your machine**. That is the whole reason
this route works. The server runs `gws` locally and carries the account-routing
rules in its tool descriptions, since it cannot rely on the
`~/.claude/skills` files that only Claude Code reads.

Requires the `gws` setup from [google-workspace-cli.md](google-workspace-cli.md)
to be working first. Verify with `gws-account list`.

## Install

The server is a single Python file with **no dependencies** — no npm, no pip, no
virtualenv. It runs under the python3 that ships with macOS.

### The easy way

```bash
python3 ~/sss/scripts/gws-desktop-setup.py
```

It finds the config file, merges in the `google-workspace` entry while keeping
every other server you have, backs up the original, and fills in the absolute
paths to python3, the server and `gws`. Add `--dry-run` to see the result
without writing. Then quit Claude Desktop with ⌘Q and reopen.

### By hand

1. Open Claude Desktop → **Settings → Developer → Edit Config**, or edit
   `~/Library/Application Support/Claude/claude_desktop_config.json` directly.

2. Add the `google-workspace` entry. **If the file already has `mcpServers`,
   add this server inside it rather than replacing the block** — otherwise you
   remove every other server you have configured.

   ```json
   {
     "mcpServers": {
       "google-workspace": {
         "command": "/usr/bin/python3",
         "args": ["/Users/YOU/sss/mcp/gws_mcp_server.py"],
         "env": {
           "GWS_BIN": "/opt/homebrew/bin/gws"
         }
       }
     }
   }
   ```

   Use the **absolute** path to the script. `GWS_BIN` is worth setting
   explicitly: a desktop app does not inherit your shell's PATH, so `gws` is
   usually not on it. `which gws` in a terminal gives the value.

3. Quit Claude Desktop completely (⌘Q — closing the window is not enough) and
   reopen it. The tools appear under the connector icon.

## Tools

| Tool | Does |
|---|---|
| `list_accounts` | Account names and the email behind each |
| `drive_search` | Find Drive files by name |
| `drive_list_recent` | Most recently modified files |
| `doc_read` | Read a Google Doc's text |
| `doc_append` | Append text to a Doc |
| `sheet_read` | Read cells in A1 notation |
| `sheet_append` | Append a row |
| `gws_run` | Escape hatch for any other `gws` subcommand |

Every tool takes an optional `account`. Omitted, it uses the default account
(whatever `~/.config/gws` points at).

## Account routing

The `account` parameter's description tells Claude the rule: **`torah` for
YouTube, Descript, video, the channel and Torah Meirah content; the default for
everything else**, with subject matter deciding rather than file type, and a
question to the user rather than a guess when it is ambiguous.

This duplicates the `gws-my-accounts` skill on purpose. Claude Code reads that
skill off disk; this server cannot rely on it, so it carries the same rules
itself. Changing the routing means changing
**both** — the skill in `skills/gws-my-accounts/SKILL.md` and `ACCOUNT_RULE` in
`mcp/gws_mcp_server.py`.

## What is deliberately not exposed

`gws auth ...` is refused. Those commands change authentication state and need a
browser, so they cannot succeed unattended, and a stray `auth logout` would
silently disconnect an account. Re-authentication happens in a terminal:

```bash
GWS_SERVICES=drive,docs,sheets gws-account login <account>
```

## Troubleshooting

The server writes nothing to the screen — it speaks JSON-RPC on stdin/stdout.
To see what it does, run it by hand and paste one line in:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  GWS_BIN=/opt/homebrew/bin/gws python3 ~/sss/mcp/gws_mcp_server.py
```

A JSON blob listing eight tools means the server itself is fine and the problem
is in the Desktop config.

**Server does not appear in Desktop.** Almost always the config: invalid JSON
(a trailing comma), a relative script path, or the app not fully quit. Check the
file parses with `python3 -m json.tool < ~/Library/Application\ Support/Claude/claude_desktop_config.json`.

**"The gws CLI was not found".** Set `GWS_BIN` in the server's `env` block to the
output of `which gws`.

**"invalid_grant".** The weekly Testing-mode token expiry. The error text names
the command to run; it needs a terminal and a browser.

**403 mentioning serviceusage.** That account is not a member of the Cloud
project. See
[google-workspace-cli.md](google-workspace-cli.md#accounts-that-do-not-own-the-project-need-one-iam-grant).
