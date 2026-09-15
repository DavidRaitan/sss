#!/usr/bin/env python3
"""Register stdio MCP servers with Claude Desktop.

Claude Desktop launches MCP servers as processes on this machine, and it does
not inherit a shell's PATH — a bare `npx` or `uvx` in the config usually fails
to start with nothing on screen to say why. This resolves each launcher to an
absolute path, merges the servers into claude_desktop_config.json without
disturbing anything already there, and keeps a timestamped backup.

Secrets are never read from the catalogue. A server declaring `requires_env`
takes its value from this shell's environment, or keeps whatever the existing
config already had.

Usage:
    python3 scripts/mcp-add.py [--dry-run] [--list] [server ...]

With no server names, every server in mcp/servers.json is registered.
"""

import json
import os
import platform
import shutil
import sys
import time

PLACEHOLDER = "YOUR_KEY_HERE"

# Where the node and uv toolchains put their runners, for when PATH is no help.
LAUNCHER_CANDIDATES = {
    "npx": [
        "/opt/homebrew/bin/npx",
        "/usr/local/bin/npx",
        os.path.expanduser("~/.volta/bin/npx"),
        os.path.expanduser("~/.local/share/fnm/aliases/default/bin/npx"),
    ],
    "uvx": [
        "/opt/homebrew/bin/uvx",
        "/usr/local/bin/uvx",
        os.path.expanduser("~/.local/bin/uvx"),
        os.path.expanduser("~/.cargo/bin/uvx"),
    ],
}

INSTALL_HINT = {
    "npx": "npx ships with Node.js — install it with `brew install node`.",
    "uvx": "uvx ships with uv — install it with `brew install uv`.",
}


def config_path():
    if platform.system() == "Darwin":
        return os.path.expanduser(
            "~/Library/Application Support/Claude/claude_desktop_config.json"
        )
    return os.path.expanduser("~/.config/Claude/claude_desktop_config.json")


def find_launcher(name):
    found = shutil.which(name)
    if found:
        return found
    for c in LAUNCHER_CANDIDATES.get(name, []):
        if os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return None


def load_catalogue():
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(os.path.dirname(here), "mcp", "servers.json")
    if not os.path.isfile(path):
        sys.exit(f"error: server catalogue not found at {path}")
    with open(path) as f:
        return json.load(f)["servers"]


def load_config(path):
    if not os.path.isfile(path):
        return {}
    with open(path) as f:
        text = f.read().strip()
    if not text:
        return {}
    try:
        config = json.loads(text)
    except json.JSONDecodeError as e:
        sys.exit(
            f"error: {path} is not valid JSON ({e}).\n"
            "Fix or delete it, then re-run. Claude Desktop ignores the file "
            "entirely while it is malformed."
        )
    if not isinstance(config, dict):
        sys.exit(f"error: {path} does not contain a JSON object.")
    return config


def resolve_env(name, spec, previous):
    """Fill a server's secrets from the shell, falling back to the old config."""
    env, missing = {}, []
    for var in spec.get("requires_env", []):
        value = os.environ.get(var) or previous.get("env", {}).get(var, "")
        if not value or value == PLACEHOLDER:
            missing.append(var)
            value = PLACEHOLDER
        env[var] = value
    return env, missing


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    dry = "--dry-run" in flags

    catalogue = load_catalogue()

    if "--list" in flags:
        for name, spec in catalogue.items():
            print(f"{name:20} {spec['description']}")
        return

    unknown = [a for a in argv if a not in catalogue]
    if unknown:
        sys.exit(
            f"error: unknown server(s): {', '.join(unknown)}\n"
            f"known: {', '.join(catalogue)}"
        )
    wanted = argv or list(catalogue)

    path = config_path()
    config = load_config(path)
    servers = config.setdefault("mcpServers", {})
    if not isinstance(servers, dict):
        sys.exit(f"error: 'mcpServers' in {path} is not an object.")

    untouched = sorted(k for k in servers if k not in wanted)
    warnings = []

    print(f"config file : {path}")
    for name in wanted:
        spec = catalogue[name]
        launcher = find_launcher(spec["launcher"])
        if not launcher:
            sys.exit(
                f"error: '{spec['launcher']}' was not found, and {name} needs "
                f"it to run.\n{INSTALL_HINT.get(spec['launcher'], '')}"
            )

        previous = servers.get(name) if isinstance(servers.get(name), dict) else {}
        entry = {"command": launcher, "args": list(spec["args"])}
        env, missing = resolve_env(name, spec, previous)
        if env:
            entry["env"] = env
        for var in missing:
            warnings.append(
                f"{name}: {var} is not set, so the config carries the "
                f"placeholder. Export {var} and re-run, or edit the value in."
            )

        servers[name] = entry
        action = "updating" if previous else "adding  "
        print(f"  {action}  {name:20} -> {launcher}")

    if untouched:
        print(f"preserved   : {', '.join(untouched)}")

    rendered = json.dumps(config, indent=2) + "\n"

    if dry:
        print("\n--dry-run, nothing written. Would write:\n")
        print(rendered)
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        if os.path.isfile(path):
            backup = f"{path}.bak-{time.strftime('%Y%m%d-%H%M%S')}"
            shutil.copy2(path, backup)
            print(f"backup      : {backup}")
        with open(path, "w") as f:
            f.write(rendered)

    for w in warnings:
        print(f"\nwarning: {w}")

    if not dry:
        print("\nDone. Now QUIT Claude Desktop completely (Cmd-Q — closing the")
        print("window is not enough) and reopen it. The tools appear under the")
        print("connector icon.")


if __name__ == "__main__":
    main()
