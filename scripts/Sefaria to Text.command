#!/bin/sh
# Double-click in Finder to open the Sefaria downloader in your browser.
# Keep the Terminal window it opens running while you use the page.
cd "$(dirname "$0")" && exec python3 sefaria-book.py --ui
