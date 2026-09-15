import { createServer } from "../../shared/mcp.js";
import { htmlToMarkdown, pageTitle } from "./markdown.js";

const DEFAULT_LENGTH = 20000;
const MAX_BYTES = 5 * 1024 * 1024;

// A Worker is not on your LAN, so this is not the classic SSRF barrier — it is
// here to stop the server being pointed at link-local metadata endpoints and
// to keep it from being used as an anonymising proxy for internal addresses.
const BLOCKED_HOSTS = /^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i;
const BLOCKED_IPS =
  /^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$|fc|fd|172\.(1[6-9]|2\d|3[01])\.)/i;

function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http and https are supported, not ${url.protocol}`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTS.test(host) || BLOCKED_IPS.test(host)) {
    throw new Error(`Refusing to fetch a private or link-local address: ${host}`);
  }
  return url;
}

/** Read at most MAX_BYTES, so one enormous page cannot exhaust the isolate. */
async function readCapped(response) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks = [];
  let size = 0;
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const joined = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    joined.set(c.subarray(0, Math.min(c.length, size - at)), at);
    at += c.length;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(joined);
}

async function fetchUrl({ url, max_length, start_index, raw }) {
  const target = checkUrl(url);
  const limit = Math.min(Math.max(Number(max_length) || DEFAULT_LENGTH, 1), 200000);
  const start = Math.max(Number(start_index) || 0, 0);

  const response = await fetch(target.toString(), {
    headers: {
      // Identify honestly. Some sites serve a bot a different page, and a
      // reader that lies about what it is makes that impossible to debug.
      "User-Agent": "sss-fetch-mcp/1.0 (+https://github.com/DavidRaitan/sss)",
      Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
    },
    redirect: "follow",
    cf: { cacheTtl: 300, cacheEverything: true },
  });

  const type = response.headers.get("content-type") || "";
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} from ${target.host}`);
  }
  if (/^(image|audio|video|font)\//.test(type) || /application\/(pdf|zip|octet)/.test(type)) {
    throw new Error(`That URL is ${type.split(";")[0]}, not a readable page.`);
  }

  const body = await readCapped(response);
  const isHtml = /html|xml/.test(type) || /^\s*<(!doctype|html)/i.test(body);

  let content;
  if (raw || !isHtml) {
    content = body;
  } else {
    const title = pageTitle(body);
    const markdown = htmlToMarkdown(body);
    content = title ? `# ${title}\n\n${markdown}` : markdown;
    if (!markdown) {
      content =
        `${title ? `# ${title}\n\n` : ""}(This page carries no readable text. ` +
        `It most likely builds its content with JavaScript, which this server ` +
        `does not run. Try raw=true to see the HTML it served.)`;
    }
  }

  const total = content.length;
  const slice = content.slice(start, start + limit);
  const shown = start + slice.length;
  const footer =
    shown < total
      ? `\n\n---\n[${shown} of ${total} characters. Call again with ` +
        `start_index=${shown} for the next part.]`
      : "";

  return `Source: ${target}\n\n${slice}${footer}`;
}

const server = createServer({
  name: "fetch",
  version: "1.0.0",
  tools: [
    {
      name: "fetch_url",
      description:
        "Fetch a web page and return its readable text as markdown. Use this " +
        "to read an article, documentation page, or any URL the user mentions. " +
        "Long pages come back in parts — the response says how to get the rest. " +
        "This does not run JavaScript, so a page that renders client-side may " +
        "come back empty.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "The http or https URL to read." },
          max_length: {
            type: "number",
            description: `Characters to return per call (default ${DEFAULT_LENGTH}).`,
          },
          start_index: {
            type: "number",
            description: "Character offset to start from, for paging through a long page.",
          },
          raw: {
            type: "boolean",
            description: "Return the original HTML instead of converted markdown.",
          },
        },
        required: ["url"],
      },
      handler: fetchUrl,
    },
  ],
});

export default { fetch: (request, env) => server(request, env) };
