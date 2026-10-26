# Working on Magpie

Magpie is a Mac app that fixes and manages EPUBs. Everything runs locally; nothing is uploaded. It never touches DRM.

## The one rule for checking your work

`just check` is the only gate. CI runs exactly it. Run it before every push. It type-checks, checks formatting and the design ratchet, runs the core and host tests, builds the UI and drives it headlessly with Playwright. If it's green, push to `main` (no PRs while nobody depends on this).

Faster loops while you work:

- `just test` for core behaviour. Most changes should start with a failing test in `core/test/core.test.ts`.
- `just call books.list '{"state":"review"}'` runs any core command against `~/Books/Magpie` (or `--library <dir>`). `node cli/src/main.ts commands` lists them.
- `just shots` writes screenshots of every screen, light and dark, to `ui/shots/`. Look at them after any UI change.
- `just bench` scores the fixers against the damaged-twin corpus. A drop in any number is a regression.

## How the code is shaped

```
core/   the whole app as a library: fixers, Library, jobs, Calibre, Kindle, Kobo
cli/    Node host, `magpie` CLI, `magpie serve` (HTTP for the UI), `magpie mcp` (docs/ai.md)
ui/     React window. Talks to the core only through ui/src/transport
app/    Tauri shell: Rust host functions, menus, updater. Thin on purpose
bench/  fixer scoring; corpus/ builds the corpus
```

There is one door into the core: `core.call(command, args)` and `core.on(event)`. The command table in `core/src/core.ts` is the API; its types (`Args<K>`, `Result<K>`) flow to the UI, CLI and MCP server. Add behaviour by adding or extending a command there, with a test through `core.call`.

The core never imports `node:*` or touches the DOM. It reaches the world only through `Host` (`core/src/host.ts`): files, SQLite, opening a path, environment. There are two hosts, Node (`cli/src/node-host.ts`) and Tauri (`ui/src/transport/tauri.ts` plus `app/src-tauri/src/host.rs`), and both must pass `core/test/host-contract.ts`. If you need a new capability, add it to `Host`, both adapters and the contract.

Read `GLOSSARY.md` before naming things. Decisions and why are in `docs/adr/`. What gets tested where is in `docs/testing.md`.

## Rules that are easy to break

- Never copy, decrypt or detect-and-strip DRM. A DRM'd file is refused with a sentence.
- The original file is never modified. `originals/<sha256>.epub` is kept and every fix is a `FixPlan` replayed on it, which is also how undo works.
- Every write a user can make is undoable (`history.undo`). New write commands must record history.
- Errors shown to people are sentences from `core/src/errors.ts`, never raw exceptions.
- File names Magpie writes have no spaces: `Jane-Austen/Emma.epub` (`core/src/naming.ts`).
- UI: colours come from CSS variables in `ui/src/styles.css`, no spinners (progress says what it's doing), no em-dashes in UI copy. `scripts/ratchet.ts` enforces this; `// ratchet-ok` opts a line out when you mean it.
- Suggestions under 0.8 confidence start unticked. Calibre's metadata is trusted.
- Prettier, print width 160. `just fmt`.

## Environment notes

- Node 22.18+ (type stripping, `node:sqlite`). `NODE_OPTIONS=--disable-warning=ExperimentalWarning` is set by the justfile.
- Rust and the Tauri build only run on macOS: locally with `just app`, or in CI (the `mac` job in `check.yml`, and `release.yml` on tags). Everything else runs on Linux.
- Test switches for the Node host: `MAGPIE_HOME`, `MAGPIE_CONFIG`, `MAGPIE_VOLUMES` (fake mounted readers), `MAGPIE_OPENED` (log of paths "opened" instead of launching apps).
