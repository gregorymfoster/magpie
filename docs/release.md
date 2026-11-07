# Releasing Magpie

Releases are built on Greg's Mac, the way Argus does it. A warm build there takes about 36 seconds, where a GitHub runner starts cold, waits in a queue and builds twice for a universal app. `just ship 0.2.0` does all of it:

1. Moves to its own worktree, `~/.magpie-release`, checked out at `origin/main`, and checks that 0.2.0 is newer than the latest release (the updater only installs a higher version). Nothing else works in that folder, so other sessions pulling, installing or building in Greg's checkout can't leak into a release or make it rebuild cold. 0.1.9, built in the shared checkout, hit a broken `npm` install, a `git pull` in the middle of its build and a 12-minute Rust compile. The worktree's first build is cold (about 2 minutes); later ones reuse its build folder.
2. Builds the UI only when `ui/`, `core/` or the lockfile changed (a fresh `ui/dist` makes cargo recompile the app crate), then builds an Apple silicon `Magpie.app` and `.dmg` at gentle priority (`taskpolicy -c utility nice -n 10`: performance cores, but it yields to whatever Greg is doing). `MAGPIE_BUILD_PRIORITY=full` drops that when he's away.
3. Installs the app in `/Applications`, quitting and reopening Magpie if it was running.
4. Runs the Rust host's `cargo test` beside the build (in `app/src-tauri/target-test`, so neither waits on the other), then waits for CI's `just check` on the same commit. CI's Mac job is not part of the gate: it takes about 4 minutes and repeats what the Mac just did. A red result stops here with nothing published.
5. Publishes `vX.Y.Z` on GitHub with the `.dmg`, a stable-named `Magpie.dmg` for the website's Download button, the signed update bundle and `latest.json`. The tag is made by the release itself, so the Mac needs no git push rights.
6. Fetches `latest.json` the way installed copies do and checks the version.

The version comes from the argument and is merged over `app/src-tauri/tauri.conf.json` at build time, along with the updater's public key, so nobody bumps the file and dev builds never update themselves. Build files land in `~/.magpie-release/out/release/vX.Y.Z/`.

Other modes: `--build-only` builds and installs on the Mac without publishing, and `--publish-only` later publishes that exact build. `--universal` adds Intel (about twice the build time). `--no-wait` skips the CI wait, and `--no-install` leaves the installed copy alone so it can update itself. Release notes come from `docs/release-notes/X.Y.Z.md` when it exists, otherwise from the commit subjects since the last release.

Measured on Greg's M4 Max (2026-10-27): a cold app build with the `.dmg` takes 132 s, a warm one after a Rust edit 36 s (15 s of it without the `.dmg`). `just check` is 18 s locally. On CI the check job takes about 77 s, so a warm ship is set by that wait.

## Updates

Installed copies update the way Argus does (Greg, 2026-11-07), like Cursor and Claude. The app itself (`app/src-tauri/src/updates.rs`, not the window) checks `https://github.com/gregorymfoster/magpie/releases/latest/download/latest.json` 5 seconds after launch and every six hours, downloads and installs a newer version in the background with one quiet "Magpie X is downloading" toast and a thin progress bar at the right of the Status bar, then shows **Restart to update** there (with a "Magpie X is ready" toast once). Magpie › Check for Updates… checks by hand and says what it found in a toast; Settings › Updates shows the version, when it last checked, what's new and Check Now or Restart to Update (`ui/src/components/Updates.tsx`). Dev builds, and local builds without the release config's public key, don't update themselves and say so. In a browser, `?update=ready` (or `downloading`, `current`, `error`, `off`) fakes a state for screenshots and tests (`ui/e2e/updates.spec.ts`). Updates use the signed `.app.tar.gz`, never the `.dmg`, which is only for first installs.

A Mac build of Apple silicon only means `latest.json` lists only `darwin-aarch64`. Intel copies stay where they are until a `--universal` release.

## One-time setup

```sh
just release-setup    # scripts/release/setup.sh
```

It creates the update-signing key in `~/.tauri/magpie-updater.key` (with a random password beside it) and stores both as Actions secrets, plus the public key as the `TAURI_UPDATER_PUBKEY` variable, for the backup workflow. Re-running it is safe. Back up the key and its password: if they're lost, every installed copy is stuck on its version for good, because the updater rejects bundles signed by any other key. Never regenerate it.

Copies from before the updater (0.1.5 and older) have no key, so they need one last install by hand.

## Backup: GitHub Actions

`.github/workflows/release.yml` builds a universal release on a GitHub macOS runner when started by hand with a version. It takes 6 to 10 minutes and is for when the Mac can't. It has no tag trigger, because `just ship` creates tags and a second build would overwrite its `latest.json`.

## What's checked where

`scripts/release/latest-json.test.ts` covers the `latest.json` format and runs in `just test`. The build itself only runs on macOS, so the script's own last step (the published version) and the installed app are the test.
