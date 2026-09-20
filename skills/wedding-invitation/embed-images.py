#!/usr/bin/env python3
"""Write the invitation pictures into the page as data URIs.

    python3 embed-images.py index.html en=invite-en.jpg he=invite-he.jpg
    python3 embed-images.py index.html logo=monogram.png

Each image replaces the PASTE_DATA_URI_<CODE> placeholder of that name — a
language code for an invitation, or "logo" for the couple's monogram — or
the data URI already sitting there, so the same command also swaps a
picture out later. The file is edited in place. A picture with a
transparent background keeps it.
"""
import base64
import io
import mimetypes
import re
import sys

MAX_WIDTH = 1400          # wider than any phone needs; keeps the file sendable
JPEG_QUALITY = 88


def encode(path):
    raw = open(path, "rb").read()
    kind = mimetypes.guess_type(path)[0] or "image/jpeg"
    try:
        from PIL import Image
    except ImportError:
        return kind, base64.b64encode(raw).decode()      # as-is, no Pillow here
    im = Image.open(io.BytesIO(raw))
    if im.width > MAX_WIDTH:
        im = im.resize((MAX_WIDTH, round(im.height * MAX_WIDTH / im.width)), Image.LANCZOS)
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        # a monogram cut out of its background stays cut out
        kind = "image/webp"
        buf = io.BytesIO(); im.convert("RGBA").save(buf, "WEBP", quality=90, method=6)
    else:
        kind = "image/jpeg"
        buf = io.BytesIO(); im.convert("RGB").save(buf, "JPEG", quality=JPEG_QUALITY,
                                                   optimize=True, progressive=True)
    return kind, base64.b64encode(buf.getvalue()).decode()


def main(argv):
    if len(argv) < 3 or "=" not in argv[2]:
        sys.exit(__doc__)
    page = argv[1]
    html = open(page, encoding="utf-8").read()

    for pair in argv[2:]:
        code, _, path = pair.partition("=")
        kind, b64 = encode(path)
        uri = "data:%s;base64,%s" % (kind, b64)
        slot = r'(\b%s\s*:\s*")(?:PASTE_DATA_URI_%s|data:image/[^"]*)(")' % (
            re.escape(code), re.escape(code.upper()))
        html, n = re.subn(slot, lambda m: m.group(1) + uri + m.group(2), html, count=1)
        if not n:
            sys.exit("no slot for %r in %s — add   %s: \"PASTE_DATA_URI_%s\","
                     % (code, page, code, code.upper()))
        print("%s  %s  %d KB" % (code, path, len(uri) // 1024))

    open(page, "w", encoding="utf-8").write(html)
    print("wrote %s  (%d KB)" % (page, len(html) // 1024))


if __name__ == "__main__":
    main(sys.argv)
