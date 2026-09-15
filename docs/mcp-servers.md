# Extra MCP servers

Three general-purpose servers, kept alongside the `google-workspace` one:

| Server | Gives Claude | Needs |
|---|---|---|
| `gutenberg` | Search and read public-domain books from Project Gutenberg | `npx` |
| `youtube-transcript` | Transcripts for YouTube videos | `uvx` |
| `firecrawl` | Scrapes and crawls web pages into clean markdown | `npx` + an API key |

All three are **stdio** servers: Claude starts them as processes on this
machine and talks to them over stdin/stdout. That decides where they can go.

| Surface | Works? |
|---|---|
| Claude Desktop | Yes — `scripts/mcp-add.py` below |
| Claude Code | Yes — the `.mcp.json` in this repo |
| claude.ai on the web | **No** |

The web app has no machine of yours to run `npx` or `uvx` on, so it accepts
only *remote* servers — ones reachable at an HTTPS URL, added under
**Settings → Connectors → Add custom connector**. A stdio config cannot be
converted into one; it would need the server hosted somewhere public first.

## Claude Desktop

```bash
export FIRECRAWL_API_KEY=fc-...        # from firecrawl.dev; skip if you
                                        # are not adding firecrawl
python3 ~/sss/scripts/mcp-add.py
```

Then quit Claude Desktop with ⌘Q — closing the window is not enough — and
reopen it.

Useful flags and arguments:

```bash
./scripts/mcp-add.py --list                 # what is on offer
./scripts/mcp-add.py --dry-run              # print the merged config, write nothing
./scripts/mcp-add.py gutenberg firecrawl    # only these two
```

The script merges into `mcpServers` rather than replacing it, so
`google-workspace` and anything else you have configured survives, and it
copies the old file to a timestamped `.bak-` first.

It also rewrites `npx` and `uvx` to **absolute** paths. This is the detail that
makes the difference between working and failing silently: Claude Desktop is a
GUI app and does not inherit your shell's PATH, so a bare `"command": "npx"`
often cannot be found and the server just never appears.

### The firecrawl key

`FIRECRAWL_API_KEY` is read from your shell at the moment you run the script.
It is never stored in this repo — `mcp/servers.json` only records *that*
firecrawl needs a key. Re-running without the variable set keeps whatever key
is already in the Desktop config, so you will not clobber a working setup.

If it is missing entirely the script still writes the entry, with
`YOUR_KEY_HERE` in place, and warns. Note that the Desktop config file holds
the key in plaintext; it lives outside this repo, so do not copy it in.

## Claude Code

The `.mcp.json` at the repo root covers Claude Code sessions started in this
directory — no script to run. Claude Code asks for approval the first time it
sees the file, and expands `${FIRECRAWL_API_KEY}` from your environment, so
export the key in your shell profile rather than writing it into the file.

```bash
claude mcp list     # confirm all three are connected
```

## Adding another server

Add an entry to `mcp/servers.json`:

```json
"some-server": {
  "description": "What it does",
  "launcher": "npx",
  "args": ["-y", "some-mcp-package"],
  "requires_env": ["SOME_API_KEY"]
}
```

`launcher` must be `npx` or `uvx` — those are the two runners `mcp-add.py`
knows how to locate. Drop `requires_env` when the server needs no secret.
Adding it to `.mcp.json` as well is a separate, manual edit; the two files are
deliberately not generated from each other, since Claude Code can expand
`${VARS}` and Claude Desktop cannot.

## Troubleshooting

**A server does not appear in Desktop.** Check the config parses and the paths
are absolute:

```bash
python3 -m json.tool < ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**`npx`/`uvx` not found.** `brew install node` or `brew install uv`, then
re-run the script so it picks up the new path.

**First launch is slow.** `npx -y` and `uvx --from git+...` download the
package on first run. `youtube-transcript` builds from a git checkout, so give
it the longest.

**firecrawl returns auth errors.** The key is wrong or still the placeholder —
`grep FIRECRAWL ~/Library/Application\ Support/Claude/claude_desktop_config.json`.
