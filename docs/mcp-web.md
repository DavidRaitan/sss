# The same servers in Claude on the web

Claude Desktop and Claude Code can start a program on your Mac. The web app
cannot — there is no machine of yours for it to run `npx` on. It talks only to
servers already running at an HTTPS address.

So a stdio server cannot be "added" to the web. It has to be *hosted* first.
`workers/` holds two of them rewritten as Cloudflare Workers:

| Worker | Tools |
|---|---|
| `workers/gutenberg-mcp` | `search_books`, `browse_popular`, `get_book_text` |
| `workers/fetch-mcp` | `fetch_url` |

Both fit inside Cloudflare's free plan — it allows 100,000 requests a day, and
a connector answering your questions uses a handful.

## Deploy

```bash
./scripts/deploy-workers.sh
```

It logs you into Cloudflare if needed, deploys both Workers, generates a secret
for each, and prints one URL per server. Then, in Claude on the web:

**Settings → Connectors → Add custom connector**, paste a URL, name it, save.
Once for each. Re-running the script keeps the same URLs, so a redeploy does
not mean editing your Claude settings again.

Custom connectors need a paid Claude plan (Pro, Max, Team or Enterprise). On
Team and Enterprise an admin may have to allow custom connectors first.

## The URL is the password

Claude's web connector form takes a URL and nothing else — no header, no key
field. A Worker, meanwhile, is reachable by anyone who finds it. So each
server is protected by an unguessable path:

```
https://fetch-mcp.<you>.workers.dev/mcp/8f3a…c1
                                   └── 24 random bytes
```

Any other path returns 404. This is a bearer secret wearing a URL costume:
whoever has the link has the server. Do not paste one into a chat, a ticket or
a screenshot. They are written to `.workers-secrets`, which git ignores.

To rotate one, delete its line from `.workers-secrets`, re-run the deploy
script, and update the connector in Claude with the new URL.

`fetch-mcp` additionally refuses private and link-local addresses, so it cannot
be pointed at a cloud metadata endpoint and used as a proxy into somewhere it
should not reach.

## What you end up with

| | Desktop / Claude Code | Web |
|---|---|---|
| gutenberg | stdio, via `scripts/mcp-add.py` | Worker connector |
| fetch | stdio, via `scripts/mcp-add.py` | Worker connector |
| youtube-transcript | stdio | not deployed — see below |

Nothing about the local setup changes. The Workers are a second way in, for
the one client that cannot launch a process.

## Why youtube-transcript is not here

YouTube serves transcripts differently to datacenter IPs than to home
broadband, and frequently not at all. A Worker calling it would be an
intermittent, hard-to-diagnose failure rather than a feature, so it stays
local, where it runs from your own connection and works.

If you want transcripts in the web app, the vidIQ connector already exposes
video transcripts along with the rest of its YouTube tooling, and it is built
for exactly that.

## Changing a Worker

Both are plain JavaScript with no build step and no dependencies:

```
workers/shared/mcp.js            JSON-RPC over HTTP — the transport both share
workers/fetch-mcp/src/markdown.js   HTML to markdown
workers/*/src/index.js           the tools themselves
```

`workers/shared/mcp.js` implements the four methods a tools-only MCP server
needs — `initialize`, `tools/list`, `tools/call`, `ping` — which is small
enough that the official SDK, and the build step it brings, would cost more
than it saved. Adding a tool means adding an entry to the `tools` array with a
name, a description, a JSON Schema, and a handler returning a string.

Redeploy with `./scripts/deploy-workers.sh`, or `npx wrangler deploy` from
inside one Worker's directory.

## Troubleshooting

**The connector will not add.** Check the URL ends in `/mcp/<the secret>` and
that your plan includes custom connectors. Confirm the Worker is up:

```bash
curl -s -X POST "$URL" -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 300
```

A JSON list of tools means the Worker is fine and the problem is in Claude's
settings. A 404 means the secret in the URL is wrong. A 500 mentioning
`MCP_TOKEN` means the secret never got set — re-run the deploy script.

**`fetch_url` returns a note about JavaScript.** That page builds itself in the
browser; the Worker only reads what the server sends. `raw=true` shows the HTML
it actually got.
