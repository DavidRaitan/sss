# -*- coding: utf-8 -*-
"""Trusted sites: what Sefaria does not have, read from sites the learner trusts.

Two ways in. Hebrew Wikisource has a real API -- search it, then read the page
-- and holds works Sefaria lacks (Sha'ar HaTziyun, Birkei Yosef, the Mordechai
on Berakhot, the Chazon Ish). Every other site (Halacha Yomit, for Rav
Ovadia's rulings) is found by a web search limited to that site, and the page
it points to is then read directly, so what the partner quotes is the site's
own words, with its address, and never a search engine's summary of them.

A site's text belongs to its authors. It is read for this learner's study,
quoted briefly, and always cited with where it came from.
"""

import html
import json
import os
import re
import threading
import urllib.error
import urllib.parse
import urllib.request

LABELS = {"halachayomit.co.il": "Halacha Yomit", "he.wikisource.org": "Wikisource"}
DEFAULT_SITES = ["halachayomit.co.il", "he.wikisource.org"]
WIKISOURCE_API = os.environ.get("CHAVRUTA_WIKISOURCE_API", "https://he.wikisource.org/w/api.php")
# For tests: {"https://halachayomit.co.il": "http://127.0.0.1:port/hy"}.
REWRITE = json.loads(os.environ.get("CHAVRUTA_WEB_REWRITE") or "{}")
DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
HEBREW = re.compile(r"[א-ת]")
_PAGES = {}
_LOCK = threading.Lock()


def clean_sites(sites):
    """Domains only: "halachayomit.co.il", never a URL or anything else."""
    out = []
    for site in sites or []:
        site = str(site).strip().lower()
        site = re.sub(r"^https?://", "", site).split("/")[0]
        if site.startswith("www."):
            site = site[4:]
        if DOMAIN.match(site) and site not in out:
            out.append(site)
    return out[:8]


def label(domain):
    return LABELS.get(domain) or domain


def _get(url, timeout=8):
    for prefix, local in REWRITE.items():
        if url.startswith(prefix):
            url = local + url[len(prefix):]
    request = urllib.request.Request(url, headers={"User-Agent": "chavruta/0.3 (personal study tool)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read(2_000_000)
        charset = response.headers.get_content_charset() or "utf-8"
    return raw.decode(charset, errors="replace")


BLOCK = re.compile(r"</?(p|div|br|li|h[1-6]|td|tr|section|article|blockquote)\b[^>]*>", re.I)


def text_of(page):
    """The body of a page as plain text: the blocks that are mostly Hebrew prose,
    not menus, footers or scripts."""
    page = re.sub(r"(?is)<(script|style|nav|header|footer|form|noscript)\b.*?</\1>", " ", page)
    blocks = BLOCK.split(page)
    out = []
    for block in blocks:
        if not block or len(block) < 2:
            continue
        plain = html.unescape(re.sub(r"<[^>]+>", " ", block))
        plain = re.sub(r"\s+", " ", plain).strip()
        letters = sum(ch.isalpha() for ch in plain) or 1
        if len(plain) >= 40 and len(HEBREW.findall(plain)) / letters > 0.5:
            out.append(plain)
    return "\n".join(out)


def title_of(page, fallback):
    m = re.search(r"(?is)<title[^>]*>(.*?)</title>", page)
    title = html.unescape(re.sub(r"\s+", " ", m.group(1))).strip() if m else ""
    title = re.split(r"\s+[|\-–]\s+", title)[0] if title else ""
    return (title or fallback)[:70]


def page(url, domain, title=""):
    """One page of a trusted site as a citable entry, or None."""
    with _LOCK:
        if url in _PAGES:
            return _PAGES[url]
    entry = None
    try:
        body = _get(url)
        text = text_of(body)
        if text:
            name = title_of(body, title or url)
            entry = {"ref": "%s: %s" % (label(domain), name), "he": text[:6000], "url": url,
                     "dibur": None, "fetched": True, "site": domain}
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        entry = None
    with _LOCK:
        _PAGES[url] = entry
    return entry


def search(domain, query, find):
    """Pages of one site that answer `query`, read. `find(query, domains)` is
    the web search (llm.find_pages)."""
    out = []
    for url, title in find(query, [domain])[:2]:
        entry = page(url, domain, title)
        if entry and entry["ref"] not in [e["ref"] for e in out]:
            out.append(entry)
    return out


def wikisource(query, limit=2):
    """Hebrew Wikisource through its own API: search, then read the pages."""
    try:
        q = urllib.parse.urlencode({"action": "query", "list": "search", "srsearch": query,
                                    "srlimit": limit, "format": "json"})
        hits = json.loads(_get("%s?%s" % (WIKISOURCE_API, q))).get("query", {}).get("search", [])
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return []
    out = []
    for hit in hits[:limit]:
        title = hit.get("title")
        url = "https://he.wikisource.org/wiki/" + urllib.parse.quote(title.replace(" ", "_"))
        with _LOCK:
            if url in _PAGES:
                if _PAGES[url]:
                    out.append(_PAGES[url])
                continue
        entry = None
        try:
            q = urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text",
                                        "format": "json", "formatversion": 2})
            parsed = json.loads(_get("%s?%s" % (WIKISOURCE_API, q))).get("parse") or {}
            text = text_of(parsed.get("text") or "")
            if text:
                entry = {"ref": "Wikisource: %s" % title, "he": text[:6000], "url": url,
                         "dibur": None, "fetched": True, "site": "he.wikisource.org"}
        except (urllib.error.URLError, TimeoutError, OSError, ValueError):
            entry = None
        with _LOCK:
            _PAGES[url] = entry
        if entry:
            out.append(entry)
    return out


def cached(ref):
    with _LOCK:
        return next((e for e in _PAGES.values() if e and e["ref"] == ref), None)


# Which works live on which trusted site, by how people say them.
WORKS = [
    ("halachayomit.co.il", re.compile(
        r"rav ovadia|rabbi ovadia|ovadia yosef|yalkut yosef|yabia omer|yechaveh da'?at|chazon ovadia|"
        r"halacha yomit|הרב עובדיה|עובדיה יוסף|ילקוט יוסף|יביע אומר|יחוה דעת|חזון עובדיה|הלכה יומית", re.I)),
    ("he.wikisource.org", re.compile(
        r"sha'?ar ha-?tziyun|שער הציון|birkei yosef|ברכי יוסף|mordechai|מרדכי|chazon ish|חזון איש|"
        r"wikisource|ויקיטקסט", re.I)),
]
ANY_SITE = re.compile(r"\b(search|check|look) (it )?(up )?(online|the web|the internet|your sites|trusted sites)\b|"
                      r"תחפש באינטרנט|תבדוק באתרים|באתרים", re.I)
