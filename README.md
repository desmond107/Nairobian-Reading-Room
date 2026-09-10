# Nairobian Reading Room

PDF to audio platform. A quiet way to hear your books.

Turns PDF books into narrated audio in the browser. Extraction, structure and
speech all run on the reader's own machine; the only network calls are to a
cloud voice provider, and only if one is configured.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 49 tests, including four real PDFs
npm run fixtures   # regenerate the test PDFs (needs python3 + reportlab + pillow)
```

## Why the extraction works the way it does

Reading a PDF aloud is mostly a layout problem. `getTextContent` hands back
drawing-order fragments, and narrating those directly gives you running heads
in the middle of sentences, two columns interleaved, and words split across
line breaks read as two words. The pipeline is four passes:

1. **Geometry** (`lib/pdf/layout.ts`) — fragments get top-left coordinates, then
   columns are found by sweeping the x-axis for a gap no text crosses. This runs
   on *fragments*, before lines are built, because a two-column page shares
   baselines across the gutter: group into lines first and the two columns fuse
   into one line, erasing the gutter before anything can look for it. Full-width
   and page-centred boxes are excluded from the sweep, since a title or a running
   head crosses the gutter by design. Lines are then built inside each column and
   read band by band, so a spanning title stays above the columns it introduces.

2. **Furniture** (`lib/pdf/headers.ts`) — a phrase in the top or bottom band of a
   quarter of the pages is a running head. Numbers are masked before counting, so
   "Page 12" and "Page 13" collapse to one form, and the leading and trailing
   words are counted separately, because whether a head arrives as one line or
   two depends on that page's column layout.

3. **Structure** (`lib/pdf/blocks.ts`) — paragraphs, headings, tables, captions
   and footnotes, one column at a time. A trailing hyphen before a lowercase
   continuation is a soft break and the hyphen goes; before a capital it is a
   real compound and stays. Superscript note markers are stripped *before* the
   paragraph-break test, or `...entirely away.14` looks like a line that stops
   mid-clause and fuses two paragraphs into one.

4. **Chapters** (`lib/pdf/chapters.ts`) — the embedded outline when the publisher
   wrote one, heading heuristics otherwise, even sections labelled by their
   opening words as a last resort.

## Speech

`lib/tts/chunker.ts` splits blocks into sentences, respecting abbreviations,
initials and decimals, and breaks an over-long sentence at its strongest clause
boundary. Two forces set the size: prosody wants whole sentences, and the Web
Speech API drops utterances past roughly fifteen seconds. Each chunk carries the
silence to hold after it — comma, semicolon, full stop, paragraph, chapter —
scaled by playback rate and the reader's pacing preference.

Playback is one async loop (`state/player.ts`). Pause parks it, skip and seek
retire it via a generation counter. Browser voices are the default; ElevenLabs,
Google and OpenAI are behind the same interface, with the next chunk prefetched
during the current one so hosted voices stay gapless.

Known Web Speech quirks handled: voices arriving asynchronously, Chrome's
fifteen-second cutoff (a keep-alive ping), and late `onend` events from a
cancelled utterance (each utterance is tagged).

## The room

The theme is a reading room at night: ink and walnut grounds, parchment text,
and antique brass where a binding would carry gilt lettering. Prose is set in a
system old-style serif, which is the one face on every machine that was drawn
for reading at length.

Behind the app (`components/ReadingRoom.tsx`) are three shelves receding into
lamplight, with the front row reflected on the floor. They are drawn, not
photographed, and generated from fixed seeds in `lib/art/shelves.ts`: spine
widths, bindings, gilt bands, raised hubs, the occasional leaning volume and the
occasional gap where a book has been taken away. The whole scene costs a few
kilobytes and stays sharp at any viewport.

The shelves are real elements in a `perspective` scene rather than a picture of
shelves. Each row sits at its own distance from the camera and the rig turns a
few degrees towards the pointer, so the rows part from one another as it moves.
That parallax between rows is what reads as depth; shading alone only ever looks
painted on. Spine heights follow a slow wave — not meant to be noticed, but it
is the one place where the two halves of this app, a library and a voice reading
aloud, are the same shape.

Reading comes first, so the room drops to a third of its strength whenever a
book is open, and the reading column keeps its own ground. In light theme it
falls back to a faint ghost behind warm paper. It holds still for
`prefers-reduced-motion`, and it can be switched off entirely under Appearance.

## What it says for itself

`components/Masthead.tsx` is the one part of the interface whose whole job is to
answer "what is this?" before a reader has to try it and find out. On a first
visit it states the proposition and four supporting points. Once there are books
on the shelf that question is answered, so the points fold away and the
statement stays: a returning reader came for their library, not the pitch.

## Storage

IndexedDB (`lib/store/db.ts`): books, extracted blocks, chapters, the original
file, positions, bookmarks, the reading queue and settings. Block ids never move
once assigned, so bookmarks and saved positions survive a settings change; what
footnote mode and the content toggles change is the derived play queue
(`lib/book/queue.ts`), not the stored order.

## Edge cases

| Case | Behaviour |
|---|---|
| Password-protected | Prompts, and prompts again on a wrong password |
| Scanned / image-only | Detected by text coverage, offers Tesseract OCR |
| Very large books | Page-at-a-time with a yield between pages; 300 pages in ~0.6s and +32MB heap |
| Poor extraction | Per-paragraph correction, saved back to the book |
| Tables | Detected and announced rather than read, unless asked |

## Keyboard

Space play/pause · ←/→ sentence · ↑/↓ paragraph · B bookmark · +/− speed

## Credits

Nairobian Reading Room — PDF to audio platform. A quiet way to hear your books.

Developed by Desmond Kinoti · <desmond@nubigo.com>

Copyright © 2026 Desmond Kinoti. All rights reserved.
# Nairobian-Reading-Room
