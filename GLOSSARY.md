# Glossary

The words Magpie uses, in code and in the window. Use these and only these.

**Book.** One title in the Library. A row in `books`, a fixed file under `books/`, and its original under `originals/`.

**Library.** The folder that holds everything: `library.db`, `books/`, `originals/`, `covers/`, `backups/`. Default `~/Books/Magpie`. Every path stored inside it is relative, so the folder can move.

**Original.** The exact bytes someone added, stored once as `originals/<sha256>.epub` and never changed. Two books with the same hash are a duplicate.

**Fix.** Running the fixers over an original to make the book's file. Silent and structural: zip wrapper, XHTML, manifest, cover, metadata gaps, contents page.

**Fixer.** One step of a fix (`core/src/fixers/`). Each reports **changes** in plain English.

**FixPlan.** What to do to an original: the engine version, the book's details (`info`), dismissed suggestions and the **stamp** (uuid and modified date). Replaying a plan on the original gives the same bytes every time. Plans are also the undo record.

**Details** (`BookInfo`). Title, authors, series, publisher, year, ISBN, language, description. "Edit Details" in the window.

**Suggestion.** A proposed title or author with its source and confidence. Never applied silently; it waits for **Review**.

**Clean.** A book that passed every check (`core/src/checks.ts`): a cover big enough to look sharp, a title, an author and a language, nothing waiting in Review, every fixer finished. A seal in the grid, "Clean" on its pill.

**Needs work.** A book that isn't Clean yet. Each thing in the way is a **to-do**: a sentence and the one button that settles it. Waiting suggestions count too. "Needs Work" in the sidebar; `work` (or `review`, when suggestions are waiting) in code.

**Refresh.** Re-fixing books made by an older engine, once, in the background, when the Library opens. Nothing a person chose changes, so it isn't an undo step.

**Locked.** A book a store has locked with DRM. It comes into the Library byte for byte with a lock on it and is never fixed, edited, converted or sent. "DRM" on its pill in the window.

**Review.** Accepting or dismissing suggestions. "Needs Review" in the sidebar.

**Removed.** A book moved out of the way but kept for 30 days, restorable. **Purge** deletes removed books for good.

**Job.** Long work (an import, a Calibre import, sending to a Kobo) that survives a quit and resumes. Made of items, each with a **result**: added, duplicate, unreadable, skipped, sent, failed.

**Look Up Details.** Asking Open Library for what a book is missing (year, publisher, language, description, an unreadable author), by title, author and ISBN only. What comes back is a suggestion like any other, marked as from Open Library. Not "hydrate", "enrich" or "fetch metadata".

**Send.** Getting a book onto a reader. Kindle: a new Mail message to the Send to Kindle address, with the books attached, that the person sends. Kobo: a KEPUB copied to the mounted reader.

**Preview.** A book laid out a screen at a time as a **reader** would show it, with that reader's text size, margins, spacing and fonts. For a fixed book it can show the original too, to see what the fix changed. Never for a locked book.

**Reader.** A device the preview can imitate (`core/src/readers.ts`): a Kindle, a Kobo or an iPhone running Apple Books, with its real screen size.

**Host.** Everything the core needs from the outside world. The Node host and the Tauri host.

**Core.** `core/`. The whole app as a library, reached only through `core.call`.

**Transport.** How the UI reaches the core: HTTP to `magpie serve` in a browser, a Web Worker in the app.

**Tag.** A word a book is filed under, kept in the Library and never written into the book. Each says who put it there: you, Calibre, or Magpie.

**Shelf.** Fiction or Nonfiction, with the genres under it. "Shelves" in the sidebar.

**Vibe.** How a book feels to read (Cozy, Dark, Fast-paced…), from a fixed list.

**Sort.** Putting books on shelves: Magpie's tags from the book's subjects first and the local model second. "Sort onto shelves" in the window; `library.organize` in code.
