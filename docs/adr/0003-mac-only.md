# 3. Mac only, no web app

Status: accepted, 2026-10-25

## Context

A web version would need uploads (breaking "nothing leaves your machine") or a heavy in-browser library. Windows and Linux would multiply packaging and device work.

## Decision

Release 1 is a Tauri app for macOS 15 and later, following Mac conventions: a real menu bar, ⌘ shortcuts, sheets, Mail for Send to Kindle, Finder for Show in Finder. The browser build exists only as the dev and test loop (`magpie serve`).

## Consequences

The UI can lean on WebKit (Safari 17+ CSS). Other platforms remain possible later because the core and UI are platform-free; only `app/` and the host would change.
