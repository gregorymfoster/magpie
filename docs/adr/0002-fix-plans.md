# 2. Keep the original, store a fix plan

Status: accepted, 2026-10-25

## Context

People need to trust that Magpie won't wreck a book, and every edit has to be undoable.

## Decision

The original bytes are stored once by hash and never changed. A book's file is always `fix(original, plan)`. The plan holds the engine version, the details, dismissed suggestions and a stamp (uuid and modified date) so the output is byte-for-byte deterministic. Edits and reviews write a new plan and record the old one in `history`; undo restores it and re-renders.

Structural fixes are silent. Title and author changes are suggestions that wait for review, because those are the ones that can be wrong.

## Consequences

Undo is exact and cheap. A better engine can re-render the whole library from originals. Storage roughly doubles, which is acceptable for EPUBs.
