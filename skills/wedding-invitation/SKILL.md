---
name: wedding-invitation
description: Build a single-file wedding invitation website from a couple's details — the watercolour chuppah design, any number of languages, Hebrew right-to-left, nothing to install. Use when someone asks for a wedding invitation page or site, an invitation in more languages, or an invitation for a new client.
---

# Wedding invitation

One HTML file per couple. The artwork is embedded inside it, so the file works
on its own — mailed, opened from a phone, or uploaded to any static host.

## What to do

1. Copy `template.html` to `sites/invitations/<couple-slug>/index.html`.
   The slug is the two family names: `katsof-yativ`, `levi-cohen`.
2. Open it and edit the `T` object near the bottom — one block per language.
   Nothing else in the file needs touching.
3. Set the `<title>` in the head to the couple's names (the language blocks
   each carry their own `title`, which replaces it once the page loads).
4. Screenshot it in both directions before handing it over — Hebrew
   especially, since the two parent columns swap sides.

## The details you need from the client

Ask for these once, then fill every language from them:

- the couple's names, as they should appear
- the verse or opening line above them
- the date — civil and Hebrew, as they want it written
- the venue
- Kabbalat Panim and Chuppah times
- both sets of parents
- which languages

## The `T` object

```js
he: {
  label: "עב",         // what the switcher shows
  dir:   "rtl",        // "rtl" for Hebrew and Arabic, "ltr" for the rest
  title: "...",        // browser tab
  verse: "...",        // one line, or an array for several
  intro: ["...","..."],
  names: "שם &amp; שם", // write the ampersand as &amp;
  when:  ["...","..."],
  times: ["...","..."],
  parentsA: ["..."],   // the side printed first in reading order
  parentsB: ["..."]    // the other side
}
```

- A string is one line; an array is several lines.
- `parentsA` lands on the left in English and on the right in Hebrew — the
  same family stays in the same slot, the page flips it. Don't swap them
  by hand for the Hebrew block.
- Set any key to `""` to hide that part for that language alone.
- Adding a language is copying a block and changing its code. The switcher
  builds itself from whatever is in `T`, and hides itself when there is
  only one.

## Which language opens first

`?lang=fr` in the URL wins, then the visitor's last choice, then their
browser language, then `DEFAULT_LANG`. Set `AUTO_DETECT = false` to always
open in the default.

## Fonts

Loaded from Google Fonts: EB Garamond and Great Vibes for the Latin
readings, Frank Ruhl Libre and Gveret Levin for Hebrew. They need the
visitor to be online; without them the page falls back to a plain serif and
still reads correctly. For a different look, change the `<link>` in the head
and the `font-family` lines in the CSS — the names are in `.names`.

## New artwork

The template carries its art as two embedded JPEGs: a band of branches
across the top and the chuppah scene across the bottom, with plain cream
paper between them. To use a different design, crop those two bands out of
the new artwork (they must contain no text — the wording is real HTML on top
of the cream), then base64 them into `ART.top` and `ART.bottom`, and match
`--paper` to the artwork's paper colour.

## Deploying

Any static host: Netlify, Vercel, Cloudflare Pages, GitHub Pages. No build
command, no dependencies. Serving the folder is enough, and the file also
opens straight from disk.
