# Extra MCP servers

Three general-purpose servers, kept alongside the `google-workspace` one. None
of them needs an API key or an account:

| Server | Gives Claude | Needs |
|---|---|---|
| `gutenberg` | Search and read public-domain books from Project Gutenberg | `npx` |
| `youtube-transcript` | Transcripts for YouTube videos | `uvx` |
| `fetch` | Any web page, converted to markdown | `uvx` |

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

## Install

```bash
python3 ~/sss/scripts/mcp-add.py
```

Then quit Claude Desktop with ⌘Q — closing the window is not enough — and
reopen it.

Useful flags and arguments:

```bash
./scripts/mcp-add.py --list                 # what is on offer
./scripts/mcp-add.py --dry-run              # print the merged config, write nothing
./scripts/mcp-add.py gutenberg fetch        # only these two
```

The script merges into `mcpServers` rather than replacing it, so
`google-workspace` and anything else you have configured survives, and it
copies the old file to a timestamped `.bak-` first.

It also rewrites `npx` and `uvx` to **absolute** paths. This is the detail that
makes the difference between working and failing silently: Claude Desktop is a
GUI app and does not inherit your shell's PATH, so a bare `"command": "npx"`
often cannot be found and the server just never appears.

For Claude Code there is nothing to run — the `.mcp.json` at the repo root
covers sessions started in this directory. Claude Code asks for approval the
first time it sees the file. Confirm with `claude mcp list`.

## On `fetch`, and why not firecrawl

`fetch` is the reference server from the Model Context Protocol project
itself. It takes a URL, strips the page to readable text and hands back
markdown, with `start_index` for paging through something long. No key, no
account, no quota, and it is the same lineage as the protocol, so it does not
go stale.

What it does **not** do is crawl. It is one page per call: give it a URL and
it reads that URL. It will not walk a site, follow links, or render
JavaScript, so a page that builds its content client-side comes back thin or
empty.

Firecrawl covers those cases, and was in this repo briefly, but it needs an
account and an API key: 1,000 credits a month free, then $19/mo. Since nothing
else here needs a key, it was dropped rather than make the whole setup depend
on one. `scripts/mcp-add.py` still understands `requires_env`, so adding it
back is an entry in `mcp/servers.json` and `export FIRECRAWL_API_KEY=...`
before running the script.

For JavaScript-heavy pages the free route is Playwright MCP
(`npx -y @playwright/mcp@latest`), which drives a real browser. It is a much
heavier dependency — it downloads browser binaries on first run — so it is
deliberately not in the catalogue. Add it the same way if you need it.

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
knows how to locate. Drop `requires_env` when the server needs no secret; when
it is present, the value is read from your shell at the moment you run the
script and falls back to whatever key is already in the Desktop config, so a
re-run without it exported will not clobber a working setup. Keys are never
written to this repo, and the Desktop config that holds them lives outside it.

Adding the server to `.mcp.json` as well is a separate, manual edit; the two
files are deliberately not generated from each other, since Claude Code can
expand `${VARS}` in a config and Claude Desktop cannot.

## Troubleshooting

**A server does not appear in Desktop.** Check the config parses and the paths
are absolute:

```bash
python3 -m json.tool < ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

**`npx`/`uvx` not found.** `brew install node` or `brew install uv`, then
re-run the script so it picks up the new path.

**First launch is slow.** `npx -y` and `uvx` download the package on first run.
`youtube-transcript` builds from a git checkout, so give it the longest.

**`fetch` returns almost nothing for a page.** That page renders in the
browser. See the Playwright note above.
