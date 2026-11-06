# Formal checks

`just verify` (part of `just check`) model-checks these with TLC. It needs Java 11 or later; TLC is downloaded once into `verify/.tla/`.

## LibraryUndo.tla

**The promise.** A change a person makes stays until they undo it, and every change has an undo step that takes back that change and nothing else, however the background jobs (Look Up Details, the refresh after an engine bump, a sort) interleave with the window. The harm when it breaks: a corrected title or author quietly reverts, or shelves appear that Undo can't take off.

**The rules**, each an invariant:

| Rule | In plain words |
| --- | --- |
| `EditsStay` | No job puts back a book's old details over a person's edit. |
| `ShelvesStay` | Shelves a sort put on stay until that sort is undone; undoing an edit doesn't take them off. |
| `EveryChangeUndoable` | Every edit and every shelf a sort puts on sits in a history row. |

**Where each action is in the code** (as of the sync commit in `.claude/skills/verify-library-undo/SKILL.md`):

| Action | Code |
| --- | --- |
| `YouEdit`, `YourEditLands`, `YourEditIsRecorded` | `Library.edit` (and the same shape: `review`, `keepStyle`, `setCover`) |
| `YouPressUndo`, `UndoAfterSortStops` | core's `"history.undo"`, `Library.nextUndo`, `Library.undo` |
| `UndoPutsBackOneStep`, `UndoDeletesTheRow` | `Library.undo` before the fix |
| `LookupFinds`, `LookupResultLands` | the `lookup` runner in `core.ts`, `Library.lookedUp` |
| `LookupRunEnds`, `LookupReadsABook`, `LookupIsRecorded` | the lookup finisher in `Context.openLibrary`, `Library.recordLookups` |
| `RefreshOne` | the `refresh` runner, `Library.refresh` |
| `SortIsQueued` | `Context.sort` (`Library.openStep`, then the job) |
| `SortReadsABook`, `SortTagsABook`, `SortAddsToItsStep`, `SortStops` | the `organize` runner, `Library.organize`; `Jobs.runJob` checks for a cancel before each item |

An action is one stretch of code between two awaits. With `Locked = TRUE` (today), each `Library` method that writes runs inside `Library.exclusive`, so the whole method is one action. `Locked = FALSE` is the code at 31cfa41, before the fix; `just verify` checks that it still breaks every rule, so the check is known to be able to fail.

**Bounds and what's left out.** Two books, two edits, two presses of Undo, one lookup run, one refresh and one sort (about 112,000 states, 2 seconds). By hand, `MaxEdits = 3, MaxUndos = 3` checks 1.5 million states in about 20 seconds. Left out: two processes with the same Library open (the app and `magpie mcp`; the lock is per process), a crash halfway through a change, the 200-step cap on history, Removed and restore, tag edits by a person, and what the fixers write.
