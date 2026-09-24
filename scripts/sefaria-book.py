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
    sefaria-book.py                      open the point-and-click page in a browser
    sefaria-book.py <sefaria URL or book title> [-o DIR] [--lang en|he|source]
                    [--format txt,md,html,pdf] [--footnotes]

    sefaria-book.py "https://www.sefaria.org/The_Great_Partnership;_God,_Science,_and_the_Search_for_Meaning?tab=contents"
    sefaria-book.py "Mesillat Yesharim" --lang en

Standard library only, like the rest of this repo's scripts: nothing to install.
"""

import argparse
import html
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import webbrowser

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


class BookNotFound(Exception):
    pass


def fetch_index(title):
    try:
        return fetch_json(f"{API}/v2/raw/index/{quote_ref(title)}")
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            raise BookNotFound(f"Sefaria has no book titled {title!r}. Check the spelling or paste the link.")
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


def print_pdf(html_path, pdf_path, timeout=180):
    """Print the HTML to PDF with headless Chrome.

    On macOS headless Chrome often writes the PDF and then never exits (it can
    sit waiting on the Keychain), so this watches for the finished file rather
    than waiting on the process, and kills Chrome once the file stops growing.
    """
    chrome = find_chrome()
    if not chrome:
        print("  pdf: skipped - no Chrome/Chromium found (set CHROME_BIN, or print the .html from a browser)",
              file=sys.stderr)
        return False
    if os.path.exists(pdf_path):
        os.remove(pdf_path)
    print("  pdf: printing with Chrome...", file=sys.stderr)
    with tempfile.TemporaryDirectory() as profile:
        proc = subprocess.Popen(
            [chrome, "--headless", "--disable-gpu", "--no-sandbox", f"--user-data-dir={profile}",
             "--no-first-run", "--no-default-browser-check", "--disable-extensions",
             "--use-mock-keychain", "--password-store=basic",
             "--no-pdf-header-footer", f"--print-to-pdf={pdf_path}",
             "file://" + os.path.abspath(html_path)],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        last_size, deadline = -1, time.monotonic() + timeout
        try:
            while time.monotonic() < deadline:
                exited = proc.poll() is not None
                size = os.path.getsize(pdf_path) if os.path.exists(pdf_path) else -1
                if size > 0 and (exited or size == last_size):
                    break
                if exited:
                    break
                last_size = size
                time.sleep(1)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    if os.path.exists(pdf_path) and os.path.getsize(pdf_path) > 0:
        return True
    print("  pdf: Chrome did not produce a PDF - open the .html in a browser and print it instead",
          file=sys.stderr)
    return False


def slugify(title):
    s = re.sub(r"[^\w\s-]", "", title.split(";")[0], flags=re.U).strip()
    return re.sub(r"\s+", "_", s) or "book"


# --- point-and-click page ---------------------------------------------------
#
# A small web server on 127.0.0.1 that serves sefaria-book-ui.html and runs
# downloads for it. A page on its own can't save files into a folder of your
# choosing, so the page asks this server to do the fetching and writing.

UI_PAGE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sefaria-book-ui.html")
DEFAULT_OUT = "~/Books"


class Jobs:
    """Downloads in flight or finished, keyed by id. Lives only as long as the server."""

    def __init__(self):
        self.lock = threading.Lock()
        self.items = {}
        self.written = set()   # every file this server wrote; the only ones it will reveal or serve

    def start(self, title, lang, footnotes, formats, out):
        job_id = uuid.uuid4().hex[:12]
        job = {"id": job_id, "state": "running", "done": 0, "total": 0, "skipped": [],
               "files": [], "error": None, "words": 0, "source": None}
        with self.lock:
            self.items[job_id] = job

        def progress(done, total, ref, found):
            with self.lock:
                job.update(done=done, total=total)
                if not found:
                    job["skipped"].append(done)

        def run():
            try:
                book, en_title = build(title, lang, footnotes, progress)
                if not any(sec["paragraphs"] for sec in book["sections"]):
                    raise RuntimeError("Sefaria returned no text for this book.")
                files = write_book(book, en_title, out, formats)
                with self.lock:
                    self.written.update(files)
                    job.update(state="done", words=word_count(book), source=book["source"],
                               files=[{"path": f, "name": os.path.basename(f),
                                       "size": os.path.getsize(f)} for f in files])
            except Exception as e:  # reported to the page, not swallowed
                with self.lock:
                    job.update(state="error", error=friendly_error(e))

        threading.Thread(target=run, daemon=True).start()
        return job_id

    def get(self, job_id):
        with self.lock:
            job = self.items.get(job_id)
            return json.loads(json.dumps(job)) if job else None


def friendly_error(e):
    if isinstance(e, BookNotFound):
        return str(e)
    if isinstance(e, urllib.error.HTTPError):
        return f"Sefaria answered with an error ({e.code}). Try again in a minute."
    if isinstance(e, urllib.error.URLError):
        return "Couldn't reach Sefaria. Check your internet connection and try again."
    if isinstance(e, PermissionError):
        return f"Can't write to that folder: {e.filename}. Pick a different one."
    return str(e) or e.__class__.__name__


def reveal(path, open_file):
    """Show a file in Finder (or the platform's file manager), or open it."""
    if sys.platform == "darwin":
        cmd = ["open", path] if open_file else ["open", "-R", path]
    elif sys.platform.startswith("win"):
        cmd = ["cmd", "/c", "start", "", path] if open_file else ["explorer", "/select,", path]
    else:
        cmd = ["xdg-open", path if open_file else os.path.dirname(path)]
    subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def make_handler(jobs, port):
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send_json(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def trusted(self, write):
            # Only this page may drive the server. The Host check stops DNS
            # rebinding; the Origin check stops other sites posting to localhost.
            if self.headers.get("Host") not in allowed_hosts:
                return False
            origin = self.headers.get("Origin")
            if write and origin not in {f"http://{h}" for h in allowed_hosts}:
                return False
            return True

        def read_json(self):
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return None
            length = int(self.headers.get("Content-Length") or 0)
            try:
                return json.loads(self.rfile.read(min(length, 65536)) or b"{}")
            except ValueError:
                return None

        def do_GET(self):
            if not self.trusted(write=False):
                return self.send_error(403)
            url = urllib.parse.urlsplit(self.path)
            q = urllib.parse.parse_qs(url.query)
            if url.path == "/":
                with open(UI_PAGE, "rb") as f:
                    data = f.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            elif url.path == "/api/defaults":
                self.send_json(200, {"home": os.path.expanduser("~"), "platform": sys.platform})
            elif url.path == "/api/contents":
                book = (q.get("book") or [""])[0].strip()
                if not book:
                    return self.send_json(400, {"error": "Paste a Sefaria link or type a book title."})
                try:
                    self.send_json(200, contents(title_from_arg(book)))
                except Exception as e:
                    self.send_json(404 if isinstance(e, BookNotFound) else 502, {"error": friendly_error(e)})
            elif url.path.startswith("/api/jobs/"):
                job = jobs.get(url.path.rsplit("/", 1)[-1])
                self.send_json(200, job) if job else self.send_json(404, {"error": "No such download."})
            else:
                self.send_error(404)

        def do_POST(self):
            if not self.trusted(write=True):
                return self.send_error(403)
            body = self.read_json()
            if body is None:
                return self.send_json(400, {"error": "Expected JSON."})
            if self.path == "/api/jobs":
                book = str(body.get("book", "")).strip()
                formats = {f for f in body.get("formats", []) if f in ("txt", "md", "html")}
                lang = body.get("lang") if body.get("lang") in ("english", "hebrew", "source") else "english"
                out = os.path.expanduser(str(body.get("out") or DEFAULT_OUT).strip())
                if not book:
                    return self.send_json(400, {"error": "Paste a Sefaria link or type a book title."})
                if not formats:
                    return self.send_json(400, {"error": "Pick at least one format."})
                job_id = jobs.start(title_from_arg(book), lang, bool(body.get("footnotes")), formats, out)
                self.send_json(200, {"id": job_id})
            elif self.path == "/api/reveal":
                path = str(body.get("path", ""))
                with jobs.lock:
                    known = path in jobs.written
                if not known or not os.path.exists(path):
                    return self.send_json(404, {"error": "That file isn't there any more."})
                try:
                    reveal(path, open_file=bool(body.get("open")))
                except OSError:
                    return self.send_json(500, {"error": f"Couldn't open it from here. The file is at {path}"})
                self.send_json(200, {"ok": True})
            else:
                self.send_error(404)

    return Handler


def serve_ui(port, open_browser=True):
    jobs = Jobs()
    for candidate in (port, 0):
        try:
            server = http.server.ThreadingHTTPServer(("127.0.0.1", candidate), None)
            break
        except OSError:
            continue
    else:
        sys.exit(f"Couldn't start the page on port {port}.")
    port = server.server_address[1]
    server.RequestHandlerClass = make_handler(jobs, port)
    url = f"http://127.0.0.1:{port}/"
    print(f"Sefaria downloader is open at {url}\nLeave this window open while you use it; Ctrl+C to stop.",
          file=sys.stderr)
    if open_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.", file=sys.stderr)


# --- main -------------------------------------------------------------------

def print_progress(done, total, ref, found):
    print(f"  [{done}/{total}] {ref}" + ("" if found else "\n    (no text; skipped)"), file=sys.stderr)


def contents(title):
    """The book's table of contents, without fetching any text."""
    index = fetch_index(title)
    schema = index.get("schema") or index
    en_title = index.get("title", title)
    entries = []
    for level, node, ref in walk(schema, en_title, is_root=True):
        entries.append({
            "level": level, "ref": ref,
            "en": "" if node is schema else node_title(node, "en"),
            "he": "" if node is schema else node_title(node, "he"),
        })
    return {"title": en_title, "he_title": node_title(schema, "he"),
            "categories": index.get("categories", []), "entries": entries}


def build(title, lang, footnotes, progress=print_progress):
    """Fetch every section; `progress(done, total, ref, found)` runs after each."""
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
        text, version, direction = fetch_section(ref, lang)
        progress(done, leaves, ref, text is not None)
        if text is None:
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


def write_book(book, en_title, out, formats):
    """Write the requested formats into `out`; return the paths written."""
    os.makedirs(out, exist_ok=True)
    base = os.path.join(out, slugify(en_title))
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
    return written


def word_count(book):
    return sum(len(p.split()) for s in book["sections"] for p in s["paragraphs"])


def main():
    ap = argparse.ArgumentParser(description="Download a Sefaria book as txt/md/html/pdf.")
    ap.add_argument("book", nargs="?", help="Sefaria URL or book title (omit to open the page in a browser)")
    ap.add_argument("-o", "--out", default=".", help="output directory (default: current)")
    ap.add_argument("--lang", default="english", choices=["english", "hebrew", "source", "en", "he"],
                    help="which version to prefer; falls back to the source text (default: english)")
    ap.add_argument("--format", default="txt,md", help="comma-separated: txt,md,html,pdf (default: txt,md)")
    ap.add_argument("--footnotes", action="store_true", help="keep footnotes (default: drop them)")
    ap.add_argument("--ui", action="store_true", help="open the point-and-click page in a browser")
    ap.add_argument("--port", type=int, default=8787, help="port for --ui (default: 8787)")
    ap.add_argument("--no-browser", action="store_true", help="with --ui, don't open a browser tab")
    args = ap.parse_args()

    if args.ui or not args.book:
        serve_ui(args.port, open_browser=not args.no_browser)
        return

    lang = {"en": "english", "he": "hebrew"}.get(args.lang, args.lang)
    formats = {f.strip() for f in args.format.split(",") if f.strip()}
    title = title_from_arg(args.book)

    print(f"Fetching {title!r} from Sefaria...", file=sys.stderr)
    try:
        book, en_title = build(title, lang, args.footnotes)
    except BookNotFound as e:
        sys.exit(str(e))
    if not any(s["paragraphs"] for s in book["sections"]):
        sys.exit("Sefaria returned no text for this book.")

    written = write_book(book, en_title, args.out, formats)
    print(f"Done: {len(book['sections'])} sections, ~{word_count(book):,} words.", file=sys.stderr)
    for w in written:
        print(w)


if __name__ == "__main__":
    main()
