/* Minimal MCP server over Streamable HTTP, with no dependencies.
 *
 * Claude on the web speaks only to remote servers, so the transport has to be
 * HTTP rather than stdin/stdout. The official SDK would pull in a build step
 * for what is, at this size, a JSON-RPC switch — so this implements the four
 * methods a tools-only server actually needs and nothing else.
 *
 * The URL carries a secret path segment. A Worker is world-reachable, and
 * Claude's web connector UI takes a URL but no custom headers, so an
 * unguessable path is the authentication available to us. It is a bearer
 * secret in disguise: whoever has the URL has the server.
 */

const PROTOCOL_VERSION = "2025-06-18";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

const result = (id, value) => json({ jsonrpc: "2.0", id, result: value });

const error = (id, code, message) =>
  json({ jsonrpc: "2.0", id, error: { code, message } });

/** Wrap a handler's return value in the content shape tools/call expects. */
const text = (value) => ({ content: [{ type: "text", text: value }] });

/** Constant-time-ish compare, so the secret path cannot be probed by timing. */
function secretsMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Build a fetch handler for a server described by { name, version, tools }.
 * Each tool is { name, description, inputSchema, handler } where handler
 * returns a string, or throws to report a tool error.
 */
export function createServer({ name, version, tools }) {
  const byName = new Map(tools.map((t) => [t.name, t]));

  return async function handle(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const secret = env.MCP_TOKEN;
    if (!secret) {
      return json({ error: "MCP_TOKEN is not set on this Worker." }, 500);
    }

    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    const expected = `/mcp/${secret}`;
    if (!secretsMatch(path, expected)) {
      return new Response("Not found", { status: 404, headers: CORS });
    }

    // Claude opens a GET stream for server-initiated messages. This server
    // never sends any, so declining is correct and it falls back to POST.
    if (request.method === "GET") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: CORS });
    }

    let message;
    try {
      message = await request.json();
    } catch {
      return error(null, -32700, "Parse error");
    }

    // Notifications carry no id and expect no body, only an acknowledgement.
    if (message.id === undefined) {
      return new Response(null, { status: 202, headers: CORS });
    }

    const { id, method, params } = message;

    if (method === "initialize") {
      return result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name, version },
      });
    }

    if (method === "ping") return result(id, {});

    if (method === "tools/list") {
      return result(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    }

    if (method === "tools/call") {
      const tool = byName.get(params?.name);
      if (!tool) return error(id, -32602, `Unknown tool: ${params?.name}`);
      try {
        return result(id, text(await tool.handler(params.arguments || {})));
      } catch (e) {
        // A failed tool is a result, not a protocol error: the model should
        // see what went wrong and be able to try something else.
        return result(id, { ...text(`Error: ${e.message}`), isError: true });
      }
    }

    return error(id, -32601, `Method not found: ${method}`);
  };
}
