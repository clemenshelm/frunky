#!/usr/bin/env bash
# Ship the collector to the Helmcraft web box.
#
# The whole update is an rsync and a restart, because the collector has no
# dependencies and no build step. Run it from the repository root:
#
#   collector/deploy/deploy.sh
#
# What it does NOT do is touch /opt/web-infra. The compose service and the Caddy
# vhost are one-time edits over there, and a deploy script that rewrites the
# host's proxy configuration on every run is a deploy script that eventually
# reverts a hand-fix somebody made at three in the morning.
set -euo pipefail

HOST="${FRUNKY_HOST:-websites}"
REMOTE_DIR="${FRUNKY_REMOTE_DIR:-/opt/frunky-trace}"

cd "$(dirname "$0")/../.."
test -f trace-schema.js || { echo "run me from a frunky checkout"; exit 1; }

echo "→ ${HOST}:${REMOTE_DIR}"
ssh "$HOST" "mkdir -p ${REMOTE_DIR}/collector"

# trace-schema.js has to keep its position relative to collector/, because
# collector/schema.mjs loads it as ../trace-schema.js — one definition of what
# a trace may contain, shared by the browser and the server, is the point.
rsync -az --delete \
  --exclude 'deploy/' \
  collector/ "${HOST}:${REMOTE_DIR}/collector/"
rsync -az trace-schema.js "${HOST}:${REMOTE_DIR}/trace-schema.js"

echo "→ restarting"
ssh "$HOST" "cd /opt/web-infra && docker compose up -d frunky-trace && sleep 2 && docker compose ps frunky-trace"

echo "→ health"
ssh "$HOST" "docker compose -f /opt/web-infra/docker-compose.yml exec -T frunky-trace \
  node -e \"fetch('http://127.0.0.1:8099/api/health').then(r=>r.text()).then(t=>console.log(t))\"" \
  </dev/null

echo "✓ deployed"
