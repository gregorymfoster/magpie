# Testing

`just check` runs everything below except the bench. Tests go through the narrowest public seam that shows the behaviour, never through internals.

| Seam | Where | What belongs there |
|---|---|---|
| `fix(original, plan)` | `core/test/fixers.test.ts` | One damage, one fixer behaviour. Small hand-made EPUBs from `core/test/fixtures.ts`. |
| `core.call` on the Node host | `core/test/core.test.ts` | Anything a person can do: import, review, undo, remove, Calibre, send. Start here. |
| Host contract | `core/test/host-contract.ts`, run by `cli/test/node-host.test.ts` | What every host must do (atomic writes, SQLite, listing). The Rust half of the Tauri host has the same checks as `cargo test` in `app/src-tauri/src/host.rs`, run by the `mac` CI job. |
| The window | `ui/e2e/*.spec.ts` | Flows through the real UI against `magpie serve` on a temp Library. Set up state with `call()` and assert what a person would see. |
| The model | `verify/LibraryUndo.tla`, run by `just verify` | How a person's edits, background jobs and Undo interleave: every ordering, within small bounds. See `verify/README.md`. |
| Power cuts | `core/test/crash.test.ts`, in `just test` | A person's session cut short before each of its writes, then reopened: nothing missing, nothing left over, each step done or not (ADR 0008). |
| DRM | `core/test/drm.test.ts`, in `just test` | Random sessions (fast-check) on a Library with every kind of locked book: each stays the store's file byte for byte with its details, and none of it is written anywhere else. |
| The bench | `just bench` | Fixer quality across the corpus. Any drop is a regression; it exits non-zero. |

Things that never get tested by mocking: SQLite (use a temp Library), the file system (use a temp dir), the core from the UI (use `magpie serve`).

Look Up Details is checked through `MAGPIE_WEB`: a JSON file of URL fragments and the answers Open Library would give (null for "offline"). Nothing in `just check` reaches the internet.

Sending to a Kindle is checked through `MAGPIE_OPENED`: the Node host logs the Mail message it would have opened (address, subject, attachment paths) instead of asking Mail. Kobos are faked with a folder containing `.kobo` under `MAGPIE_VOLUMES`.
