# Miranda3

See who you've left on read — and go reply.

A local-first Mac tool that surfaces the 1:1 iMessage conversations still
**waiting on you**, buckets them by how long they've been waiting
(**1 / 7 / 30 / 90 days**), and gives each one a **Go to iMessage** button that
jumps straight to that thread in Messages. It also scores your overall
responsiveness 0–100.

This is a rebuild of Miranda2 ("Reply or Die") — same proven export core,
slimmed to a pure static app (no server) with the day-bucket inbox.

## How it works

Two local pieces. Nothing is uploaded; your messages never leave your Mac.

1. **`export.command`** — a double-clickable script. Reads
   `~/Library/Messages/chat.db` (and Contacts for names), categorizes spam,
   delivery/automated texts, and group chats, and writes
   `~/Desktop/miranda5_messages.json`.
2. **`index.html`** — a static web app. Drop the JSON on it (or click **Try
   sample data**). It classifies, scores, lists who's waiting on you, and
   deep-links back into Messages.

## Quick start

### Just want to see it?

Open `index.html` in any browser and click **Try sample data**. No Mac
permissions, no export — it runs on a generated dataset that fills all four
buckets.

### Run on your real iMessage data (macOS)

1. Grant **Full Disk Access** to Terminal:
   System Settings → Privacy & Security → Full Disk Access → enable Terminal.
2. Double-click **`export.command`**. It writes
   `~/Desktop/miranda5_messages.json`, prints a summary, and opens Finder with
   that file already selected so it's easy to find.
3. Open **`index.html`** and drop that JSON onto the page (or click **Load my
   export**).

Re-run the export whenever you want fresh data. Your loaded data, dismissals,
and score history persist in the browser (`localStorage`).

**Refresh without re-picking the file.** In Chromium browsers (Chrome / Edge /
Arc / Brave), once you've loaded `miranda5_messages.json` the app remembers it:
click **↻ refresh** in the top bar to re-read it in one click — no file picker.
Better yet, leave the tab open and the app **auto-reloads** whenever the export
script rewrites the file (look for the **↻ live** marker). Safari doesn't support
this and falls back to the normal "load other file" picker.

## The inbox

- **Buckets (1 / 7 / 30 / 90 days)** are cumulative windows — "7 days" includes
  everything from the last 7 days, "30 days" the last 30, etc. The count on each
  chip is how many people are waiting within that window.
- A thread is **waiting on you** when it's a 1:1 or **small group chat
  (5 people or fewer, including you)** that isn't spam/delivery and *they* sent
  the last real message (tapbacks/reactions don't count). Bigger group chats are
  skipped. Group threads are tagged **group · N** in the list.
- **Go to iMessage →** opens that conversation via the `sms:` URL scheme.
- **✕ Dismiss** removes a thread you don't owe a reply to. It comes back if they
  text again. View/restore dismissed threads from the footer.

## Score (0–100)

Computed over your eligible personal threads (spam, delivery, groups, and
dismissed are excluded):

- **Reply rate — 45%** · share of threads where you got the last word
- **Reply speed — 25%** · penalizes a slow average response on open threads
- **Hanging — 30%** · penalizes open threads, older ones weigh more

Labels: ≤15 "actively ghosting 👻" · ≤35 "bad texter 😬" · ≤55 "hit or miss 🎲"
· ≤75 "solid 👍" · ≤90 "on it ⚡️" · else "ELITE responder 🏆".

## What gets filtered out

- **Spam** — 5/6-digit short codes, "verification code", "reply STOP", "claim
  your", etc.
- **Delivery / automated** — DoorDash, FedEx, "out for delivery", "your order"…
- **Group chats** — only small ones (≤5 people) show in the inbox (tagged
  *group · N*); larger group chats are skipped. Groups are always excluded from
  the responsiveness score.

Classification is heuristic; the underlying data is still exported so nothing is
silently lost.

## Files

```
export.command    Mac iMessage exporter (bash + Python) → JSON
index.html        The web app (open this)
styles.css        Styles (light + dark mode)
app.js            DOM glue: load, render, filter, dismiss, deep-link
core.js           Pure logic: classify, bucket, score (no DOM — unit-tested)
sample-data.js    Sample dataset generator (relative to "now")
test/smoke.js     Node smoke test for core.js
```

## Develop / test

```bash
node test/smoke.js   # core logic tests (no browser/Mac needed)
```

## Limitations

- macOS only — depends on the iMessage SQLite schema.
- Export-based — re-run `export.command` for fresh data (no live sync).
- Classification is heuristic.

## Privacy

All processing is local. The web app loads JSON from disk and keeps state in
`localStorage`. Nothing is sent anywhere.
