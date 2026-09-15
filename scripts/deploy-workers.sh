#!/usr/bin/env bash
# Deploy the MCP Workers and print the URLs to paste into Claude on the web.
#
# Each Worker is protected by a secret path segment rather than a login, because
# Claude's web connector UI accepts a URL and nothing else — no headers, no key
# field. The URL *is* the credential, so it is generated here with real entropy
# and kept out of git.
set -euo pipefail

cd "$(dirname "$0")/.."
SECRETS=".workers-secrets"          # gitignored
WORKERS=(gutenberg-mcp fetch-mcp)

command -v npx >/dev/null || { echo "error: npx not found. brew install node"; exit 1; }

if ! npx --yes wrangler whoami >/dev/null 2>&1; then
  echo "Not logged in to Cloudflare. A browser window will open."
  npx --yes wrangler login
fi

touch "$SECRETS"; chmod 600 "$SECRETS"

# Reuse a Worker's existing token, so re-deploying does not invalidate the URL
# already sitting in your Claude settings.
token_for() {
  local name="$1" existing
  existing=$(grep "^${name}=" "$SECRETS" 2>/dev/null | tail -1 | cut -d= -f2- || true)
  if [ -n "$existing" ]; then echo "$existing"; else openssl rand -hex 24; fi
}

echo
for worker in "${WORKERS[@]}"; do
  echo "=== $worker ==="
  token=$(token_for "$worker")

  output=$(cd "workers/$worker" && npx --yes wrangler deploy 2>&1) || {
    echo "$output"; echo "error: deploy failed for $worker"; exit 1; }

  printf '%s' "$token" | (cd "workers/$worker" && npx --yes wrangler secret put MCP_TOKEN) >/dev/null

  grep -v "^${worker}=" "$SECRETS" > "$SECRETS.tmp" || true
  mv "$SECRETS.tmp" "$SECRETS"; chmod 600 "$SECRETS"
  echo "${worker}=${token}" >> "$SECRETS"

  url=$(echo "$output" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | head -1)
  if [ -z "$url" ]; then
    echo "  deployed, but the URL was not in wrangler's output. Check the"
    echo "  Cloudflare dashboard for the *.workers.dev address, then append"
    echo "  /mcp/$token to it."
  else
    echo "  $url/mcp/$token"
  fi
  echo
done

cat <<'EOF'
Add each URL above in Claude on the web:
  Settings -> Connectors -> Add custom connector -> paste the URL

Treat those URLs like passwords — anyone holding one can use the server.
They are saved in .workers-secrets, which git ignores. Rotate by deleting a
line from that file and re-running this script.
EOF
