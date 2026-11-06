---
name: verify-library-undo
description: "Check a change against Magpie's model of how a person's edits, background jobs (Look Up Details, refresh, sort) and Undo interleave. Use whenever a change touches a Library method that writes a plan, tags or history, core/src/jobs.ts, the lookup/refresh/organize runners or history.undo in core/src/core.ts, or verify/LibraryUndo.tla."
---

# Verify Library undo

`verify/LibraryUndo.tla` is a TLA+ model of one Magpie process: the person (edits, Undo), the net lane (a Look Up Details run) and the local lane (a refresh, then a sort), all changing the same books. TLC checks every ordering of their steps within small bounds. `verify/README.md` lists the rules in plain words and which code each action stands for. Read it first.

The promise it guards: a change a person makes stays until they undo it, and every change has an undo step that takes back that change and nothing else. When it breaks, a corrected title quietly reverts, or shelves appear that Undo can't take off.

## Does your change touch it?

It does if it changes any of these, or adds code that writes the same things (`books.plan`, `books.tags`, the `history` table):

| Covered code | Model actions |
| --- | --- |
| `core/src/library/library.ts`: `exclusive`, `edit`, `review`, `keepStyle`, `setCover`, `tag`, `remove`, `restore`, `refresh`, `lookedUp`, `recordLookups`, `organize`, `openStep`, `appendToStep`, `nextUndo`, `undo`, `rebuild`, `snapshot`, `record` | all |
| `core/src/jobs.ts`: lanes, `runJob` (the cancel check before each item), `cancel`, `settled`, `pending` | `Sort*`, `Lookup*`, `RefreshOne`, `UndoAfterSortStops` |
| `core/src/core.ts`: `Context.sort`, the `lookup`, `refresh` and `organize` runners, the lookup finisher in `openLibrary`, `"history.undo"` | `SortIsQueued`, `Lookup*`, `RefreshOne`, `Sort*`, `YouPressUndo` |

A new command that writes a book or history must go through `Library.exclusive` and record history; if it adds a new kind of write (a new column, a new job that rebuilds books), the model needs a new action.

Last confirmed true to the code at commit `59d1f71` (sync commit).

## Run it

```sh
just verify
```

It needs Java 11 or later (`brew install openjdk` on a Mac; CI installs Temurin 21). It downloads TLC 1.7.4 into `verify/.tla/` once. It takes about 10 seconds and prints one line per run:

- `Today's code keeps every rule (N states checked).` is the pass.
- `The code before the fix breaks <Rule>: <actions>.` must appear for each of `EditsStay`, `ShelvesStay` and `EveryChangeUndoable`. These run the model with `Locked = FALSE`, which describes the code at 31cfa41, before the fix. They prove the check can still fail. If one stops failing, the model lost the power to catch that bug; fix the model.

A bigger bound, by hand (about 20 seconds, 1.5 million states): copy `verify/LibraryUndo.cfg`, set `MaxEdits = 3` and `MaxUndos = 3`, and run TLC on it with `java -cp verify/.tla/tla2tools-1.7.4.jar tlc2.TLC -workers auto -deadlock -config <copy> LibraryUndo.tla` from `verify/`.

## Read a failure

Read every TLC result with the `/statechart` skill, with the view `verify/LibraryUndo.view.ts` (it words each state and step for a person). It gives the shortest path to each broken rule as numbered steps like "you edit a book's details", "the lookup's result is written".

Then decide which kind of failure it is:

1. **Replay the path against the real code.** For each step, find the code in the README's table and ask whether it can happen in that order. The usual tool is a test in `core/test/` that stops a job halfway with `pause()` from `core/test/fixtures.ts` (it holds the first file read matching a path) and does the person's step meanwhile; see "a details edit made while Look Up Details is working on the same book stays" in `core.test.ts` and the two Undo tests in `organize.test.ts`.
2. **Every step can happen:** it's a bug in the code. Report it with the path in the code's words and the harm in one sentence. Do not weaken the rule or the model to make it pass. Fix the code with a failing test first.
3. **A step can't happen in the code:** the model is wrong. Fix the model to match the code, say what was wrong, and run again.

## When you change covered code on purpose

Update the model from the code, before you run it, not from the result:

- One action is one stretch of code between two awaits, or a whole method when it runs inside `Library.exclusive`. If a write moves out of `exclusive`, split its action at each await; if code moves in, merge them.
- Keep names from the code. Add a row to the README's table for a new action.
- Change a rule only when the promise itself changed on purpose, and cite where (an ADR, the commit message, a test). Write the old and new wording in your commit.
- `Locked = FALSE` stays the code at 31cfa41. Don't update it.

Then run `just verify`. If it passes, break the new code in the model the way the rule guards against (for example, split a newly locked write back into a read and a write) and confirm `just verify` fails, then undo that break. Move the sync commit above to the commit you checked, only after you have confirmed the model describes the code there.

## What it doesn't cover

Two processes with one Library open (the app and `magpie mcp`; `exclusive` is per process, and `Jobs` in each process drains the same `jobs` table). A crash halfway through a change (the `verify-crash-safety` skill). The 200-step history cap. Removed, restore and purge. A person's tag edits racing a sort's guesses (the sort re-reads tags under the lock; not modelled). What the fixers write. For changes that skipped this skill, use `/maintain-formal-verification-skill`.
