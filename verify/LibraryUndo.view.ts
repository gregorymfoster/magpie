// How /statechart words the model for a person: one region each for you, Look Up Details and the background lane.
// `node .claude/skills/statechart/scripts/statechart.ts verify/LibraryUndo.tla --config verify/LibraryUndo.cfg --view verify/LibraryUndo.view.ts`

type V = Record<string, unknown>;

const you: Record<string, string> = {
  idle: "Browsing",
  "edit-write": "Edit saving",
  "edit-record": "Edit saved, undo step pending",
  "undo-step": "Undoing",
  "undo-wait": "Undo waiting for the sort to stop",
};
const lookup: Record<string, string> = { read: "Looking up", write: "Result landing", record: "Recording the run", done: "Lookup done" };

export const title = "Edits, background jobs and Undo";

export const state = (v: V) => ({
  You: you[v.pc as string],
  "Look Up Details": lookup[v.lPhase as string],
  Background:
    (v.sPhase as string) === "done"
      ? "Sort done"
      : (v.sStep as number) === 0
        ? "Refreshing, no sort queued"
        : (v.sPhase as string) === "read"
          ? "Sort going"
          : "Sort putting a book on shelves",
});

const steps: Record<string, string | null> = {
  YouEdit: "you edit a book's details",
  YourEditLands: "your edit is written",
  YourEditIsRecorded: "your edit gets its undo step",
  YouPressUndo: "you press Undo",
  UndoAfterSortStops: "the sort stops and is undone",
  UndoPutsBackOneStep: "Undo puts one book back",
  UndoDeletesTheRow: "Undo finishes",
  LookupFinds: "the lookup reads a book",
  LookupResultLands: "the lookup's result is written",
  LookupRunEnds: "the lookup run ends",
  LookupReadsABook: "the run's undo reads a book",
  LookupIsRecorded: "the run gets its undo step",
  RefreshOne: "a book is re-checked",
  SortIsQueued: "a sort is queued",
  SortStops: "the sort stops",
  SortReadsABook: "the sort reads a book",
  SortTagsABook: "the sort puts a book on shelves",
  SortAddsToItsStep: "the sort adds the book to its undo step",
  AllDone: null,
};

export const step = (action: string) => steps[action] ?? action;
