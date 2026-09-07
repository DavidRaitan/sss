#!/usr/bin/env python3
"""MCP server exposing the Google Workspace CLI (gws) to Claude Desktop.

Claude Desktop's chat has no shell and no skills, so it cannot use `gws`
directly and cannot read the routing rules that Claude Code gets from
~/.claude/skills. This server bridges that: it runs `gws` on the user's behalf
and carries the account-routing rules in the tool descriptions, which are the
only instructions Desktop actually sees.

Speaks MCP over stdio as newline-delimited JSON-RPC 2.0. Standard library only,
deliberately: this has to run under whatever python3 the desktop app inherits,
with no install step and no virtualenv.
"""

import json
import os
import re
import shutil
import subprocess
import sys

ACCOUNTS_HOME = os.path.expanduser(
    os.environ.get("GWS_ACCOUNTS_HOME", "~/.config/gws-accounts")
)

# Desktop apps do not inherit a login shell's PATH, so `gws` is usually not on
# it. Look where the documented installers actually put it.
GWS_CANDIDATES = [
    os.environ.get("GWS_BIN", ""),
    "/opt/homebrew/bin/gws",
    "/usr/local/bin/gws",
    os.path.expanduser("~/.local/bin/gws"),
    os.path.expanduser("~/.cargo/bin/gws"),
]

EMAIL_RE = re.compile(r"[\w.%+-]+@[\w.-]+\.[A-Za-z]{2,}")

SERVER_NAME = "google-workspace"
SERVER_VERSION = "0.1.0"
DEFAULT_PROTOCOL = "2024-11-05"

# Subcommands that change auth state or need a browser. Never reachable from a
# chat message: they cannot succeed unattended, and a stray `auth logout` would
# silently sever an account.
BLOCKED = {"auth", "generate-skills"}


def find_gws():
    for c in GWS_CANDIDATES:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    found = shutil.which("gws")
    if found:
        return found
    return None


def list_accounts():
    """Account names, newest-listed last. Missing dir means nothing configured."""
    try:
        return sorted(
            d
            for d in os.listdir(ACCOUNTS_HOME)
            if os.path.isdir(os.path.join(ACCOUNTS_HOME, d))
        )
    except OSError:
        return []


def default_account():
    """The account ~/.config/gws is symlinked to, matching a bare `gws`."""
    link = os.path.expanduser("~/.config/gws")
    try:
        target = os.path.realpath(link)
        if os.path.dirname(target) == os.path.realpath(ACCOUNTS_HOME):
            return os.path.basename(target)
    except OSError:
        pass
    accounts = list_accounts()
    return accounts[0] if accounts else None


def run_gws(account, args, timeout=60):
    """Run gws for one account. Returns (ok, text)."""
    gws = find_gws()
    if not gws:
        return False, (
            "The gws CLI was not found. Looked in Homebrew, /usr/local/bin, "
            "~/.local/bin and ~/.cargo/bin. Set GWS_BIN in the server's env "
            "block in claude_desktop_config.json to its full path."
        )

    accounts = list_accounts()
    if not accounts:
        return False, f"No accounts configured under {ACCOUNTS_HOME}."

    if account is None:
        account = default_account()
    if account not in accounts:
        return False, (
            f"Unknown account {account!r}. Configured accounts: "
            f"{', '.join(accounts)}."
        )

    if args and args[0] in BLOCKED:
        return False, (
            f"The '{args[0]}' command is not available here: it changes "
            "authentication state and needs a browser. Run it in a terminal."
        )

    env = dict(os.environ)
    env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = os.path.join(ACCOUNTS_HOME, account)

    try:
        p = subprocess.run(
            [gws] + args,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )
    except subprocess.TimeoutExpired:
        return False, f"gws timed out after {timeout}s: gws {' '.join(args)}"
    except OSError as e:
        return False, f"Could not run gws: {e}"

    out = (p.stdout or "").strip()
    err = (p.stderr or "").strip()

    if p.returncode != 0:
        msg = err or out or f"gws exited {p.returncode}"
        # Turn the two failures that actually recur into instructions rather
        # than raw API noise, since the user cannot see the terminal.
        if "invalid_grant" in msg:
            msg += (
                "\n\nThis account's token expired (the OAuth app is in Testing "
                "mode, where Google revokes them every 7 days). In a terminal, "
                f"run:\n  GWS_SERVICES=drive,docs,sheets gws-account login {account}"
            )
        elif "serviceusage" in msg or "does not have required permission" in msg:
            msg += (
                f"\n\nThe {account!r} account is not a member of the Cloud "
                "project, so it cannot use its API quota. See "
                "docs/google-workspace-cli.md for the two fixes."
            )
        return False, f"[{account}] {msg}"

    return True, out or "(no output)"


# --- Tool definitions -------------------------------------------------------
#
# The descriptions carry the account-routing rules. In Claude Code these live
# in ~/.claude/skills, but Desktop chat never loads skills, so the descriptions
# are the only place the rules can go.

ACCOUNT_RULE = (
    "Which Google account to use. Omit for the default account, which is "
    "correct for most requests. Use 'torah' ONLY for YouTube, Descript, video "
    "production, the channel, or Torah Meirah content. Subject matter decides, "
    "not file type: a spreadsheet tracking video uploads is 'torah' work, an "
    "unqualified spreadsheet is not. If a request could mean either account, "
    "ask the user rather than guessing - especially before writing or sharing."
)

TOOLS = [
    {
        "name": "list_accounts",
        "description": (
            "List the configured Google accounts and the email address behind "
            "each. Use this when unsure which account a request refers to, or "
            "when the user names an account you have not seen."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "drive_search",
        "description": (
            "Search Google Drive by file name. Returns id, name and type for "
            "each match. Use the returned id with doc_read or sheet_read."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Text to match against file names.",
                },
                "account": {"type": "string", "description": ACCOUNT_RULE},
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 25).",
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "drive_list_recent",
        "description": "List the most recently modified Google Drive files.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "account": {"type": "string", "description": ACCOUNT_RULE},
                "limit": {
                    "type": "integer",
                    "description": "Max results (default 25).",
                },
            },
        },
    },
    {
        "name": "doc_read",
        "description": (
            "Read the full text of a Google Doc by its file id. Get the id "
            "from drive_search."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "account": {"type": "string", "description": ACCOUNT_RULE},
            },
            "required": ["document_id"],
        },
    },
    {
        "name": "doc_append",
        "description": (
            "Append text to the end of a Google Doc. This modifies a real "
            "document - confirm the target with the user first if there is any "
            "doubt about which document or which account."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "document_id": {"type": "string"},
                "text": {"type": "string"},
                "account": {"type": "string", "description": ACCOUNT_RULE},
            },
            "required": ["document_id", "text"],
        },
    },
    {
        "name": "sheet_read",
        "description": (
            "Read cell values from a Google Sheet. Range uses A1 notation, "
            "e.g. 'Sheet1!A1:D50'."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "spreadsheet_id": {"type": "string"},
                "range": {
                    "type": "string",
                    "description": "A1 notation, e.g. 'Sheet1!A1:D50'.",
                },
                "account": {"type": "string", "description": ACCOUNT_RULE},
            },
            "required": ["spreadsheet_id", "range"],
        },
    },
    {
        "name": "sheet_append",
        "description": (
            "Append a row to a Google Sheet. This modifies a real spreadsheet - "
            "confirm the target with the user first if there is any doubt."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "spreadsheet_id": {"type": "string"},
                "range": {
                    "type": "string",
                    "description": "A1 notation of the target sheet/range.",
                },
                "values": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Cell values for the new row, left to right.",
                },
                "account": {"type": "string", "description": ACCOUNT_RULE},
            },
            "required": ["spreadsheet_id", "range", "values"],
        },
    },
    {
        "name": "gws_run",
        "description": (
            "Escape hatch: run an arbitrary gws subcommand when no tool above "
            "fits, e.g. ['drive','files','list','--params','{\"pageSize\":5}']. "
            "Authentication commands are refused - they need a browser. Prefer "
            "the specific tools; use this only when they cannot express the "
            "request."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "args": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Arguments after 'gws', one per array item.",
                },
                "account": {"type": "string", "description": ACCOUNT_RULE},
            },
            "required": ["args"],
        },
    },
]


def tool_list_accounts():
    accounts = list_accounts()
    if not accounts:
        return False, f"No accounts configured under {ACCOUNTS_HOME}."
    default = default_account()
    gws = find_gws()
    if not gws:
        return False, "The gws CLI was not found; set GWS_BIN to its full path."

    lines = []
    for name in accounts:
        # `auth` is blocked for chat-initiated commands, but reading status is
        # both safe and the only way to show which email a name maps to.
        env = dict(os.environ)
        env["GOOGLE_WORKSPACE_CLI_CONFIG_DIR"] = os.path.join(ACCOUNTS_HOME, name)
        email = "unknown"
        try:
            p = subprocess.run(
                [gws, "auth", "status"],
                capture_output=True, text=True, timeout=20, env=env,
            )
            m = EMAIL_RE.search(p.stdout or "")
            email = m.group(0) if m else "NOT AUTHENTICATED"
        except (subprocess.TimeoutExpired, OSError):
            email = "unknown"
        marker = " (default)" if name == default else ""
        lines.append(f"- {name}{marker}: {email}")
    return True, "\n".join(lines)


def call_tool(name, args):
    account = args.get("account")

    if name == "list_accounts":
        return tool_list_accounts()

    if name == "drive_search":
        q = args.get("query", "")
        limit = int(args.get("limit") or 25)
        escaped = q.replace("\\", "\\\\").replace("'", "\\'")
        params = json.dumps(
            {"q": f"name contains '{escaped}'", "pageSize": limit}
        )
        return run_gws(account, ["drive", "files", "list", "--params", params])

    if name == "drive_list_recent":
        limit = int(args.get("limit") or 25)
        params = json.dumps({"pageSize": limit, "orderBy": "modifiedTime desc"})
        return run_gws(account, ["drive", "files", "list", "--params", params])

    if name == "doc_read":
        return run_gws(account, ["docs", "documents", "get", args["document_id"]])

    if name == "doc_append":
        return run_gws(
            account,
            ["docs", "+write", args["document_id"], "--text", args["text"]],
        )

    if name == "sheet_read":
        return run_gws(
            account,
            ["sheets", "+read", args["spreadsheet_id"], "--range", args["range"]],
        )

    if name == "sheet_append":
        cmd = ["sheets", "+append", args["spreadsheet_id"], "--range", args["range"]]
        for v in args.get("values", []):
            cmd += ["--value", str(v)]
        return run_gws(account, cmd)

    if name == "gws_run":
        raw = args.get("args") or []
        if not isinstance(raw, list) or not all(isinstance(a, str) for a in raw):
            return False, "args must be an array of strings."
        return run_gws(account, raw)

    return False, f"Unknown tool: {name}"


# --- JSON-RPC plumbing ------------------------------------------------------

def respond(msg_id, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": msg_id}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def main():
    protocol = DEFAULT_PROTOCOL
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            continue

        method = req.get("method")
        msg_id = req.get("id")
        params = req.get("params") or {}

        # Notifications carry no id and must never be answered.
        if msg_id is None:
            continue

        if method == "initialize":
            protocol = params.get("protocolVersion") or DEFAULT_PROTOCOL
            respond(msg_id, {
                "protocolVersion": protocol,
                "capabilities": {"tools": {}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            })

        elif method == "tools/list":
            respond(msg_id, {"tools": TOOLS})

        elif method == "tools/call":
            name = params.get("name", "")
            args = params.get("arguments") or {}
            try:
                ok, text = call_tool(name, args)
            except KeyError as e:
                ok, text = False, f"Missing required argument: {e}"
            except Exception as e:  # never take the server down over one call
                ok, text = False, f"{type(e).__name__}: {e}"
            respond(msg_id, {
                "content": [{"type": "text", "text": text}],
                "isError": not ok,
            })

        elif method == "ping":
            respond(msg_id, {})

        else:
            respond(msg_id, error={"code": -32601, "message": f"Unknown method: {method}"})


if __name__ == "__main__":
    main()
