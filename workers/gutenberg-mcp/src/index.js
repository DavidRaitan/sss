import { createServer } from "../../shared/mcp.js";

/* Project Gutenberg through Gutendex, its community search API. Gutenberg
 * itself serves files but has no search endpoint worth calling; Gutendex
 * indexes the catalogue and hands back the download URLs. */
const CATALOGUE = "https://gutendex.com/books";
const MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_LENGTH = 20000;

const describe = (book) =>
  [
    `#${book.id} — ${book.title}`,
    `  by ${book.authors.map((a) => a.name).join("; ") || "unknown"}`,
    book.subjects?.length ? `  subjects: ${book.subjects.slice(0, 3).join("; ")}` : null,
    `  downloads: ${book.download_count}`,
    plainTextUrl(book) ? null : "  (no plain-text edition — cannot be read here)",
  ]
    .filter(Boolean)
    .join("\n");

/** The formats map is keyed by full MIME type, charset and all. */
function plainTextUrl(book) {
  const formats = book.formats || {};
  const key = Object.keys(formats).find(
    (k) => k.startsWith("text/plain") && !formats[k].endsWith(".zip")
  );
  return key ? formats[key] : null;
}

async function catalogue(params) {
  const url = new URL(CATALOGUE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cf: { cacheTtl: 3600, cacheEverything: true },
  });
  if (!response.ok) {
    throw new Error(`The Gutenberg catalogue returned ${response.status}.`);
  }
  return response.json();
}

async function searchBooks({ query, page }) {
  if (!query?.trim()) throw new Error("A search query is required.");
  const data = await catalogue({ search: query.trim(), page: String(page || 1) });
  if (!data.results?.length) return `No books match "${query}".`;
  return (
    `${data.count} match "${query}". Showing ${data.results.length}:\n\n` +
    data.results.map(describe).join("\n\n") +
    `\n\nRead one with get_book_text and its number.`
  );
}

async function browsePopular({ topic }) {
  const data = await catalogue(topic ? { topic, sort: "popular" } : { sort: "popular" });
  if (!data.results?.length) return `Nothing found for topic "${topic}".`;
  return (
    `Most downloaded${topic ? ` in "${topic}"` : ""}:\n\n` +
    data.results.slice(0, 20).map(describe).join("\n\n")
  );
}

async function getBookText({ book_id, max_length, start_index }) {
  const id = parseInt(book_id, 10);
  if (!Number.isInteger(id) || id < 1) throw new Error("book_id must be a number.");

  const book = await catalogue({ ids: String(id) }).then((d) => d.results?.[0]);
  if (!book) throw new Error(`No book with id ${id}.`);

  const source = plainTextUrl(book);
  if (!source) {
    throw new Error(
      `"${book.title}" has no plain-text edition, only ${Object.keys(book.formats).join(", ")}.`
    );
  }

  const limit = Math.min(Math.max(Number(max_length) || DEFAULT_LENGTH, 1), 200000);
  const start = Math.max(Number(start_index) || 0, 0);

  const response = await fetch(source, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!response.ok) throw new Error(`Gutenberg returned ${response.status} for the text.`);

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`"${book.title}" is larger than this server will load.`);
  }
  const full = new TextDecoder("utf-8", { fatal: false }).decode(buffer);

  const slice = full.slice(start, start + limit);
  const shown = start + slice.length;
  const header = `${book.title} — ${book.authors.map((a) => a.name).join("; ")}\n` +
    `Project Gutenberg #${id}, ${full.length} characters\n\n`;
  const footer =
    shown < full.length
      ? `\n\n---\n[${shown} of ${full.length} characters. Call again with ` +
        `start_index=${shown} for the next part.]`
      : "\n\n---\n[End of the book.]";

  return header + slice + footer;
}

const paging = {
  max_length: { type: "number", description: `Characters per call (default ${DEFAULT_LENGTH}).` },
  start_index: { type: "number", description: "Character offset to resume from." },
};

const server = createServer({
  name: "gutenberg",
  version: "1.0.0",
  tools: [
    {
      name: "search_books",
      description:
        "Search Project Gutenberg's public-domain books by title, author or " +
        "keyword. Returns book numbers to pass to get_book_text.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Title, author, or keyword." },
          page: { type: "number", description: "Result page, 32 books per page." },
        },
        required: ["query"],
      },
      handler: searchBooks,
    },
    {
      name: "browse_popular",
      description:
        "List the most downloaded books, optionally within a subject such as " +
        "'philosophy' or 'adventure'. Use for browsing when there is no " +
        "particular title in mind.",
      inputSchema: {
        type: "object",
        properties: { topic: { type: "string", description: "Subject or bookshelf." } },
      },
      handler: browsePopular,
    },
    {
      name: "get_book_text",
      description:
        "Read the full text of a book by its Project Gutenberg number. Novels " +
        "run to hundreds of thousands of characters, so the text comes back in " +
        "parts and the response says how to fetch the next one.",
      inputSchema: {
        type: "object",
        properties: {
          book_id: { type: "number", description: "The book's Gutenberg number." },
          ...paging,
        },
        required: ["book_id"],
      },
      handler: getBookText,
    },
  ],
});

export default { fetch: (request, env) => server(request, env) };
