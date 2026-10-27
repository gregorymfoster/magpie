#!/usr/bin/env bash
# One-time release setup, on Greg's Mac from the repo root: scripts/release/setup.sh (or `just release-setup`).
# Creates the update-signing key in ~/.tauri (never committed) and stores it as Actions secrets
# for the backup CI release. Safe to re-run: it reuses an existing key. See docs/release.md.
set -euo pipefail

REPO=gregorymfoster/magpie
KEY="$HOME/.tauri/magpie-updater.key"

[ "$(uname -s)" = Darwin ] || { echo "Run this on the Mac that ships Magpie."; exit 1; }
command -v gh >/dev/null || { echo "Needs the GitHub CLI: brew install gh && gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }
command -v cargo >/dev/null || { echo "Needs Rust: https://rustup.rs"; exit 1; }

mkdir -p "$HOME/.tauri"
if [ -f "$KEY" ]; then
  echo "Reusing the update-signing key at $KEY"
else
  umask 077
  openssl rand -hex 32 > "$KEY.password"
  npx --yes @tauri-apps/cli@2 signer generate --ci -p "$(cat "$KEY.password")" -w "$KEY" >/dev/null
  echo "Created the update-signing key at $KEY"
fi
[ -f "$KEY.pub" ] && [ -f "$KEY.password" ] || { echo "$KEY.pub or $KEY.password is missing"; exit 1; }

gh secret set TAURI_SIGNING_PRIVATE_KEY --repo "$REPO" < "$KEY"
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo "$REPO" < "$KEY.password"
gh variable set TAURI_UPDATER_PUBKEY --repo "$REPO" --body "$(cat "$KEY.pub")"
echo "Stored the key as Actions secrets on $REPO (for the backup release workflow)"

echo
echo "Done. Back up $KEY and $KEY.password (for example in 1Password)."
echo "Without them, installed copies of Magpie can never update again."
