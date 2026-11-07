# 4. Look Up Details asks Open Library, only when asked

Status: accepted, 2026-10-26

## Context

A book's own pages can say who wrote it and what it's called, but rarely when it was first published, who published this edition, or what it's about. Greg asked for one button that fills in the missing details for the whole Library. That needs a catalog, and a catalog is on the internet, which bends "nothing leaves your machine".

## Decision

Look Up Details asks Open Library (openlibrary.org: open data, no account, no key). It runs only when a person presses Look Up (or an AI tool calls `look_up_details`), after a sheet says exactly what will be sent. Only a book's title, author and ISBN go out; never the file, never its text. Requests are paced to about one a second.

Everything it finds is a suggestion stored on the book's plan (`FixPlan.found`) and shown on the review sheet next to the book's own suggestions, marked as coming from Open Library. Nothing is written into a book until it's accepted. Matching is strict: ISBN (0.95), or title plus author surname (0.9); a title alone is 0.7 and starts unticked; anything less suggests nothing. A publisher is only taken from an ISBN match, because a work has many editions. The matched record (work key, first-published year, subjects) is kept on the plan as `FixPlan.catalog` for sorting and tagging; it is never written into the book.

Covers come back the same way (added 2026-10-28, Greg's pick on the covers question). A book whose cover Magpie drew, or whose own cover is small or damaged, also asks for the matched work's picture from covers.openlibrary.org (which may hand it over from archive.org; both are allowed in the app's connect-src). Nothing more is sent: the picture is named by the id the search already returned. It is kept in `covers/chosen/` and offered as a cover suggestion at the match's confidence; a picture shorter than 480 pixels, or one that won't download, is not offered. Accepting it sets `FixPlan.cover` with `from: "openlibrary"`, so it undoes like any other change.

Lookups run in their own job lane so a long run never holds up adding books, and a whole run is one undo.

## Consequences

The privacy promise becomes "your books never leave this Mac; titles are sent to Open Library when you press Look Up". Settings › Privacy, the README and the sheets say so. Tests never touch the network: `MAGPIE_WEB` hands the Node host canned answers. (Series came later; see the 2026-11-07 addendum.)

## Addendum, 2026-11-06: Fix

Greg asked to select books and "fix" them in one press: missing details, covers, formatting. Fix (`books.fix`) is that press. It brings each book up to today's engine, runs the same Look Up Details on it (the same request, the same strict matching, nothing more sent), and accepts what is sure enough to start ticked on the review sheet (0.8 and up: an ISBN or title-and-author match, and the book's own sure suggestions), as pressing Done would. A title-only match (0.7) still waits in Needs Review. Pressing Fix is the person asking, so there's no sheet before it; the job sheet says that only titles, authors and ISBNs go to Open Library. Only fields the person hasn't set are filled, and undoing a Fix takes back only what still holds the value it filled, so an edit made meanwhile stays. The whole run is one undo; the books are then sorted again (its own undo), so subjects Open Library knows can place them on shelves. 

## Addendum, 2026-11-07: series

Open Library now keeps series records, returned by search when `series_name` and `series_position` are asked for in `fields` (same request, nothing more sent). In a check of 16 well-known books from Greg's Mac they were right every time, with no series on the two standalones, but only 8 of 14 series books had one. So Look Up suggests a series from that record at the match's confidence, and when the work has none, it reads the work's editions (`/works/<key>/editions.json`, one more request, only titles were sent to find the work). An English edition's catalogue line such as "Red Rising Series, Book 5" is parsed strictly (a name and a number, or nothing; publishers' series and translated numbering are dropped) and offered unticked at 0.7, except when it names a series this author's other books in the Library are already in: then it's 0.85 and takes that spelling, so the books stay on one shelf. The value is "Name · 5", which `patchFor` splits into series and series number.

## Addendum, 2026-10-28: ratings

Greg asked for Goodreads ratings. Goodreads closed its API in 2020 and forbids scraping, StoryGraph has none, and Hardcover's is a personal token meant for personal use, so none of them fits this rule. Open Library's search already answers with its own readers' ratings (`ratings_average`, `ratings_count`), so Look Up asks for those two fields on the same request. Nothing new leaves the Mac and no new site is asked.

A rating is kept on `FixPlan.catalog` (`rating`, `ratings`) and shown in the inspector and the list's Rating column; it is never written into the book and never waits in review. It is taken only from a sure match (ISBN, or title and author), and shown only once at least five people have rated the work (`MIN_RATINGS`), because Open Library's counts are small. Since every book has a rating to find, Look Up now offers every book that hasn't been looked up, not just books missing details, and books matched before ratings existed are offered once more.
