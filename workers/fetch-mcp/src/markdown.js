/* HTML to markdown, small enough to read in one sitting.
 *
 * This is deliberately not a full converter. The job is to give a model the
 * readable prose of a page with its structure intact — headings, links, lists,
 * code — and to throw away chrome it would only have to wade through.
 */

const DROP = "script|style|noscript|template|svg|canvas|iframe|form|nav|footer|header|aside";

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  rdquo: "”", ldquo: "“", trade: "™", copy: "©", reg: "®",
};

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** Narrow to the element most likely to hold the article, if there is one. */
function mainContent(html) {
  // Drop <head> up front. When no article wrapper matches we fall back to the
  // whole document, and the title would otherwise surface as body prose —
  // which is exactly what happens on a page that renders client-side.
  html = html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, "");
  for (const re of [
    /<article\b[^>]*>([\s\S]*?)<\/article>/i,
    /<main\b[^>]*>([\s\S]*?)<\/main>/i,
    /<body\b[^>]*>([\s\S]*?)<\/body>/i,
  ]) {
    const m = html.match(re);
    // A nav-only <main> is worse than the whole body; require some substance.
    if (m && m[1].length > 200) return m[1];
  }
  return html;
}

export function htmlToMarkdown(html) {
  let s = mainContent(html);

  // Code is parked under placeholders and put back at the very end. Decoding
  // &lt; inside a snippet would otherwise produce a bare '<' that the final
  // tag-strip happily eats, swallowing the rest of the document with it.
  const parked = [];
  const park = (value) => {
    parked.push(value);
    return `\u0000CODE${parked.length - 1}\u0000`;
  };

  s = s.replace(new RegExp(`<(${DROP})\\b[^>]*>[\\s\\S]*?<\\/\\1>`, "gi"), "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");

  // Inline code and code blocks first: their contents must survive tag
  // stripping, and a <pre> may legitimately contain escaped markup.
  s = s.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, body) => {
    const code = decodeEntities(body.replace(/<[^>]+>/g, "")).replace(/\n+$/, "");
    return `\n\n${park("```\n" + code + "\n```")}\n\n`;
  });
  s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, c) =>
    park("`" + decodeEntities(c.replace(/<[^>]+>/g, "")).trim() + "`"));

  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, body) => {
    const title = decodeEntities(body.replace(/<[^>]+>/g, "")).trim();
    return title ? `\n\n${"#".repeat(+level)} ${title}\n\n` : "";
  });

  s = s.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, body) => {
    const label = decodeEntities(body.replace(/<[^>]+>/g, "")).trim();
    if (!label) return "";
    // Anchors and javascript: links carry nothing once the page is text.
    if (/^(#|javascript:)/i.test(href)) return label;
    return `[${label}](${href})`;
  });

  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, b) => `**${b.trim()}**`);
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, b) => `*${b.trim()}*`);

  s = s.replace(/<li\b[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|section|tr|ul|ol|table|blockquote|h[1-6])>/gi, "\n\n");

  s = s.replace(/<[^>]+>/g, "");
  s = decodeEntities(s);

  s = s
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return s.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => parked[+i]);
}

/** The <title>, when the page has one worth using as a heading. */
export function pageTitle(html) {
  const m = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(m[1].replace(/\s+/g, " ")).trim() : "";
}
