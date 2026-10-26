# Testing

`just check` runs everything below except the bench. Tests go through the narrowest public seam that shows the behaviour, never through internals.

| Seam | Where | What belongs there |
|---|---|---|
| `fix(original, plan)` | `core/test/fixers.test.ts` | One damage, one fixer behaviour. Small hand-made EPUBs from `core/test/fixtures.ts`. |
| `core.call` on the Node host | `core/test/core.test.ts` | Anything a person can do: import, review, undo, remove, Calibre, send. Start here. |
| Host contract | `core/test/host-contract.ts`, run by `cli/test/node-host.test.ts` | What every host must do (atomic writes, SQLite, listing). The Rust half of the Tauri host has the same checks as `cargo test` in `app/src-tauri/src/host.rs`, run by the `mac` CI job. |
| The window | `ui/e2e/*.spec.ts` | Flows through the real UI against `magpie serve` on a temp Library. Set up state with `call()` and assert what a person would see. |
| The bench | `just bench` | Fixer quality across the corpus. Any drop is a regression; it exits non-zero. |

Things that never get tested by mocking: SQLite (use a temp Library), the file system (use a temp dir), the core from the UI (use `magpie serve`).

Sending to a Kindle is checked through `MAGPIE_OPENED`: the Node host logs the Mail message it would have opened (address, subject, attachment paths) instead of asking Mail. Kobos are faked with a folder containing `.kobo` under `MAGPIE_VOLUMES`.
