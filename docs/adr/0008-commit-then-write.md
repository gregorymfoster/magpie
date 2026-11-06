# 8. A change commits in the database, and its files follow

Status: accepted, 2026-11-06

## Context

A Mac can lose power, crash or be force-quit at any moment. Before this, a change wrote its files and its rows in several separate steps: an edit removed the old book file, wrote the new one, updated the row and then recorded its undo step, each on its own. A test that cuts the power before every write of a person's session (`core/test/crash.test.ts`) found 37 of 91 cut points left the Library broken at the next launch. Examples: an edit that kept the new title but had no undo step; a row pointing to a book file that had been removed; Undo half applied, so a cover was back but the step was gone; emptying Removed deleted a book's files but left its row; a Look Up Details run marked done without its undo step.

## Decision

- Each change builds everything it will write first, then commits all its rows, including its undo step, in one database transaction (`Change` and `commit` in `library.ts`). That commit is the moment the change happens.
- Files follow the commit. A book whose file and thumbnail still have to be written is marked `unwritten` in that same transaction, and files the change stops using are listed in `cleanup`. Both are cleared once the files are done.
- Opening the Library runs `repair`: it writes every unwritten book again from its original and plan (the book is a function of those two, ADR 0002) and removes cleanup files nothing points to.
- Adding a book writes its original first (named by its hash, so a stray one is reused), then the row as unwritten, then the file.
- A job's finisher commits with the statement that marks the job done, so a Look Up Details run is never done without its one undo step.
- `core/test/crash.test.ts` runs in `just check`. The project skill `verify-crash-safety` says how to read a failure and keep the test true to the code.

## Consequences

A crash can leave a book's file a version behind its row for as long as the Mac is off; the next launch puts it right before anything else runs. A Calibre stand-in cover (`covers/<id>.jpg`) on a book cut mid-import is lost, because repair can only rebuild what the plan says. The guarantee rests on the host's promise that each file write and each SQL batch is all or nothing.
