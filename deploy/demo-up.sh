#!/usr/bin/env bash
# Demo: frontend on Cloudflare Pages (project lumen-demo), API + databases + the local `claude`
# login on this machine, exposed through a Cloudflare quick tunnel. The tunnel URL changes on
# every run, so this points the Pages proxy (functions/api) at the new URL and redeploys.
# Ctrl+C stops the API and the tunnel.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=lumen-demo
LOG_DIR="${TMPDIR:-/tmp}/lumen-demo"
mkdir -p "$LOG_DIR"

docker compose up -d

if ! curl -sf -m 3 http://localhost:3001/health >/dev/null; then
  pnpm --filter @lumen/api exec tsx src/server.ts >"$LOG_DIR/api.log" 2>&1 &
  API_PID=$!
fi
until curl -sf -m 3 http://localhost:3001/health >/dev/null; do sleep 2; done
echo "API ok"

# QUIC (UDP) is blocked on some networks; http2 always gets through.
cloudflared tunnel --no-autoupdate --protocol http2 --url http://localhost:3001 >"$LOG_DIR/tunnel.log" 2>&1 &
TUNNEL_PID=$!
trap 'kill ${TUNNEL_PID:-} ${API_PID:-} 2>/dev/null || true' EXIT
until grep -q "Registered tunnel connection" "$LOG_DIR/tunnel.log"; do sleep 2; done
TUNNEL_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$LOG_DIR/tunnel.log" | head -1)
echo "Tunnel: $TUNNEL_URL"

printf '%s' "$TUNNEL_URL" | npx wrangler pages secret put API_ORIGIN --project-name "$PROJECT"
# MSYS_NO_PATHCONV: Git Bash would otherwise rewrite "/api" into "C:/Program Files/Git/api".
(cd apps/web && MSYS_NO_PATHCONV=1 VITE_API_URL=/api pnpm build \
  && npx wrangler pages deploy dist --project-name "$PROJECT" --branch main --commit-dirty=true)

until curl -sf -m 10 "https://$PROJECT-186.pages.dev/api/health" >/dev/null; do sleep 3; done
echo
echo "No ar: https://$PROJECT-186.pages.dev  (Ctrl+C para derrubar)"
wait
