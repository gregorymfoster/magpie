---
name: verify-drm
description: "Check a change against Magpie's DRM property test, which runs random sessions on a Library holding locked books of every kind. Use whenever a change adds or changes a command, a job runner, a send format, the converter, the fixers' entry (fix), Library.add/render/repair/deviceCopy, Book.isLocked or lockedDetails, or core/test/drm.test.ts."
---

# Verify DRM

`core/test/drm.test.ts` builds a Library with every kind of lock Magpie knows (Adobe, Apple FairPlay, Readium LCP, a locked Kindle AZW3, a locked book from Calibre with Calibre's cover) beside two unlocked books (one has only obfuscated fonts, which isn't DRM). fast-check makes up sessions of up to 12 things a person can do, aimed at any book: edit, accept suggestions, choose a cover, keep styling, tag, remove, restore, undo, Look Up Details, sort, send to Kindle, Apple Books or a Kobo, preview, import again, empty Removed, quit and reopen.

After every step it checks the promise in CLAUDE.md and ADR 0006:

- A locked book is still listed as locked, its file and original are the store's file byte for byte, it has no fixes, and its details and plan are what they were when it came in. Tags may change; they live in the Library, not the book.
- Nothing Magpie writes anywhere else (converted/, devices/, the Send to Kindle and Apple Books folders, a Kobo) holds a locked book's bytes, its text (the locked EPUBs' pages carry a marker), or an EPUB made from the locked Kindle book.
- A refused step fails with a sentence (`UserError`), never a raw exception.
- A book that isn't locked is never listed as locked.

When a session breaks a rule, fast-check shrinks it to the shortest one it can and prints it as JSON with the broken rule.

## Does your change touch it?

It does if it adds a command or job, a new kind of output (a format, a device, an export), a new path from a book's bytes to anywhere, or changes how a lock is detected. A new command a person can aim at a book needs a new action in `ACTIONS` and the session's `switch`. A new lock kind needs a file in `FILES`. A new output folder is covered as long as it's written through `host.fs.write` or `copy`.

## Run it

```sh
node --test core/test/drm.test.ts            # 25 sessions, about 3 seconds; in just test
DRM_RUNS=1000 node --test core/test/drm.test.ts  # the nightly depth
DRM_SEED=<seed> node --test core/test/drm.test.ts # replay a failure's seed
```

Planted-bug check: with the `locked-send` guard taken out of both `send.kindle` and `Library.deviceCopy`, it fails within a few sessions with `[{"do":"kindle","book":0}]`. Each guard alone is enough, so taking out one is not a failure. After changing covered code, plant a break like that once and confirm it fails, then undo it.

## Read a failure

1. Replay the printed counterexample by hand in a test in `core/test/core.test.ts` through `core.call`, the way "a book with DRM comes in untouched…" does.
2. If the code let a locked book's bytes, text or details through, it's a bug: fix it with that failing test first. Refuse in a sentence from `errors.ts` (`locked-edit`, `locked-send`, `locked-preview`), and guard as close to the bytes as you can (`deviceCopy`, `render`) as well as in the command.
3. If the check is wrong (it calls something a leak that isn't the locked book), fix the check and say why in the commit. Never loosen a rule to let a locked book be changed.

## What it doesn't cover

Lock formats Magpie doesn't detect. What the store's apps do. The Tauri host's writes (same core, other adapter). The UI.

Last confirmed true to the code at commit `ac71b60` (sync commit).
