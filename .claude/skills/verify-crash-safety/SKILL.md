---
name: verify-crash-safety
description: "Check a change against Magpie's crash test, which cuts the power before every write of a person's session and checks the Library after a restart. Use whenever a change touches a Library method that writes files or rows (core/src/library/library.ts: add, render, commit, sweep, repair, purgeRemoved, undo), the job queue's end of a job (core/src/jobs.ts), a finisher in core/src/core.ts, the schema, or core/test/crash.test.ts."
---

# Verify crash safety

`core/test/crash.test.ts` runs one person's session through `core.call`: add two books, look one up, accept a suggestion, edit a title, choose a cover, sort, remove, undo three times, remove again, empty Removed. It runs once to count the writes (each file write, copy, move, remove, folder, SQL statement or batch). Then once per write, with a host that loses power just before that write: it and everything after it never happen. Then it opens the Library again, the way a restart would, and checks it.

The promise it guards: whenever the power goes, the next launch opens a Library where every book's original, file and cover are there and match its row, nothing is left over, no job is stuck, and each step the person took is either fully done or not done at all. A step whose job was queued (import, lookup, sort) carries on after the restart and must end done.

`docs/adr/0008-commit-then-write.md` says how the code keeps it: a change commits all its rows, its undo step included, in one transaction; files follow; `unwritten` and `cleanup` let `repair` finish the rest at the next open.

## Does your change touch it?

It does if it adds or moves a write to the disk or the database in the Library, the job queue or a finisher. The rules:

- The rows a person's change makes, and its undo step, go in one `Change` and one `commit`, never in separate `db.run` calls. (`organize` batches a book's shelves with its line in the sort's step itself.)
- A book's file and thumbnail are written only after the row that names them commits, with `unwritten = 1` in that commit (`render` does this).
- A file is removed only by `sweep`, after the rows that stopped using it commit, and only when no row points to it.
- A finisher commits the `end` statement it is given with its own writes.
- Something new that a restart must finish needs a column or table the next open reads in `repair`.

If the session doesn't reach your new write, add a step to `SESSION` that does, named for what it promises once it returns.

## Run it

```sh
node --test core/test/crash.test.ts
```

It runs in `just test` and so in `just check`, in about 5 seconds. To replay one cut point: `CRASH_AT=48 node --test core/test/crash.test.ts`.

It has no switch for the code before the fix. After changing covered code, break it once on purpose the way a rule guards against (for example, move the history row out of `commit` into its own `db.run`, or remove the old file in `render` before the commit) and confirm the test fails, then undo that break. At 6c6870e (before ADR 0008) it failed 37 of 91 cut points.

## Read a failure

Each line names the cut ("power cut before write 48 of 91, during \"edit\"") and what was wrong after the restart: a missing or changed file, a file left over, a job stuck, or the Library showing something other than the state before or after the step.

1. Replay it alone with `CRASH_AT`. Find the write: add a `console.log(new Error().stack)` in `losesPower`'s `write` when `writes === at`.
2. Ask what the restart saw: which rows had committed and which files existed. If two writes that must happen together are separate, they need to be one batch, or the second must be something `repair` can finish from the first.
3. If the code is right and the check is wrong (a rule the session can't keep for a reason the ADR accepts), change the check and write the reason in the commit. Don't widen what "before or after" allows to make a failure pass.

## What it doesn't cover

A write torn halfway: it trusts the host that each file write renames a whole temp file and each batch is one transaction (`core/test/host-contract.ts`). Data the disk loses after saying it was written. Two processes with one Library open. Settings, device sends, Calibre and Kobo imports, keep styling, tags, restore: same `commit`, but not in the session. Interleavings of a person and background jobs: the `verify-library-undo` skill.

Last confirmed true to the code at commit `59d1f71` (sync commit).
