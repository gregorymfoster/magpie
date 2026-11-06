# 6. Other formats become EPUB once, on the way in

Status: accepted, 2026-11-06

## Context

Greg's books come from the web as EPUB, MOBI and AZW3, sometimes PDF, sometimes inside zip files. Magpie refused anything that wasn't an EPUB, so the first step of the main loop (add a book, get it clean, send it to the iPhone or Kindle) failed for a third of his files. Calling out to Calibre would mean asking people to install it and would break "one core, two hosts".

## Decision

The core converts, in TypeScript, with no new host capability: MOBI and KF8 (AZW3, combo files, PalmDOC, HUFF/CDIC compression), FictionBook 2, plain text, single HTML files, and PDFs that have text (through unpdf, a build of PDF.js that runs in the worker without one of its own). Each converter writes a plain EPUB 3 (`convert/pack.ts`) and the fixers clean it like any other book, so converted books get the same layout, cover, contents and checks.

The original is kept as it came, under its own ending (`originals/<hash>.azw3`). The EPUB made from it is kept in `converted/<hash>-c<CONVERTER>.epub` and is what `fix()` replays on, so `fix()` stays synchronous and pure. Bumping `CONVERTER` makes converted books be made again on the next refresh (bump `ENGINE` with it).

A Kindle file or PDF whose text is encrypted by a store comes in byte for byte, locked, named from its unencrypted header, exactly like a locked EPUB. A password PDF and a scanned PDF (pictures, no text) are turned away with a sentence. RAR archives are turned away with a sentence; zip archives are opened and each book inside added.

## Consequences

Most of the Kindle-format books people actually have are free of DRM (Calibre exports, Project Gutenberg, publishers' direct sales) and now come in. PDF reflow is best for novels and plain prose; pictures and tables in a PDF don't come over, and a textbook or a comic will read badly, which the to-dos and the preview make visible. The worker loads PDF.js (1.6 MB) only when a PDF is added.
