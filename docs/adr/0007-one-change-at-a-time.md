# 7. Library changes run one at a time, and are model-checked

Status: accepted, 2026-11-06

## Context

A change to a book reads its plan, waits on files, then writes the whole plan back. Background jobs (Look Up Details, the refresh after an engine bump, a sort) do this while the person keeps working, so two changes to one book could overlap and the later write would silently drop the earlier one. Mapping the code for formal verification found three such bugs, all reproduced at 31cfa41: a lookup or refresh could put an old title back over a person's edit; Undo pressed while a sort was queued or running deleted the sort's growing history step, so the rest of the sort had no undo; and undoing a details edit put back the book's shelves from before the edit, taking off ones a sort had added since. Tests only reached them once a model said where to look.

## Decision

- Every `Library` method that writes a plan, tags or history runs through `Library.exclusive`, one after another. Slow work that doesn't write (a sort's guesses, a lookup's network calls) stays outside. No such method calls another.
- Undo puts back only what a step changed (its `before` where it differs from its `after`).
- Undo whose newest change is a sort still going stops the sort after its current book, then takes back the whole sort.
- `verify/LibraryUndo.tla` models these interleavings, and `just verify` (in `just check`) model-checks it with TLC. It also checks that the code from before the fix still breaks each rule, so the check is known to be able to fail. The project skill `verify-library-undo` says how to keep it true to the code.

## Consequences

An edit can wait for one book's rebuild (tens of milliseconds) while a job is mid-book. `just check` needs Java. The lock is per process: the app and `magpie mcp` with the same Library open can still overlap, which the model leaves out.
