#!/usr/bin/env bash
# Builds a Magpie release on Greg's Mac, installs it there and publishes it, so installed copies
# update themselves. Usage, from the repo root on an up-to-date main: scripts/release/ship.sh 0.2.0
# (or `just ship 0.2.0`). Flags:
#   --build-only    build and install on this Mac, publish nothing
#   --publish-only  publish what --build-only built (main may have moved on since)
#   --universal     Apple silicon and Intel in one app (about twice the build time)
#   --no-wait       don't wait for CI's check on this commit
# MAGPIE_BUILD_PRIORITY: gentle (default: performance cores, yields to Greg's apps) or full.
# Needs the update-signing key from scripts/release/setup.sh and a logged-in gh. See docs/release.md.
# Written for macOS's own bash 3.2.
set -euo pipefail

VERSION="${1:-}"
shift || true
MODE=all UNIVERSAL= WAIT=1
for a in "$@"; do
  case "$a" in
    --build-only | --publish-only) MODE="$a" ;;
    --universal) UNIVERSAL=1 ;;
    --no-wait) WAIT= ;;
    *) echo "usage: $0 X.Y.Z [--build-only|--publish-only] [--universal] [--no-wait]" >&2; exit 1 ;;
  esac
done
VERSION="${VERSION#v}"
TAG="v$VERSION"
REPO=gregorymfoster/magpie
KEY="$HOME/.tauri/magpie-updater.key"
START=$(date +%s)

die() { echo "ship: $*" >&2; exit 1; }
step() { echo; echo "== $* (+$(($(date +%s) - START))s)"; }

echo "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$' || die "usage: $0 X.Y.Z"
[ "$(uname -s)" = Darwin ] || die "builds the Mac app, so run it on the Mac"
cd "$(git rev-parse --show-toplevel)"
[ -f "$KEY" ] && [ -f "$KEY.password" ] && [ -f "$KEY.pub" ] || die "no signing key in ~/.tauri: run scripts/release/setup.sh once"
gh auth status >/dev/null 2>&1 || die "run 'gh auth login' first"

OUT="out/release/$TAG"
if [ "$MODE" = --publish-only ]; then
  SHA=$(cat "$OUT/built-from" 2>/dev/null) || die "no build of $TAG; run with --build-only first"
  ARCH=$(cat "$OUT/arch")
else
  step "Checking the source is main as pushed"
  git fetch -q origin main
  [ -z "$(git status --porcelain --untracked-files=no)" ] || die "uncommitted changes; commit or stash them first"
  [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || die "HEAD isn't origin/main; run 'git checkout main && git pull' first"
  SHA=$(git rev-parse HEAD)
  ARCH=$([ -n "$UNIVERSAL" ] && echo universal || echo aarch64)
fi

gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1 && die "$TAG is already published"
latest=$(gh release view --repo "$REPO" --json tagName -q .tagName 2>/dev/null || true)
if [ -n "$latest" ]; then
  newest=$(printf '%s\n%s\n' "${latest#v}" "$VERSION" | sort -V | tail -n1)
  [ "$newest" = "$VERSION" ] && [ "${latest#v}" != "$VERSION" ] || die "$TAG isn't newer than $latest; installed copies would ignore it"
fi
name="Magpie_${VERSION}_${ARCH}"

if [ "$MODE" != --publish-only ]; then
  # The gate is CI's `just check` on this exact commit, which runs while the Mac builds. CI's
  # Mac job is left out (about 4 minutes): the Rust tests run here instead, beside the build.
  ci_state() {
    gh api "repos/$REPO/commits/$SHA/check-runs?per_page=50" \
      --jq '[.check_runs[] | select(.name == "check" or .name == "changes")] |
            if length == 0 then "none"
            elif any(.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out") then "red"
            elif all(.status == "completed") then "green" else "running" end' 2>/dev/null || echo unknown
  }

  case "${MAGPIE_BUILD_PRIORITY:-gentle}" in
    gentle) PRIO="taskpolicy -c utility nice -n 10" ;;
    full) PRIO="" ;;
    *) die "MAGPIE_BUILD_PRIORITY must be gentle or full" ;;
  esac

  step "Preparing the build"
  rm -rf "$OUT" && mkdir -p "$OUT"
  echo "$ARCH" > "$OUT/arch"
  # npm ci wipes node_modules; skip it while the lockfile is the one it last installed.
  lock=$(shasum -a 256 package-lock.json | cut -d" " -f1)
  if [ "$(cat node_modules/.ship-lock 2>/dev/null)" != "$lock" ]; then
    npm ci --no-audit --no-fund
    echo "$lock" > node_modules/.ship-lock
  fi
  # The sorting model ships inside the app (checked by sha256; quick when it's already here).
  node --disable-warning=ExperimentalWarning scripts/fetch-model.ts
  # Release-only config over app/src-tauri/tauri.conf.json: the version comes from the argument,
  # so nobody bumps the file, and only release builds carry the updater key.
  node -e '
    const [v, k] = process.argv.slice(1);
    console.log(JSON.stringify({ version: v, build: { beforeBuildCommand: null }, bundle: { createUpdaterArtifacts: true }, plugins: { updater: { pubkey: k } } }));' \
    "$VERSION" "$(cat "$KEY.pub")" > "$OUT/release.conf.json"
  # The UI is built here, and only when the UI, the core it bundles or the lockfile changed:
  # a fresh ui/dist makes cargo re-embed it and recompile the app crate (about 12 s) even
  # when nothing changed. The tree is clean and at HEAD, so git's tree ids are its contents.
  uikey="$(git rev-parse HEAD:ui HEAD:core):$lock"
  if [ ! -f ui/dist/index.html ] || [ "$(cat out/release/ui.key 2>/dev/null)" != "$uikey" ]; then
    npm run build -w ui
    echo "$uikey" > out/release/ui.key
  fi
  # The Rust host's tests, in their own target folder so they don't wait on the build's lock.
  CARGO_TARGET_DIR=app/src-tauri/target-test $PRIO cargo test --quiet --manifest-path app/src-tauri/Cargo.toml > "$OUT/cargo-test.log" 2>&1 &
  cargo_test=$!

  step "Building Magpie $VERSION for $ARCH (${MAGPIE_BUILD_PRIORITY:-gentle} priority)"
  target=()
  bundle=app/src-tauri/target/release/bundle
  if [ -n "$UNIVERSAL" ]; then
    rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
    target=(--target universal-apple-darwin)
    bundle=app/src-tauri/target/universal-apple-darwin/release/bundle
  fi
  rm -rf "$bundle"
  export TAURI_SIGNING_PRIVATE_KEY="$KEY"
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(cat "$KEY.password")"
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD
  # CI=true skips the Finder AppleScript that lays out the .dmg window, which otherwise pops a
  # "Magpie" disk window up on the screen. hdiutil now and then fails with "Resource busy";
  # the Rust build is cached after the first try, so a retry only re-bundles.
  for attempt in 1 2 3; do
    # shellcheck disable=SC2086
    if CI=true $PRIO npm run tauri -w app -- build --bundles app,dmg ${target[@]+"${target[@]}"} --config "$PWD/$OUT/release.conf.json"; then break; fi
    [ "$attempt" = 3 ] && die "build failed three times"
    echo "bundling failed (attempt $attempt), retrying"
    sleep 5
  done
  unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD

  step "Collecting the release files"
  tarball=$(ls "$bundle"/macos/*.app.tar.gz | head -n1)
  [ -f "$tarball.sig" ] || die "updater signature missing; is the signing key right?"
  cp "$(ls "$bundle"/dmg/*.dmg | head -n1)" "$OUT/$name.dmg"
  cp "$tarball" "$OUT/$name.app.tar.gz"
  if [ -n "$UNIVERSAL" ]; then platforms=(--platform darwin-aarch64 --platform darwin-x86_64); else platforms=(--platform darwin-aarch64); fi
  node --disable-warning=ExperimentalWarning scripts/release/latest-json.ts --version "$VERSION" --tag "$TAG" \
    --bundle "$name.app.tar.gz" --sig "$tarball.sig" "${platforms[@]}" --notes "Magpie $VERSION" > "$OUT/latest.json"
  echo "$SHA" > "$OUT/built-from"

  step "Installing on this Mac"
  is_running() { [ "$(osascript -e 'application "Magpie" is running' 2>/dev/null)" = true ]; }
  running=
  if is_running; then
    running=1
    osascript -e 'quit app "Magpie"' >/dev/null 2>&1 || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do is_running || break; sleep 1; done
  fi
  dest=/Applications/Magpie.app
  [ -w /Applications ] || dest="$HOME/Applications/Magpie.app"
  mkdir -p "$(dirname "$dest")"
  rm -rf "$dest"
  ditto "$bundle/macos/Magpie.app" "$dest"
  echo "Installed $dest"
  if [ -n "$running" ]; then open "$dest"; fi

  step "Waiting for the Rust tests"
  wait "$cargo_test" || { tail -n 40 "$OUT/cargo-test.log"; die "cargo test failed (the build is installed here, nothing was published)"; }
  echo "Rust tests passed"

  if [ -n "$WAIT" ]; then
    step "Waiting for CI's check on ${SHA:0:7}"
    for _ in $(seq 1 60); do
      s=$(ci_state)
      case "$s" in
        green) echo "CI is green"; break ;;
        red) die "CI failed on ${SHA:0:7}: https://github.com/$REPO/commit/$SHA/checks (the build is installed here, nothing was published)" ;;
        *) sleep 10 ;;
      esac
    done
    [ "$s" = green ] || die "CI still hasn't finished on ${SHA:0:7} after 10 minutes; publish later with --publish-only"
  fi
fi

if [ "$MODE" = --build-only ]; then
  echo "Built and installed $TAG in $(($(date +%s) - START))s; publish it with: just ship $VERSION --publish-only"
  exit 0
fi

step "Publishing $TAG"
git fetch -q --tags origin || true
notes="$OUT/notes.md"
{
  if [ -f "docs/release-notes/$VERSION.md" ]; then
    cat "docs/release-notes/$VERSION.md"
  elif [ -n "$latest" ]; then
    # What changed since the last release, by commit subject (version bumps left out).
    git log --format='- %s' "$latest..$SHA" 2>/dev/null | grep -Ev '^- (v?[0-9]+\.[0-9]+\.[0-9]+|Merge )' || true
  fi
  echo
  echo "First time opening it? macOS will warn you because Magpie is not notarized yet. Open System Settings › Privacy & Security and click Open Anyway. Details: https://magpie.gmfoster.com/#first-open"
  if [ "$ARCH" = aarch64 ]; then printf '\nThis build is for Macs with Apple silicon.\n'; fi
} > "$notes"
cp "$OUT/$name.dmg" "$OUT/Magpie.dmg"
# --target tags the commit on GitHub, so this needs no git push credentials.
gh release create "$TAG" --repo "$REPO" --target "$SHA" --title "Magpie $TAG" --notes-file "$notes" \
  "$OUT/$name.dmg" "$OUT/$name.app.tar.gz" "$OUT/latest.json" "$OUT/Magpie.dmg"

step "Checking what installed copies will see"
got=
for _ in 1 2 3 4 5 6; do
  got=$(curl -fsSL "https://github.com/$REPO/releases/latest/download/latest.json" 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).version)}catch{}})' || true)
  [ "$got" = "$VERSION" ] && break
  sleep 5
done
[ "$got" = "$VERSION" ] || die "latest.json says '$got', expected $VERSION"
echo "Shipped $TAG in $(($(date +%s) - START))s: https://github.com/$REPO/releases/tag/$TAG"
