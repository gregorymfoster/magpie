# 4. Look Up Details asks Open Library, only when asked

Status: accepted, 2026-10-26

## Context

A book's own pages can say who wrote it and what it's called, but rarely when it was first published, who published this edition, or what it's about. Greg asked for one button that fills in the missing details for the whole Library. That needs a catalog, and a catalog is on the internet, which bends "nothing leaves your machine".

## Decision

Look Up Details asks Open Library (openlibrary.org: open data, no account, no key). It runs only when a person presses Look Up (or an AI tool calls `look_up_details`), after a sheet says exactly what will be sent. Only a book's title, author and ISBN go out; never the file, never its text. Requests are paced to about one a second.

Everything it finds is a suggestion stored on the book's plan (`FixPlan.found`) and shown on the review sheet next to the book's own suggestions, marked as coming from Open Library. Nothing is written into a book until it's accepted. Matching is strict: ISBN (0.95), or title plus author surname (0.9); a title alone is 0.7 and starts unticked; anything less suggests nothing. A publisher is only taken from an ISBN match, because a work has many editions. The matched record (work key, first-published year, subjects) is kept on the plan as `FixPlan.catalog` for sorting and tagging; it is never written into the book.

Lookups run in their own job lane so a long run never holds up adding books, and a whole run is one undo.

## Consequences

The privacy promise becomes "your books never leave this Mac; titles are sent to Open Library when you press Look Up". Settings › Privacy, the README and the sheets say so. Tests never touch the network: `MAGPIE_WEB` hands the Node host canned answers. Series aren't in Open Library's search, so Look Up doesn't fill them.
