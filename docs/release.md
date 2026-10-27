# Releasing Magpie

Releases are built on Greg's Mac, the way Argus does it. A warm Rust build there takes about a minute, where a GitHub runner starts cold, waits in a queue and builds twice for a universal app. `just ship 0.2.0` does all of it:

1. Checks that the checkout is `main` exactly as pushed, and that 0.2.0 is newer than the latest release (the updater only installs a higher version).
2. Builds an Apple silicon `Magpie.app` and `.dmg` at gentle priority (`taskpolicy -c utility nice -n 10`: performance cores, but it yields to whatever Greg is doing). `MAGPIE_BUILD_PRIORITY=full` drops that when he's away.
3. Installs the app in `/Applications`, quitting and reopening Magpie if it was running.
4. Waits for CI's `just check` (and the Mac job, when the app changed) on the same commit. The build usually finishes first, so this costs little. A red CI stops here with nothing published.
5. Publishes `vX.Y.Z` on GitHub with the `.dmg`, a stable-named `Magpie.dmg` for the website's Download button, the signed update bundle and `latest.json`. The tag is made by the release itself, so the Mac needs no git push rights.
6. Fetches `latest.json` the way installed copies do and checks the version.

The version comes from the argument and is merged over `app/src-tauri/tauri.conf.json` at build time, along with the updater's public key, so nobody bumps the file and dev builds never update themselves. Build files land in `out/release/vX.Y.Z/`.

Other modes: `--build-only` builds and installs on the Mac without publishing, and `--publish-only` later publishes that exact build. `--universal` adds Intel (about twice the build time). `--no-wait` skips the CI wait. Release notes come from `docs/release-notes/X.Y.Z.md` when it exists, otherwise from the commit subjects since the last release.

## Updates

Installed copies check `https://github.com/gregorymfoster/magpie/releases/latest/download/latest.json` 5 seconds after launch and every six hours, download a newer version in the background and then show "Magpie X is ready" with **Restart to update** (`ui/src/shell.ts`). Magpie › Check for Updates… and Settings › Updates check by hand. Updates use the signed `.app.tar.gz`, never the `.dmg`, which is only for first installs.

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
