#!/usr/bin/env python3
"""Download a whole book from Sefaria as plain, readable files.

Sefaria shows a book one section at a time, as a web app. This walks the book's
table of contents through Sefaria's public API and writes the full text out in
reading order, with chapter headings and without markup or footnote clutter:

    book.txt   plain text
    book.md    Markdown, with the heading hierarchy kept
    book.html  a print-ready page (right-to-left for Hebrew)
    book.pdf   printed from the HTML by headless Chrome/Chromium, if one is installed

Usage:
    sefaria-book.py <sefaria URL or book title> [-o DIR] [--lang en|he|source]
                    [--format txt,md,html,pdf] [--footnotes]

    sefaria-book.py "https://www.sefaria.org/The_Great_Partnership;_God,_Science,_and_the_Search_for_Meaning?tab=contents"
    sefaria-book.py "Mesillat Yesharim" --lang en

Standard library only, like the rest of this repo's scripts: nothing to install.
"""

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = os.environ.get("SEFARIA_API", "https://www.sefaria.org/api")
USER_AGENT = "sefaria-book/0.1 (personal archiving script)"

CHROME_CANDIDATES = [
    os.environ.get("CHROME_BIN", ""),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/opt/pw-browsers/chromium",
]
CHROME_NAMES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"]


# --- fetching ---------------------------------------------------------------

def fetch_json(url, retries=4):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.load(resp)
        except urllib.error.HTTPError as e:
            if e.code == 404 or attempt == retries:
                raise
        except urllib.error.URLError:
            if attempt == retries:
                raise
        time.sleep(2 ** attempt)


def quote_ref(ref):
    # Sefaria refs use underscores for spaces in URLs; everything else is escaped.
    return urllib.parse.quote(ref.replace(" ", "_"), safe=",;:'")


def title_from_arg(arg):
    """Accept a full Sefaria URL or a bare title."""
    if arg.startswith(("http://", "https://")):
        path = urllib.parse.urlsplit(arg).path.strip("/")
        arg = urllib.parse.unquote(path.split("/")[0])
    return arg.replace("_", " ")


def fetch_index(title):
    try:
        return fetch_json(f"{API}/v2/raw/index/{quote_ref(title)}")
    except urllib.error.HTTPError as e:
        if e.code == 404:
            sys.exit(f"Sefaria has no book titled {title!r}. Check the spelling or paste the URL.")
        raise


def fetch_section(ref, lang):
    """Return (text, version_title, direction) for one ref, or (None, None, None).

    Many books exist in one language only, so a missing `lang` falls back to
    the source text rather than leaving the section empty.
    """
    for want in dict.fromkeys((lang, "source")):
        data = fetch_json(f"{API}/v3/texts/{quote_ref(ref)}?version={want}")
        for v in data.get("versions", []):
            if v.get("text"):
                return v["text"], v.get("versionTitle"), v.get("direction")
    return None, None, None


# --- walking the table of contents -----------------------------------------

SHARED_TITLES_HE = {"Introduction": "הקדמה", "Preface": "הקדמה", "Foreword": "פתח דבר",
                    "Epilogue": "אחרית דבר", "Afterword": "אחרית דבר"}


def node_title(node, lang):
    """A node's display title. `lang` is 'he' or 'en'."""
    titles = node.get("titles") or []
    for want in (lang, "en", "he"):
        for t in titles:
            if t.get("lang") == want and t.get("primary"):
                return t["text"]
    shared = node.get("sharedTitle")
    if shared and lang == "he":
        return SHARED_TITLES_HE.get(shared, shared)
    return shared or node.get("key") or ""


def walk(node, ref, depth=0, is_root=False):
    """Yield (heading_level, heading, ref, node) in reading order.

    Refs are built from English keys, which is what the API expects; headings
    are resolved later in the output language.
    """
    if not is_root and node.get("key") != "default":
        ref = f"{ref}, {node.get('sharedTitle') or node['key']}"
    children = node.get("nodes")
    if children:
        if not is_root and node.get("key") != "default":
            yield depth, node, None
        for child in children:
            yield from walk(child, ref, depth + (0 if is_root or node.get("key") == "default" else 1))
    else:
        yield depth, node, ref


# --- cleaning ---------------------------------------------------------------

FOOTNOTE_MARKER_RE = re.compile(r'<sup[^>]*class="footnote-marker"[^>]*>.*?</sup>\s*', re.S)
FOOTNOTE_OPEN_RE = re.compile(r'<i[^>]*class="footnote"[^>]*>')
ITALIC_TAG_RE = re.compile(r"<(/?)i\b[^>]*>")


def extract_footnotes(segment, notes):
    """Replace each footnote with a [n] marker, collecting its text into `notes`.

    Footnote bodies are <i class="footnote"> and often contain <i> of their
    own, so the closing tag has to be found by counting, not by regex.
    """
    out, pos = [], 0
    for m in FOOTNOTE_OPEN_RE.finditer(segment):
        if m.start() < pos:
            continue
        depth, end = 1, len(segment)
        for t in ITALIC_TAG_RE.finditer(segment, m.end()):
            depth += -1 if t.group(1) else 1
            if depth == 0:
                end = t.end()
                break
        before = FOOTNOTE_MARKER_RE.sub("", segment[pos:m.start()])
        out.append(before.rstrip() if notes is None else before)
        if notes is not None:
            notes.append(strip_tags(segment[m.end():end]))
            out.append(f"[{len(notes)}]")
        pos = end
    out.append(segment[pos:])
    return "".join(out)


def clean(segment, notes):
    """Strip Sefaria's HTML from one paragraph.

    Footnotes are moved into `notes` and replaced by a [n] marker; pass
    notes=None to drop them entirely.
    """
    segment = extract_footnotes(segment, notes)
    segment = re.sub(r"<br\s*/?>", "\n", segment)
    return strip_tags(segment)


def strip_tags(s):
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s).replace(" ", " ")
    return re.sub(r"[ \t]+", " ", s).strip()


def flatten(text):
    """Jagged arrays nest to any depth; reading order is depth-first."""
    if isinstance(text, str):
        return [text] if text.strip() else []
    out = []
    for t in text:
        out.extend(flatten(t))
    return out


# --- output -----------------------------------------------------------------

def render_txt(book):
    out = [book["title"], "=" * len(book["title"]), ""]
    for sec in book["sections"]:
        if sec["heading"]:
            out += ["", sec["heading"], "-" * len(sec["heading"]), ""]
        for p in sec["paragraphs"]:
            out += [p, ""]
        if sec["notes"]:
            out.append("Notes:")
            out += [f"  [{i}] {n}" for i, n in enumerate(sec["notes"], 1)]
            out.append("")
    if book["source"]:
        out += ["", f"Source: {book['source']} (via Sefaria)"]
    return "\n".join(out).rstrip() + "\n"


def render_md(book):
    out = [f"# {book['title']}", ""]
    for sec in book["sections"]:
        if sec["heading"]:
            out += [f"{'#' * min(sec['level'] + 2, 6)} {sec['heading']}", ""]
        for p in sec["paragraphs"]:
            out += [p.replace("\n", "  \n"), ""]
        for i, n in enumerate(sec["notes"], 1):
            out.append(f"{i}. {n}")
        if sec["notes"]:
            out.append("")
    if book["source"]:
        out += [f"*Source: {book['source']} (via Sefaria)*", ""]
    return "\n".join(out)


def render_html(book):
    rtl = book["direction"] == "rtl"
    e = html.escape
    parts = [
        "<!doctype html>",
        f'<html lang="{"he" if rtl else "en"}" dir="{"rtl" if rtl else "ltr"}"><head><meta charset="utf-8">',
        f"<title>{e(book['title'])}</title>",
        "<style>"
        "body{font-family:'Frank Ruehl CLM','David','Times New Roman',serif;font-size:13pt;"
        "line-height:1.6;max-width:40em;margin:2em auto;padding:0 1em;color:#111}"
        "h1{text-align:center;margin-bottom:2em}h2,h3,h4{margin-top:2em}"
        "h2{page-break-before:always}p{text-align:justify;margin:0 0 .8em}"
        ".notes{font-size:10pt;color:#444;border-top:1px solid #ccc;padding-top:.5em}"
        "@page{margin:2cm}"
        "</style></head><body>",
        f"<h1>{e(book['title'])}</h1>",
    ]
    for sec in book["sections"]:
        tag = f"h{min(sec['level'] + 2, 6)}"
        if sec["heading"]:
            parts.append(f"<{tag}>{e(sec['heading'])}</{tag}>")
        parts += [f"<p>{e(p).replace(chr(10), '<br>')}</p>" for p in sec["paragraphs"]]
        if sec["notes"]:
            parts.append('<ol class="notes">' + "".join(f"<li>{e(n)}</li>" for n in sec["notes"]) + "</ol>")
    if book["source"]:
        parts.append(f'<p class="notes">Source: {e(book["source"])} (via Sefaria)</p>')
    parts.append("</body></html>")
    return "\n".join(parts)


def find_chrome():
    for c in CHROME_CANDIDATES:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    for name in CHROME_NAMES:
        found = shutil.which(name)
        if found:
            return found
    return None


def print_pdf(html_path, pdf_path):
    chrome = find_chrome()
    if not chrome:
        print("  pdf: skipped - no Chrome/Chromium found (set CHROME_BIN, or print book.html from a browser)",
              file=sys.stderr)
        return False
    with tempfile.TemporaryDirectory() as profile:
        subprocess.run(
            [chrome, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}",
             "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
             "file://" + os.path.abspath(html_path)],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=300,
        )
    return os.path.exists(pdf_path)


def slugify(title):
    s = re.sub(r"[^\w\s-]", "", title.split(";")[0], flags=re.U).strip()
    return re.sub(r"\s+", "_", s) or "book"


# --- main -------------------------------------------------------------------

def build(title, lang, footnotes):
    index = fetch_index(title)
    schema = index.get("schema") or index
    en_title = index.get("title", title)
    book = {"title": None, "sections": [], "source": None, "direction": "ltr"}

    entries = list(walk(schema, en_title, is_root=True))
    leaves = sum(1 for *_, ref in entries if ref)
    done = 0
    for level, node, ref in entries:
        if ref is None:
            book["sections"].append({"level": level, "node": node, "paragraphs": [], "notes": []})
            continue
        done += 1
        print(f"  [{done}/{leaves}] {ref}", file=sys.stderr)
        text, version, direction = fetch_section(ref, lang)
        if text is None:
            print("    (no text; skipped)", file=sys.stderr)
            continue
        if direction == "rtl":
            book["direction"] = "rtl"
        book["source"] = book["source"] or version
        notes = [] if footnotes else None
        paragraphs = [clean(p, notes) for p in flatten(text)]
        book["sections"].append({
            "level": level, "node": node,
            "paragraphs": [p for p in paragraphs if p],
            "notes": notes or [],
        })

    heading_lang = "he" if book["direction"] == "rtl" else "en"
    book["title"] = node_title(schema, heading_lang) or en_title
    # A root that is itself one jagged array has no chapter of its own to name.
    for sec in book["sections"]:
        node = sec.pop("node")
        sec["heading"] = "" if node is schema else node_title(node, heading_lang)
    book["sections"] = [s for s in book["sections"] if s["heading"] or s["paragraphs"]]
    return book, en_title


def main():
    ap = argparse.ArgumentParser(description="Download a Sefaria book as txt/md/html/pdf.")
    ap.add_argument("book", help="Sefaria URL or book title")
    ap.add_argument("-o", "--out", default=".", help="output directory (default: current)")
    ap.add_argument("--lang", default="english", choices=["english", "hebrew", "source", "en", "he"],
                    help="which version to prefer; falls back to the source text (default: english)")
    ap.add_argument("--format", default="txt,md,html,pdf", help="comma-separated: txt,md,html,pdf")
    ap.add_argument("--footnotes", action="store_true", help="keep footnotes (default: drop them)")
    args = ap.parse_args()

    lang = {"en": "english", "he": "hebrew"}.get(args.lang, args.lang)
    formats = {f.strip() for f in args.format.split(",") if f.strip()}
    title = title_from_arg(args.book)

    print(f"Fetching {title!r} from Sefaria...", file=sys.stderr)
    book, en_title = build(title, lang, args.footnotes)
    if not any(s["paragraphs"] for s in book["sections"]):
        sys.exit("Sefaria returned no text for this book.")

    os.makedirs(args.out, exist_ok=True)
    base = os.path.join(args.out, slugify(en_title))
    written = []
    renderers = {"txt": render_txt, "md": render_md, "html": render_html}
    for fmt in ("txt", "md", "html"):
        if fmt in formats or (fmt == "html" and "pdf" in formats):
            with open(f"{base}.{fmt}", "w", encoding="utf-8") as f:
                f.write(renderers[fmt](book))
            if fmt in formats:
                written.append(f"{base}.{fmt}")
    if "pdf" in formats:
        if print_pdf(f"{base}.html", f"{base}.pdf"):
            written.append(f"{base}.pdf")
        if "html" not in formats:
            os.remove(f"{base}.html")

    words = sum(len(p.split()) for s in book["sections"] for p in s["paragraphs"])
    print(f"Done: {len(book['sections'])} sections, ~{words:,} words.", file=sys.stderr)
    for w in written:
        print(w)


if __name__ == "__main__":
    main()
