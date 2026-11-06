---------------------------- MODULE LibraryUndo ----------------------------
(***************************************************************************)
(* How a person's changes, the background jobs and Undo interleave in one  *)
(* Magpie process. Every name points at core/src/library/library.ts,       *)
(* core/src/jobs.ts or core/src/core.ts; see verify/README.md.             *)
(*                                                                         *)
(* A book is its plan (books.plan) and its tags (books.tags). A plan holds *)
(* only what this question needs: `info`, the details a person set         *)
(* (Library.edit), `found`, what Look Up Details found (Library.lookedUp), *)
(* and `engine` (Library.refresh). History rows are the history table.     *)
(*                                                                         *)
(* Three actors run side by side, as they do in the app: the person        *)
(* (core.call from the window), the net lane (lookup jobs) and the local   *)
(* lane (refresh, then a sort). Each action is one stretch of code between *)
(* two awaits, or one whole method when the Library's lock covers it.      *)
(*                                                                         *)
(* Locked = TRUE is the code as it is: Library writes run one at a time    *)
(* (Library.exclusive), Undo takes back only what a step changed, and Undo *)
(* stops a sort that is still running before it takes it back.             *)
(* Locked = FALSE is the code before those fixes (31cfa41), kept so that   *)
(* `just verify` can show every rule still fails on it.                    *)
(***************************************************************************)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS Books,      \* a few book ids
          MaxEdits,   \* how many details edits the person makes
          MaxUndos,   \* how many times the person presses Undo
          Locked      \* TRUE: today's code. FALSE: the code before the fix

ASSUME Locked \in BOOLEAN

BookSeq == CHOOSE s \in [1..Cardinality(Books) -> Books] : \A i, j \in DOMAIN s : i # j => s[i] # s[j]
N == Len(BookSeq)

NoRow == [id |-> 0, kind |-> "none", entries |-> <<>>]

VARIABLES
    plan,        \* books.plan:  [Books -> [info, found, engine]]
    tags,        \* books.tags:  [Books -> {"none", "sorted"}]
    hist,        \* history rows, oldest first: [id, kind, entries]
    nextId,      \* next history id
    \* the person
    pc, pB, pRead, edits, undos, uRow, uIdx,
    \* the net lane: one Look Up Details run over every book
    lPhase, lI, lRead, lPrevs, lSteps,
    \* the local lane: a refresh over every book, then a sort over every book
    rI, rRead, sStep, sPhase, sI, sBefore, sCancel,
    \* what the person should see: their last edit (or what Undo put back) and the sort's tags
    expect, expectTags

vars == <<plan, tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx,
          lPhase, lI, lRead, lPrevs, lSteps, rI, rRead, sStep, sPhase, sI, sBefore, sCancel,
          expect, expectTags>>

Snap(b) == [plan |-> plan[b], tags |-> tags[b]]
RowIds == {hist[i].id : i \in DOMAIN hist}
Append1(row) == /\ hist' = Append(hist, row)
                /\ nextId' = nextId + 1

Init ==
    /\ plan = [b \in Books |-> [info |-> 0, found |-> 0, engine |-> 0]]
    /\ tags = [b \in Books |-> "none"]
    /\ hist = <<>>
    /\ nextId = 1
    /\ pc = "idle" /\ pB = (CHOOSE b \in Books : TRUE) /\ pRead = Snap(CHOOSE b \in Books : TRUE)
    /\ edits = 0 /\ undos = 0 /\ uRow = NoRow /\ uIdx = 0
    /\ lPhase = "read" /\ lI = 1 /\ lRead = plan[BookSeq[1]] /\ lPrevs = <<>> /\ lSteps = <<>>
    /\ rI = 1 /\ rRead = plan[BookSeq[1]]
    /\ sStep = 0 /\ sPhase = "read" /\ sI = 1 /\ sBefore = Snap(BookSeq[1]) /\ sCancel = FALSE
    /\ expect = [b \in Books |-> 0]
    /\ expectTags = [b \in Books |-> "none"]

-----------------------------------------------------------------------------
(* The person edits a book's details: Library.edit.                         *)
(* snapshot, then rebuild (several awaits, then UPDATE books), then record. *)

EditWrite(b, read) ==
    /\ plan' = [plan EXCEPT ![b] = [read.plan EXCEPT !.info = edits + 1]]
    /\ expect' = [expect EXCEPT ![b] = edits + 1]
EditRow(b, read) ==
    [id |-> nextId, kind |-> "edit",
     entries |-> <<[b |-> b, before |-> read, after |-> [read EXCEPT !.plan = [read.plan EXCEPT !.info = edits + 1]]]>>]

YouEdit(b) ==
    /\ pc = "idle" /\ edits < MaxEdits
    /\ IF Locked
         THEN /\ EditWrite(b, Snap(b))
              /\ Append1(EditRow(b, Snap(b)))
              /\ edits' = edits + 1
              /\ UNCHANGED <<pc, pB, pRead>>
         ELSE /\ pc' = "edit-write" /\ pB' = b /\ pRead' = Snap(b)
              /\ UNCHANGED <<plan, expect, hist, nextId, edits>>
    /\ UNCHANGED <<tags, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps, rI, rRead,
                   sStep, sPhase, sI, sBefore, sCancel, expectTags>>

YourEditLands ==
    /\ pc = "edit-write"
    /\ EditWrite(pB, pRead)
    /\ pc' = "edit-record"
    /\ UNCHANGED <<tags, hist, nextId, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel, expectTags>>

YourEditIsRecorded ==
    /\ pc = "edit-record"
    /\ Append1(EditRow(pB, pRead))
    /\ edits' = edits + 1
    /\ pc' = "idle"
    /\ UNCHANGED <<plan, tags, pB, pRead, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

-----------------------------------------------------------------------------
(* Undo: Library.undo, behind core's "history.undo".                         *)
(* It drops empty rows, reads the newest row's steps once, puts back each    *)
(* step's `before`, newest first, then deletes the row by id.                *)

SortOpen == sStep # 0 /\ sPhase # "done"
\* Rows Undo keeps although they are empty: a running sort's step (today's code only).
Kept(row) == row.entries # <<>> \/ (Locked /\ SortOpen /\ row.id = sStep)
Kept1(row) == row.entries # <<>>

\* What one step puts back. Before the fix: the whole plan when it differs from now, and always the tags.
\* Today: only what the step changed.
UndoEntry(e) ==
    LET b == e.b
        putPlan == IF Locked THEN e.before.plan # e.after.plan ELSE plan[b] # e.before.plan
        putTags == IF Locked THEN e.before.tags # e.after.tags ELSE TRUE
    IN /\ plan' = IF putPlan THEN [plan EXCEPT ![b] = e.before.plan] ELSE plan
       /\ tags' = IF putTags THEN [tags EXCEPT ![b] = e.before.tags] ELSE tags

\* The person's intent after Undo: an edit row puts back the details it replaced; a sort row the tags.
UndoExpect(row, e) ==
    /\ expect' = IF row.kind = "edit" THEN [expect EXCEPT ![e.b] = e.before.plan.info] ELSE expect
    /\ expectTags' = IF row.kind = "sort" THEN [expectTags EXCEPT ![e.b] = e.before.tags] ELSE expectTags

UndoAll(row) ==
    \* The whole row at once, newest step first. With one entry per book per row, order doesn't change the result.
    /\ plan' = [b \in Books |->
                  IF \E i \in DOMAIN row.entries : row.entries[i].b = b
                  THEN LET e == row.entries[CHOOSE i \in DOMAIN row.entries : row.entries[i].b = b]
                       IN IF e.before.plan # e.after.plan THEN e.before.plan ELSE plan[b]
                  ELSE plan[b]]
    /\ tags' = [b \in Books |->
                  IF \E i \in DOMAIN row.entries : row.entries[i].b = b
                  THEN LET e == row.entries[CHOOSE i \in DOMAIN row.entries : row.entries[i].b = b]
                       IN IF e.before.tags # e.after.tags THEN e.before.tags ELSE tags[b]
                  ELSE tags[b]]
    /\ expect' = [b \in Books |->
                  IF row.kind = "edit" /\ \E i \in DOMAIN row.entries : row.entries[i].b = b
                  THEN row.entries[CHOOSE i \in DOMAIN row.entries : row.entries[i].b = b].before.plan.info
                  ELSE expect[b]]
    /\ expectTags' = [b \in Books |->
                  IF row.kind = "sort" /\ \E i \in DOMAIN row.entries : row.entries[i].b = b
                  THEN row.entries[CHOOSE i \in DOMAIN row.entries : row.entries[i].b = b].before.tags
                  ELSE expectTags[b]]

YouPressUndo ==
    /\ pc = "idle" /\ undos < MaxUndos
    /\ undos' = undos + 1
    /\ IF Locked
         THEN LET kept == SelectSeq(hist, Kept)
              IN IF kept = <<>>
                   THEN /\ hist' = kept
                        /\ UNCHANGED <<plan, tags, expect, expectTags, pc, uRow, sCancel>>
                   ELSE IF SortOpen /\ kept[Len(kept)].id = sStep
                     \* core's history.undo: the newest change is a sort still running, so stop it first.
                     THEN /\ sCancel' = TRUE /\ pc' = "undo-wait" /\ hist' = kept
                          /\ UNCHANGED <<plan, tags, expect, expectTags, uRow>>
                     ELSE /\ UndoAll(kept[Len(kept)])
                          /\ hist' = SubSeq(kept, 1, Len(kept) - 1)
                          /\ UNCHANGED <<pc, uRow, sCancel>>
         ELSE LET kept == SelectSeq(hist, Kept1)
              IN /\ hist' = kept
                 /\ IF kept = <<>>
                      THEN UNCHANGED <<pc, uRow>>
                      ELSE /\ uRow' = kept[Len(kept)]
                           /\ pc' = "undo-step"
                 /\ UNCHANGED <<plan, tags, expect, expectTags, sCancel>>
    /\ uIdx' = IF Locked \/ SelectSeq(hist, Kept1) = <<>> THEN 0 ELSE Len(SelectSeq(hist, Kept1)[Len(SelectSeq(hist, Kept1))].entries)
    /\ UNCHANGED <<nextId, pB, pRead, edits, lPhase, lI, lRead, lPrevs, lSteps, rI, rRead, sStep, sPhase, sI, sBefore>>

\* Today's code: the sort has stopped, so its whole step is taken back at once.
UndoAfterSortStops ==
    /\ pc = "undo-wait" /\ ~SortOpen
    /\ LET kept == SelectSeq(hist, Kept)
       IN IF kept = <<>>
            THEN /\ hist' = kept /\ UNCHANGED <<plan, tags, expect, expectTags>>
            ELSE /\ UndoAll(kept[Len(kept)])
                 /\ hist' = SubSeq(kept, 1, Len(kept) - 1)
    /\ pc' = "idle"
    /\ UNCHANGED <<nextId, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel>>

\* Before the fix: one step of the row per action (each is a snapshot, a rebuild and an UPDATE).
UndoPutsBackOneStep ==
    /\ pc = "undo-step" /\ uIdx > 0
    /\ UndoEntry(uRow.entries[uIdx])
    /\ UndoExpect(uRow, uRow.entries[uIdx])
    /\ uIdx' = uIdx - 1
    /\ UNCHANGED <<hist, nextId, pc, pB, pRead, edits, undos, uRow, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel>>

\* DELETE FROM history WHERE id = ?: steps a sort added since Undo read the row go with it.
UndoDeletesTheRow ==
    /\ pc = "undo-step" /\ uIdx = 0
    /\ hist' = SelectSeq(hist, LAMBDA r : r.id # uRow.id)
    /\ pc' = "idle"
    /\ UNCHANGED <<plan, tags, nextId, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

-----------------------------------------------------------------------------
(* The net lane: one Look Up Details run (jobs.ts, runners.lookup).          *)
(* Per book, Library.lookedUp: snapshot, then rebuild with found.            *)
(* When the run ends, Library.recordLookups reads each book, then records.  *)

LookupFinds ==
    /\ lPhase = "read" /\ lI <= N
    /\ LET b == BookSeq[lI] IN
       IF Locked
         THEN /\ plan' = [plan EXCEPT ![b] = [plan[b] EXCEPT !.found = 1]]
              /\ lPrevs' = Append(lPrevs, [b |-> b, found |-> plan[b].found])
              /\ lI' = lI + 1
              /\ UNCHANGED <<lPhase, lRead>>
         ELSE /\ lRead' = plan[b] /\ lPhase' = "write"
              /\ UNCHANGED <<plan, lPrevs, lI>>
    /\ UNCHANGED <<tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lSteps, rI, rRead,
                   sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

LookupResultLands ==
    /\ lPhase = "write"
    /\ LET b == BookSeq[lI] IN
       /\ plan' = [plan EXCEPT ![b] = [lRead EXCEPT !.found = 1]]
       /\ lPrevs' = Append(lPrevs, [b |-> b, found |-> lRead.found])
    /\ lI' = lI + 1 /\ lPhase' = "read"
    /\ UNCHANGED <<tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lRead, lSteps, rI, rRead,
                   sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

LookStep(p) == [b |-> p.b, before |-> [plan |-> [plan[p.b] EXCEPT !.found = p.found], tags |-> tags[p.b]],
                after |-> Snap(p.b)]

LookupRunEnds ==
    /\ lPhase = "read" /\ lI > N
    /\ IF Locked
         THEN /\ Append1([id |-> nextId, kind |-> "lookup", entries |-> [i \in DOMAIN lPrevs |-> LookStep(lPrevs[i])]])
              /\ lPhase' = "done"
              /\ UNCHANGED lSteps
         ELSE /\ lPhase' = "record" /\ lSteps' = <<>>
              /\ UNCHANGED <<hist, nextId>>
    /\ UNCHANGED <<plan, tags, pc, pB, pRead, edits, undos, uRow, uIdx, lI, lRead, lPrevs, rI, rRead,
                   sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

LookupReadsABook ==
    /\ lPhase = "record" /\ Len(lSteps) < Len(lPrevs)
    /\ lSteps' = Append(lSteps, LookStep(lPrevs[Len(lSteps) + 1]))
    /\ UNCHANGED <<plan, tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

LookupIsRecorded ==
    /\ lPhase = "record" /\ Len(lSteps) = Len(lPrevs)
    /\ Append1([id |-> nextId, kind |-> "lookup", entries |-> lSteps])
    /\ lPhase' = "done"
    /\ UNCHANGED <<plan, tags, pc, pB, pRead, edits, undos, uRow, uIdx, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

-----------------------------------------------------------------------------
(* The local lane: a refresh over every book (Library.refresh: snapshot,     *)
(* then rebuild with today's engine), then a sort (core's sort opens one     *)
(* history step; each item is Library.organize, then Library.addToStep).    *)

RefreshOne ==
    /\ rI <= 2 * N
    /\ LET b == BookSeq[(rI + 1) \div 2] IN
       IF Locked
         THEN /\ plan' = [plan EXCEPT ![b] = [plan[b] EXCEPT !.engine = 1]]
              /\ rI' = rI + 2
              /\ UNCHANGED rRead
         ELSE IF rI % 2 = 1
           THEN /\ rRead' = plan[b] /\ rI' = rI + 1 /\ UNCHANGED plan
           ELSE /\ plan' = [plan EXCEPT ![b] = [rRead EXCEPT !.engine = 1]]
                /\ rI' = rI + 1 /\ UNCHANGED rRead
    /\ UNCHANGED <<tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   sStep, sPhase, sI, sBefore, sCancel, expect, expectTags>>

\* core's sort: openStep, then the job is queued. It can happen at any time.
SortIsQueued ==
    /\ sStep = 0
    /\ sStep' = nextId
    /\ Append1([id |-> nextId, kind |-> "sort", entries |-> <<>>])
    /\ UNCHANGED <<plan, tags, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sPhase, sI, sBefore, sCancel, expect, expectTags>>

SortRow(e) == [hist EXCEPT ![CHOOSE i \in DOMAIN hist : hist[i].id = sStep] =
                 [@ EXCEPT !.entries = Append(@, e)]]
\* UPDATE history ... WHERE id = ?: nothing happens when the row is gone.
AddToStep(e) == hist' = IF sStep \in RowIds THEN SortRow(e) ELSE hist

\* jobs.ts runs the local lane in order: the sort waits for the refresh.
SortGoes == sStep # 0 /\ rI > 2 * N /\ sPhase \in {"read", "write", "add"}

SortStops ==
    /\ SortGoes /\ sPhase = "read" /\ (sI > N \/ sCancel)
    /\ sPhase' = "done"
    /\ UNCHANGED <<plan, tags, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sI, sBefore, sCancel, expect, expectTags>>

SortReadsABook ==
    /\ SortGoes /\ sPhase = "read" /\ sI <= N /\ ~sCancel
    /\ LET b == BookSeq[sI] IN
       IF Locked
         \* Library.organize's write and core's addToStep run under the lock, from a fresh read.
         THEN /\ tags' = [tags EXCEPT ![b] = "sorted"]
              /\ expectTags' = [expectTags EXCEPT ![b] = "sorted"]
              /\ IF tags[b] # "sorted" THEN AddToStep([b |-> b, before |-> Snap(b), after |-> [Snap(b) EXCEPT !.tags = "sorted"]])
                                       ELSE UNCHANGED hist
              /\ sI' = sI + 1
              /\ UNCHANGED <<sPhase, sBefore>>
         ELSE /\ sBefore' = Snap(b) /\ sPhase' = "write"
              /\ UNCHANGED <<tags, expectTags, hist, sI>>
    /\ UNCHANGED <<plan, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sCancel, expect>>

SortTagsABook ==
    /\ SortGoes /\ sPhase = "write"
    /\ LET b == BookSeq[sI] IN
       /\ tags' = [tags EXCEPT ![b] = "sorted"]
       /\ expectTags' = [expectTags EXCEPT ![b] = "sorted"]
    /\ sPhase' = IF sBefore.tags # "sorted" THEN "add" ELSE "read"
    /\ sI' = IF sBefore.tags # "sorted" THEN sI ELSE sI + 1
    /\ UNCHANGED <<plan, hist, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sBefore, sCancel, expect>>

SortAddsToItsStep ==
    /\ SortGoes /\ sPhase = "add"
    /\ AddToStep([b |-> BookSeq[sI], before |-> sBefore, after |-> [sBefore EXCEPT !.tags = "sorted"]])
    /\ sPhase' = "read" /\ sI' = sI + 1
    /\ UNCHANGED <<plan, tags, nextId, pc, pB, pRead, edits, undos, uRow, uIdx, lPhase, lI, lRead, lPrevs, lSteps,
                   rI, rRead, sStep, sBefore, sCancel, expect, expectTags>>

-----------------------------------------------------------------------------

AllDone ==
    /\ pc = "idle" /\ lPhase = "done" /\ sPhase = "done"
    /\ UNCHANGED vars

Next ==
    \/ \E b \in Books : YouEdit(b)
    \/ YourEditLands \/ YourEditIsRecorded
    \/ YouPressUndo \/ UndoAfterSortStops \/ UndoPutsBackOneStep \/ UndoDeletesTheRow
    \/ LookupFinds \/ LookupResultLands \/ LookupRunEnds \/ LookupReadsABook \/ LookupIsRecorded
    \/ RefreshOne
    \/ SortIsQueued \/ SortStops \/ SortReadsABook \/ SortTagsABook \/ SortAddsToItsStep
    \/ AllDone

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* The rules. Each is a promise in CLAUDE.md or ADR 0002.                    *)

\* A change a person makes to a book's details stays until they undo it. No job puts old details back.
EditsStay == \A b \in Books : plan[b].info = expect[b]

\* Shelves a sort put on stay until that sort is undone. Undoing something else doesn't take them off.
ShelvesStay == \A b \in Books : tags[b] = expectTags[b]

\* Every change has an undo step: an edit's details and a sort's shelves are each in a history row
\* (except in the moment between the write and recording the step).
EditMidway(b) == pc \in {"edit-record"} /\ pB = b
SortMidway(b) == sPhase = "add" /\ BookSeq[sI] = b
UndoMidway == pc \in {"undo-step", "undo-wait"}
InRow(kind, b) == \E i \in DOMAIN hist : hist[i].kind = kind /\ \E j \in DOMAIN hist[i].entries : hist[i].entries[j].b = b

EveryChangeUndoable ==
    \A b \in Books :
        /\ (expect[b] # 0 /\ ~EditMidway(b) /\ ~UndoMidway) => InRow("edit", b)
        /\ (expectTags[b] = "sorted" /\ ~SortMidway(b) /\ ~UndoMidway) => InRow("sort", b)

TypeOK ==
    /\ pc \in {"idle", "edit-write", "edit-record", "undo-step", "undo-wait"}
    /\ lPhase \in {"read", "write", "record", "done"}
    /\ sPhase \in {"read", "write", "add", "done"}
=============================================================================
