# 5. Shelves: rules first, a small bundled model second

Status: accepted, 2026-10-26

## Context

Greg's Library is 168 books from Calibre and it reads as one long pile. He asked Magpie to sort it with AI: fiction and nonfiction, books by the same author or series, similar genres and vibes, groups in the sidebar, and tags on every book. Magpie's promise is that nothing is uploaded, so a cloud model is out. Argus taught us to put rules before models and to build the scorer first.

About 40% of his books already carry subject headings (BISAC lines like "Business & Economics", Library of Congress subjects in Gutenberg books), and Calibre and Open Library add more. Almost 90% have a blurb.

## Decision

Tags live in the Library (`books.tags`, `books.tags_off`), never in the book file. That keeps sorting fast (no rebuild), lets a locked book be sorted too, and keeps Magpie's guesses out of files people send to readers. Each tag says who put it there: you, Calibre, or Magpie (with its source and how sure it was). Taking off one of Magpie's tags keeps it off.

Sorting uses a fixed vocabulary (`core/src/organize/vocabulary.ts`): Fiction and Nonfiction, 14 fiction and 19 nonfiction genres, 10 vibes. A fixed list keeps the sidebar tidy and lets every guess be scored.

Rules go first (`byRules`): the book's subjects, Calibre's tags, Open Library's subjects and title cues ("A Novel", "Stories") vote for a kind and up to two genres. A Fiction heading is a strong vote rather than the last word, because publishers mislabel (Titan, a Rockefeller biography, says "Fiction").

The model fills only what the rules left empty: bge-small-en-v1.5 (int8 ONNX, 35 MB, MIT) bundled in the app and run with ONNX Runtime's WebAssembly build in the core's worker, one thread, no network. It compares a book's blurb (or its opening pages) with a one-line description of each genre and vibe. It names a kind or genre only when the best answer beats the runner-up by a clear margin, and vibes only above a similarity bar; `bench/organize.ts` measures those margins against books whose subjects say the answer. The Node host runs the same WebAssembly, so the bench measures what ships. Without the model (tests, a build without `just model`) Magpie sorts by rules alone.

New books are sorted as they arrive. A Library from before shelves is sorted once in the background as one undo step. A setting turns it off.

The sidebar shows Shelves (Fiction and Nonfiction, each with its genres), Vibes, Series and Authors with two or more books, and other tags. The list view's columns can be chosen, including Shelf, Genre, Vibe, Tags and Year (first published, when Look Up Details found it).

## Consequences

The app grows by about 46 MB (the model and ONNX Runtime). English blurbs work best; a book in another language mostly relies on its subjects. A generative model would write better vibes but costs gigabytes; if people want that, a setting could point Magpie at a local server such as Ollama later.
