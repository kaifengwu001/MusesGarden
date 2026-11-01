#!/usr/bin/env bash
# Publish a commit as the page for iteration N, kept for comparison: its own
# Vercel project, muses-garden-iteration-N, whose production address
# (https://muses-garden-iteration-N.vercel.app) is public (iterations 4 and 5,
# published as Garden of Muse, are garden-of-muse-iteration-N). With --latest it
# also becomes the latest at the main project's production address; `latest`
# in place of N publishes the latest alone (a fix between iterations, the
# iteration pages left as they were). Needs the Vercel CLI, logged in to the
# scope that owns the projects.
#
#   scripts/publish.sh 5 --latest       the current checkout as iteration 5
#   scripts/publish.sh 4 HEAD~9         an older commit as iteration 4
#   scripts/publish.sh latest           the current checkout as the latest only
set -euo pipefail

n="${1:?usage: scripts/publish.sh <iteration|latest> [commit] [--latest]}"
shift
commit=""
latest=false
for arg in "$@"; do
  if [ "$arg" = "--latest" ]; then latest=true; else commit="$arg"; fi
done
MAIN="${MAIN:-the-meadow}"
root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'git -C "$root" worktree remove --force "$work/src" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

# build: the checkout itself, or the commit in a temporary worktree (sharing node_modules)
src="$root"
if [ -n "$commit" ]; then
  src="$work/src"
  git -C "$root" worktree add --detach "$src" "$commit" >/dev/null
  ln -s "$root/node_modules" "$src/node_modules"
fi
(cd "$src" && npm run build >/dev/null)

# the page and its assets, without the source maps
stage="$work/stage"
mkdir -p "$stage"
rsync -a --exclude '*.map' "$src/dist/" "$stage/"
# (each file's own last line only: an inline worker's source, a string in the bundle, has one of its own, and
# taking that out with what follows it on its line broke the bundle)
perl -0777 -pi -e 's{\n//# sourceMappingURL=[^\s`]+\s*\z}{\n}' "$stage"/assets/*.js

# deploy to production in a project (made if need be); print its public address (the shortest alias)
deploy() {
  rm -rf "$stage/.vercel"
  if ! (cd "$stage" && vercel link --yes --project "$1" >/dev/null 2>&1); then
    (cd "$stage" && vercel project add "$1" >/dev/null 2>&1 && vercel link --yes --project "$1" >/dev/null 2>&1)
  fi
  local url address
  # (the CLI prints the URL, or a JSON summary holding it when not on a terminal)
  url="$( (cd "$stage" && vercel deploy --prod --yes 2>/dev/null) | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | head -1)"
  # the project's addresses are assigned a moment after the deployment is ready
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    address="$( (cd "$stage" && vercel inspect "$url" 2>&1) | sed -n '/Aliases/,/Builds/p' | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | awk '{ print length, $0 }' | sort -n | head -1 | cut -d' ' -f2)"
    [ -n "$address" ] && break
    sleep 2
  done
  echo "${address:-$url}"
}
if [ "$n" = latest ]; then
  latest=true
else
  echo "iteration $n: $(deploy "muses-garden-iteration-$n")"
fi
if $latest; then
  echo "latest: $(deploy "$MAIN")"
fi
