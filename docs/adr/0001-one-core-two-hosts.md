# 1. One TypeScript core, two hosts

Status: accepted, 2026-10-25

## Context

Magpie needs a Mac app, a CLI for scripts and agents, headless UI tests on Linux, and later an MCP server. Writing the logic twice (Rust in the app, TS in tests) would mean two sets of bugs.

## Decision

All behaviour lives in `core/`, plain TypeScript with no DOM and no Node APIs. It reaches the world through a small `Host` interface: files, SQLite, opening a path, environment. The Node host serves the CLI, `magpie serve`, `magpie mcp` and every test. In the app the core runs in a Web Worker and its host calls cross to Rust through Tauri's `invoke`. Rust does only what TS can't: file and SQLite access, menus, the updater.

Both hosts run the same contract suite (`core/test/host-contract.ts`).

## Consequences

Almost everything can be tested on Linux in milliseconds through `core.call`. The Rust side stays a few hundred lines. The cost is a serialisation hop per host call in the app; bytes travel as base64, which is fine for EPUB-sized files.
