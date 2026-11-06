---
name: verify-naming
description: "Check a change against Magpie's file name property test: any title or author becomes a name every disk Magpie writes to can hold. Use whenever a change touches core/src/naming.ts, adds a place Magpie writes a file named from a book's details, or changes core/test/naming.test.ts."
---

# Verify naming

Every file and folder name Magpie writes is built in `core/src/naming.ts` (CLAUDE.md: no spaces, readable in Finder). Book details come from anywhere, so `core/test/naming.test.ts` throws every kind of text at it with fast-check: any Unicode including lone surrogates and control characters, graphemes, dots and slashes, long runs of CJK, Hangul and astral letters (two UTF-16 units each), and known troublemakers.

The promise:

- `slug` is letters and digits joined by single hyphens: never empty, no spaces or punctuation, never starting with a dot, valid text (no half of a surrogate pair), at most 120 bytes of UTF-8.
- `bookPath` is exactly `Author/Title.ext`, each part a slug, each a file name APFS (255 bytes of UTF-8) and a Kobo's FAT32 card (255 UTF-16 units) can hold.
- `deviceName` (Kobo, Send to Kindle, Apple Books) has none of `\ / : * ? " < > |` or spaces, is valid text, and fits those limits.
- `unique` never returns a taken name, and keeps the folder and the ending (`.kepub.epub` whole).

## Does your change touch it?

It does if it changes `naming.ts` or names a file from book details anywhere else (which it shouldn't: add a function to `naming.ts`). A new place with its own limits (another device's file system) belongs in `fits` in the test.

Changing what `slug` returns for ordinary titles renames books' files the next time they're rebuilt (`sameBase` in `library.ts`), so keep English names as they are.

## Run it

```sh
node --test core/test/naming.test.ts                    # 500 each, under a second; in just test
NAMING_RUNS=20000 node --test core/test/naming.test.ts  # the nightly depth
```

When it was written it found two bugs that a test with ordinary generators missed until long runs of one letter were added: a long title in an astral script was cut in the middle of a character (a lone surrogate, which no disk takes as a name), and a long Korean or Japanese author and title made a device name of up to 492 bytes, which no Mac disk can hold. Korean names were also written as decomposed jamo; slugs are NFC again now.

## Read a failure

fast-check prints the shortest text it found. Call `slug`, `bookPath` or `deviceName` on it in a scratch script and compare its length in UTF-16 units and UTF-8 bytes against the limit the assertion names. Fix `naming.ts`; never narrow the generators to avoid a script people use.

## What it doesn't cover

Windows reserved names (CON, NUL: Magpie is Mac only, and Kobo cards take them). Two different titles mapping to one slug (that's `unique`'s job, checked against the disk at write time).

Last confirmed true to the code at commit `eecc8f3` (sync commit).
