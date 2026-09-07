#!/usr/bin/env python3
"""Register the gws MCP server with Claude Desktop.

Hand-editing claude_desktop_config.json is the step most likely to go wrong:
the file may not exist, a stray comma breaks it silently, and replacing the
mcpServers block instead of adding to it quietly removes every other server.
This does the merge, keeps a backup, and fills in the absolute paths that a
desktop app needs because it does not inherit a shell's PATH.

Usage:  python3 scripts/gws-desktop-setup.py [--dry-run]
"""

import json
import os
import platform
import shutil
import sys
import time

SERVER_KEY = "google-workspace"

GWS_CANDIDATES = [
    "/opt/homebrew/bin/gws",
    "/usr/local/bin/gws",
    os.path.expanduser("~/.local/bin/gws"),
    os.path.expanduser("~/.cargo/bin/gws"),
]


def config_path():
    if platform.system() == "Darwin":
        return os.path.expanduser(
            "~/Library/Application Support/Claude/claude_desktop_config.json"
        )
    return os.path.expanduser("~/.config/Claude/claude_desktop_config.json")


def find_gws():
    found = shutil.which("gws")
    if found:
        return found
    for c in GWS_CANDIDATES:
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def find_python():
    # The desktop app has no PATH, so name an interpreter that certainly exists.
    for c in ["/usr/bin/python3", sys.executable, shutil.which("python3")]:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return sys.executable


def main():
    dry = "--dry-run" in sys.argv

    here = os.path.dirname(os.path.abspath(__file__))
    server = os.path.join(os.path.dirname(here), "mcp", "gws_mcp_server.py")
    if not os.path.isfile(server):
        sys.exit(f"error: MCP server not found at {server}")

    gws = find_gws()
    if not gws:
        sys.exit(
            "error: the gws CLI was not found. Install it first — see "
            "docs/google-workspace-cli.md"
        )

    accounts_home = os.path.expanduser("~/.config/gws-accounts")
    accounts = []
    if os.path.isdir(accounts_home):
        accounts = sorted(
            d for d in os.listdir(accounts_home)
            if os.path.isdir(os.path.join(accounts_home, d))
        )
    if not accounts:
        sys.exit(
            f"error: no accounts configured under {accounts_home}. "
            "Run `gws-account add <name>` first."
        )

    path = config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)

    config = {}
    if os.path.isfile(path):
        try:
            with open(path) as f:
                text = f.read().strip()
            config = json.loads(text) if text else {}
        except json.JSONDecodeError as e:
            sys.exit(
                f"error: {path} is not valid JSON ({e}).\n"
                "Fix or delete it, then re-run. Claude Desktop ignores the file "
                "entirely while it is malformed."
            )
        if not isinstance(config, dict):
            sys.exit(f"error: {path} does not contain a JSON object.")

    servers = config.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        sys.exit(f"error: 'mcpServers' in {path} is not an object.")

    existing = sorted(k for k in servers if k != SERVER_KEY)
    replacing = SERVER_KEY in servers

    servers[SERVER_KEY] = {
        "command": find_python(),
        "args": [server],
        "env": {"GWS_BIN": gws},
    }

    rendered = json.dumps(config, indent=2) + "\n"

    print(f"config file : {path}")
    print(f"gws binary  : {gws}")
    print(f"mcp server  : {server}")
    print(f"accounts    : {', '.join(accounts)}")
    print(f"action      : {'updating existing' if replacing else 'adding'} "
          f"'{SERVER_KEY}' entry")
    if existing:
        print(f"preserved   : {', '.join(existing)}")

    if dry:
        print("\n--dry-run, nothing written. Would write:\n")
        print(rendered)
        return

    if os.path.isfile(path):
        backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, backup)
        print(f"backup      : {backup}")

    with open(path, "w") as f:
        f.write(rendered)

    print("\nDone. Now QUIT Claude Desktop completely (Cmd-Q — closing the")
    print("window is not enough) and reopen it.")
    print("\nThen ask it: \"what Google accounts do you have?\"")


if __name__ == "__main__":
    main()
