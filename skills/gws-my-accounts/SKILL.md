---
name: gws-my-accounts
description: "Decides WHICH Google account a task belongs to on this machine. Read before running any gws command or touching Google Drive, Docs, Sheets, Gmail or Calendar. YouTube, Descript, video, channel and Torah Meirah work uses the 'torah' account; everything else uses the default 'main' account. Also use when the user says 'my other account', 'the YouTube one', or asks which account something is in."
metadata:
  openclaw:
    category: "productivity"
    requires:
      bins:
        - gws
        - gws-account
---

# Which Google account to use

Two Google accounts are configured on this machine. `gws-accounts` covers the
mechanics of switching; this skill decides **which one a given task belongs to**.

| Account | Use it for |
|---|---|
| `main` (default) | Everything not listed below — Drive, Docs, Sheets, personal and general work |
| `torah` | YouTube, Descript, video production, the channel, Torah Meirah content |

Run `gws-account list` to see the email behind each name.

## Rules

1. **Default to `main`.** Unless the request clearly belongs to the
   YouTube/Descript/video side, use `main` — plain `gws ...`, no prefix, no
   environment variable. This is roughly 90% of requests.

2. **Use `torah` when the request involves** YouTube (videos, thumbnails,
   titles, scripts, analytics, uploads), Descript (projects, transcripts,
   exports), the channel, or Torah Meirah content:

   ```bash
   gws-account run torah -- drive files list
   ```

3. **Subject matter decides, not file type.** "The sheet tracking my video
   uploads" is `torah` work even though it is a spreadsheet. "A sheet" with no
   such context is `main`.

4. **Never guess between the two.** If the request could plausibly mean either,
   ask which one — always before writing, sharing, moving or deleting anything.
   A wrong-account read is a wasted call; a wrong-account write lands real data
   in the wrong Google account.

5. **If an account name does not resolve**, run `gws-account list` and use the
   names it prints. The names here can be renamed at any time.

## Examples

| Request | Account |
|---|---|
| "list my recent Drive files" | `main` |
| "make a sheet for my monthly budget" | `main` |
| "open that doc I wrote yesterday" | `main` |
| "find the script for my last video" | `torah` |
| "put this thumbnail in Drive" | `torah` |
| "what's in my Descript exports folder" | `torah` |
| "the spreadsheet where I track uploads" | `torah` |
| "summarise the doc about the channel" | `torah` |

## Enabled services

Only **Drive, Docs and Sheets** are authorized. Gmail and Calendar are *not* —
their APIs were never enabled in the Cloud project. If asked for mail or
calendar, say so rather than attempting a call that will fail with a 403; the
user must enable those APIs and re-run
`GWS_SERVICES=drive,docs,sheets,gmail,calendar gws-account login <name>`.

## Token expiry

The OAuth app is in Testing mode, so Google revokes refresh tokens every 7 days.
On `invalid_grant`, tell the user to run:

```bash
GWS_SERVICES=drive,docs,sheets gws-account login <name>
```

It needs a browser, so never attempt it unattended.
