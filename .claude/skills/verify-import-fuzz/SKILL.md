---
name: verify-import-fuzz
description: "Check a change against Magpie's import fuzz test, which damages real books of every kind and imports them. Use whenever a change touches importing (Library.add, expand, archiveBooks, sniff), a converter (core/src/convert/), Book.load or OpfDoc, a fixer or the checks, errors.ts codes, or core/test/fuzz.test.ts."
---

# Verify import fuzz

People drop anything on Magpie. `core/test/fuzz.test.ts` takes a rich EPUB (nav, NCX, stylesheet, cover, linked chapters) and the MOBI, AZW3, FictionBook, PDF, text and HTML fixtures, and fast-check damages them: bytes flipped, the end cut off, and for the EPUB, files rewritten with markup that breaks parsers, dropped, renamed or joined by files with hostile names (`../escape.xhtml`, a 300-character name, a second `mimetype`), or a cover with absurd dimensions. Some go in a zip of several. Each is imported through `core.call("books.import")` into one Library.

The promise: every file comes out one of two ways.

- **Added**: the book opens (`Book.load`, with a package), every fixer ran without crashing (`report.errors` is empty), and its original is the file as it came, named by its hash.
- **Turned away**: `unreadable`, with a sentence from `errors.ts`.

Never a raw exception (a job result with the "Something went wrong" sentence), never over 20 seconds.

## Does your change touch it?

It does if it changes how a file becomes a book or what a fixer reads. A parser call is the usual way in: `@xmldom/xmldom` throws on fatal markup (no root, mismatched tags, a declaration midway) even with an `onError` handler, so every `parseFromString` on a book's own text needs a `try`. Decide what a parse failure means where you add one: a page that won't parse is left as it is; a package that won't parse is `BookError("no-package")`; a table of contents that won't parse is rebuilt.

A new input kind needs a seed in `SEEDS`. A new kind of damage worth trying goes in `NASTY`, `ENTRY_NAMES` or `DAMAGED_EPUB`.

## Run it

```sh
node --test core/test/fuzz.test.ts                  # 60 files, a few seconds; in just test
FUZZ_RUNS=3000 node --test core/test/fuzz.test.ts   # the nightly depth
FUZZ_SEED=<seed> FUZZ_RUNS=<n> node --test core/test/fuzz.test.ts   # replay
FUZZ_TALLY=/tmp/tally node --test core/test/fuzz.test.ts  # count fixer crashes instead of stopping at the first
```

When it was written (at the commit after 6c96f9d) it found five bugs within 1,000 files: a cut-off FB2, a page with no root element, a package with two roots, and a damaged NCX each threw out of the import or crashed a fixer, and a zip of web pages with no package was added as a book no reader opens.

## Read a failure

The failure names the file and, for a raw exception, the stack from running `sniff`, `toEpub` and `fix` on it outside the Library. Find the first frame in `core/src`.

1. A parser or a read on damaged input threw: catch it there and decide what that damage means (above). Write a small test of that damage in `core/test/fixers.test.ts` first.
2. A fixer crashed: make it handle the damage, ideally by repairing it, since repairing damaged books is the job.
3. A book was added that doesn't open: refuse it in `fix` with a `BookError` code and a sentence in `errors.ts`, rather than keep a file no reader opens.
4. If the check is wrong (a file that is fine counted as broken), fix the check and say why in the commit. Don't drop a kind of damage to make it pass.

## What it doesn't cover

Real-world damage the mutations don't make (the bench corpus covers that: `just bench`). Huge files and zip bombs beyond the limits in `epub.ts`. The quality of what a fixer does with damage, only that it doesn't crash. Calibre and Kobo imports.

Last confirmed true to the code at commit `HEAD` (sync commit).
