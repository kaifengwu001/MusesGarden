#!/usr/bin/env bash
# Publish a commit as the page for iteration N, kept for comparison: its own
# Vercel project, garden-of-muse-iteration-N, whose production address
# (https://garden-of-muse-iteration-N.vercel.app) is public. With --latest it
# also becomes the latest at the main project's production address. Needs the
# Vercel CLI, logged in to the scope that owns the projects.
#
#   scripts/publish.sh 5 --latest       the current checkout as iteration 5
#   scripts/publish.sh 4 HEAD~9         an older commit as iteration 4
set -euo pipefail

n="${1:?usage: scripts/publish.sh <iteration> [commit] [--latest]}"
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
perl -pi -e 's{//# sourceMappingURL=\S+}{}' "$stage"/assets/*.js

# deploy to production in a project (made if need be); print its public address (the shortest alias)
deploy() {
  rm -rf "$stage/.vercel"
  if ! (cd "$stage" && vercel link --yes --project "$1" >/dev/null 2>&1); then
    (cd "$stage" && vercel project add "$1" >/dev/null 2>&1 && vercel link --yes --project "$1" >/dev/null 2>&1)
  fi
  local url
  url="$(cd "$stage" && vercel deploy --prod --yes 2>/dev/null)"
  (cd "$stage" && vercel inspect "$url" 2>&1) | grep -oE 'https://[a-z0-9.-]+\.vercel\.app' | awk '{ print length, $0 }' | sort -n | head -1 | cut -d' ' -f2
}
echo "iteration $n: $(deploy "garden-of-muse-iteration-$n")"
if $latest; then
  echo "latest: $(deploy "$MAIN")"
fi
