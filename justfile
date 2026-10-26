# Magpie's commands. `just check` is the only gate: CI runs exactly it.
# Run `just` to list everything.

export NODE_OPTIONS := "--disable-warning=ExperimentalWarning"

default:
    @just --list

# Everything a change must pass: types, format, unit + contract tests, UI build, headless UI tests
check: types lint test ui-build e2e

# Type-check every package
types:
    npx tsc -p .
    npx tsc -p ui

# Formatting and the design ratchet (no stray colours, spinners or em-dashes in UI copy)
lint:
    npx prettier --check core cli ui/src bench
    node scripts/ratchet.ts

# Format everything in place
fmt:
    npx prettier --write core cli ui/src bench

# Core and host tests (node:test)
test:
    node --test core/test/*.test.ts cli/test/*.test.ts

# Build the UI into ui/dist
ui-build:
    npm run build -w ui

# Headless UI tests: Playwright drives the built UI against `magpie serve` on a temp Library
e2e:
    npx playwright test -c ui/playwright.config.ts

# Screenshots of every screen, light and dark, into ui/shots/ for a look without clicking
shots:
    SHOTS=1 npx playwright test -c ui/playwright.config.ts shots

# A walk through the app for a person: stills and a video into ui/shots/tour/
tour:
    SHOTS=1 npx playwright test -c ui/playwright.config.ts tour

# Score the fixers against the damaged-twin corpus (builds the corpus first if needed)
bench:
    test -d corpus/files || python3 corpus/generate.py
    test -f corpus/baseline/original.jsonl || python3 corpus/baseline.py
    node bench/run.ts

# The UI in a browser against a real core: http://127.0.0.1:5173
dev library="/tmp/magpie-dev":
    node cli/src/main.ts serve --library {{library}} & npm run dev -w ui

# Run any core command: just call books.list '{"state":"review"}'
call command args="":
    node cli/src/main.ts call {{command}} '{{args}}'

# The Mac app in dev mode (needs Rust and Xcode tools; Mac only)
app:
    npm run tauri -w app -- dev

# A release build of the Mac app (Mac only; CI does this on tags)
app-build:
    npm run tauri -w app -- build
