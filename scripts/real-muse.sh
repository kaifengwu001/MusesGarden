#!/usr/bin/env bash
# A real Muse's garden, live: a public tunnel, the garden server on the live clock with the connector, and the page's
# dev server (the workshop renders through it). Prints what to give the Muse's app.
#
#   scripts/real-muse.sh            start everything (Ctrl-C stops all three)
#   MUSE_DATA=.muse-real            the garden's folder (default), kept apart from the local garden's .muse
#   TRIPO_LIVE=0 scripts/real-muse.sh   keep Tripo off (bodies and furniture then stop at the 3D step)
#
# The tunnel is Cloudflare's quick tunnel: no account, but its address changes each time it starts, and the Muse's
# app then asks its owner for "Always allow this site" once more.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${HOME}/.muse-garden.env"
[[ -f "$ENV_FILE" ]] && { set -a; . "$ENV_FILE"; set +a; }
export MUSE_DATA="${MUSE_DATA:-.muse-real}"
export MUSE_PORT="${MUSE_PORT:-8787}"
export MUSE_CLOCK=live
export TRIPO_LIVE="${TRIPO_LIVE:-1}"
export MUSE_DEV_SERVER="${MUSE_DEV_SERVER:-http://localhost:5173}"
LOGS="${MUSE_DATA}/logs"
mkdir -p "$LOGS"

pids=()
stop() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap stop EXIT INT TERM

# 1. The tunnel to the garden server (not to Vite: /mcp, /d/, /w/ and /garden.md live on the garden server).
cloudflared tunnel --no-autoupdate --url "http://localhost:${MUSE_PORT}" >"$LOGS/tunnel.log" 2>&1 &
pids+=($!)
origin=""
for _ in $(seq 1 60); do
  origin="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGS/tunnel.log" | head -1 || true)"
  [[ -n "$origin" ]] && break
  sleep 1
done
[[ -n "$origin" ]] || { echo "The tunnel didn't give an address: see $LOGS/tunnel.log" >&2; exit 1; }
export MUSE_PUBLIC_ORIGIN="$origin"

# 2. The page's dev server (renders for the workshop, and the owner's view of the garden).
npx vite --port 5173 --strictPort >"$LOGS/vite.log" 2>&1 &
pids+=($!)

# 3. The garden server.
npx tsx --no-warnings server/http.ts >"$LOGS/server.log" 2>&1 &
pids+=($!)
for _ in $(seq 1 60); do curl -fsS "http://localhost:${MUSE_PORT}/api/muses" >/dev/null 2>&1 && break; sleep 1; done

cat <<EOF

The garden is up.
  Public address:  ${origin}
  Connector:       ${origin}/mcp
  Guide for Muse:  ${origin}/garden.md
  Logs:            ${LOGS}/

Make a Muse's key (shown once):   MUSE_DATA=${MUSE_DATA} npm run agent:key -- <id> --name <Name>
Its garden in your browser:       http://localhost:5173/?garden=/api/muses/<id>
Ctrl-C stops the tunnel, the page and the garden.
EOF
wait
