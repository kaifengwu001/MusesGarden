#!/usr/bin/env bash
# A production build with the probe hook (VITE_PROBE=1 exposes window.__world) in $BUILDS/<name>, which the
# probe scripts serve from disk as http://<name>.test/: of a commit, built in a temporary worktree that shares
# node_modules, or without one, of this checkout as it is (uncommitted edits included).
#
#   build-at.sh i13 d5107a0     iteration 13's commit
#   build-at.sh mine            the working tree
#
# env: BUILDS (default $TMPDIR/muses-garden-builds), DEV=1 for a development build (window.__world in commits
# from before the probe hook existed, about iteration 12), PLAIN=1 for the build as published (no probe hook).
set -euo pipefail

name="${1:?usage: build-at.sh <name> [commit]}"
commit="${2:-}"
root="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
builds="${BUILDS:-${TMPDIR:-/tmp}/muses-garden-builds}"
out="$builds/$name"

# vite 8 needs a newer Node than this machine's default (v18)
for bin in "$HOME"/.nvm/versions/node/v2[4-9]*/bin; do
  [ -x "$bin/node" ] && PATH="$bin:$PATH" && break
done

work="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$work/src" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
src="$root"
if [ -n "$commit" ]; then
  src="$work/src"
  git -C "$root" worktree add --detach "$src" "$commit" >/dev/null 2>&1
  ln -s "$root/node_modules" "$src/node_modules"
fi

mkdir -p "$builds"
rm -rf "$out"
if [ "${DEV:-}" = 1 ]; then
  (cd "$src" && NODE_ENV=development npx vite build --outDir "$out" --emptyOutDir >/dev/null)
elif [ "${PLAIN:-}" = 1 ]; then
  (cd "$src" && npx vite build --outDir "$out" --emptyOutDir >/dev/null)
else
  (cd "$src" && VITE_PROBE=1 npx vite build --outDir "$out" --emptyOutDir >/dev/null)
fi
echo "$out ($(git -C "$src" rev-parse --short HEAD)$([ -z "$commit" ] && [ -n "$(git -C "$src" status --porcelain)" ] && echo ' + uncommitted'))"
