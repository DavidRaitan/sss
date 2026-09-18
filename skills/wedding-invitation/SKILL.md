---
name: wedding-invitation
description: Build a couple's wedding invitation website — the printed invitation, the date and venue, calendar buttons, a map, and an RSVP form that writes to a Google Sheet, in as many languages as they want, all in one HTML file. Use when someone asks for a wedding invitation site or RSVP page, for a new client's invitation, or for another language on one that exists.
---

# Wedding invitation site

One HTML file per couple. Their printed invitation sits at the top, the
practical parts follow underneath, and the whole thing is self-contained —
pictures embedded, no build step, no dependencies. It can be mailed,
opened from disk, or dropped on any static host.

Down the page: an opening monogram, the invitation itself (a different
picture per language), the date and venue, Add-to-calendar buttons, a map
with a Waze link, and the RSVP form.

## Building one

1. `cp template.html sites/invitations/<couple-slug>/index.html` — the slug
   is the two family names, e.g. `katsof-yativ`.
2. Put the couple's invitation pictures in, one per language:
   ```
   python3 embed-images.py sites/invitations/<slug>/index.html \
       en=invite-en.jpg he=invite-he.jpg
   ```
   Re-running it later swaps a picture out. A language with no picture of
   its own shows the default one, so a fourth language does not need a
   fourth trip to the designer.
3. Fill in the four blocks at the top of the `<script>`: `ENDPOINT`,
   `WEDDING`, `T` (one per language), `INVITE_IMG`.
4. Edit the two venue links in the markup — the `<iframe>` map `q=` and the
   Waze `href` — and the `<title>`.
5. Set up the spreadsheet (below) and paste its URL into `ENDPOINT`.
6. Open it, check both directions, send it over.

## What to ask the client for

- the couple's names, and the two initials for the opening monogram
- the invitation artwork, one file per language
- the date — civil and Hebrew — and the venue
- the times (Kabbalat Panim, Chuppah)
- which languages
- who should own the replies spreadsheet

## The wording

`T` holds one block per language: `name` is what the switcher shows, `dir`
is `"ltr"` or `"rtl"`, and the rest are lines of the page. Adding a
language is copying a block and changing its code — the switcher builds
itself from `T` and hides when there is only one language. Which language
opens first: `?lang=he` in the URL wins, then the visitor's last choice,
then their browser, then `DEFAULT_LANG`.

Times shown in the strip (`18:00`, `18:45`) are in the markup, not in `T` —
digits read the same in every language.

## Where the replies go

`apps-script/Code.gs` is the spreadsheet side: a Google Sheet per couple,
Apps Script behind it, deployed as a web app. The file's own header has the
five steps. Paste the resulting `/exec` URL into `ENDPOINT`.

**Each couple gets their own sheet and their own URL.** Never leave the
previous client's endpoint in a new file — their guests' replies would land
in someone else's spreadsheet.

Left empty, `ENDPOINT` still lets the form run: replies go to the browser
console and the thank-you appears, which is enough to demo the flow.

The form posts `mode:"no-cors"`, which Apps Script needs; the browser
cannot read the response, so a reply that fails to save still shows the
thank-you. Test with a real submission and look at the sheet before
sending the link out.

## If a language has no artwork

`invitation-typeset.html` is the same invitation with the wording as real
HTML over the watercolour bands instead of a picture — branches across the
top, the chuppah scene at the bottom, cream paper between. Any language can
be set in it. Use it to produce the missing picture, or as the invitation
panel itself.

## Fonts

Cormorant Garamond, EB Garamond and Frank Ruhl Libre, from Google Fonts.
They need the visitor online; without them the page falls back to a serif
and still reads correctly.

## Deploying

Netlify, Vercel, Cloudflare Pages, GitHub Pages — serve the folder, no
build command. The file also opens straight from disk.
