#!/usr/bin/env bash
# Deploy the Frunky app to frunky.clemenshelm.com (static files, /srv/frunky
# on the web box, served by the vhost in frunky-app.Caddyfile). The collector
# has its own deploy (collector/deploy/deploy.sh); this script never touches it.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST="websites"
DEST="/srv/frunky"
BASE="https://frunky.clemenshelm.com"
FILES=(index.html bench.html privacy.html engine.js geo.js diagnose.js trace.js trace-schema.js fresh.js version.json)
DIRS=(vendor samples)

# ---- build-bump guard --------------------------------------------------------
# The versioned scripts are served `immutable`, so shipping a CHANGED file
# under an UNCHANGED build number would pin every browser to the old copy for
# a year. Refuse that combination outright; a first deploy (no remote
# version.json) passes.
local_build=$(python3 -c "import json;print(json.load(open('version.json'))['build'])")
remote_build=$(ssh "$HOST" "cat $DEST/version.json 2>/dev/null" \
  | python3 -c "import json,sys;print(json.load(sys.stdin).get('build',''))" 2>/dev/null || echo "")
if [ -n "$remote_build" ] && [ "$remote_build" = "$local_build" ]; then
  changed=$(rsync -rlpgoDcn --out-format='%n' "${FILES[@]}" "${DIRS[@]}" "$HOST:$DEST/" | grep -cv '/$' || true)
  if [ "$changed" -gt 0 ]; then
    echo "REFUSED: $changed changed file(s), but version.json still says build $local_build." >&2
    echo "Bump BUILD (index.html, privacy.html) and version.json first — the immutable" >&2
    echo "cache headers depend on every content change moving to a new ?v= URL." >&2
    exit 1
  fi
  echo "Build $local_build already deployed and unchanged — nothing to do."
  exit 0
fi

ssh "$HOST" "mkdir -p $DEST"
# --delete cleans inside vendor/ and samples/; stray top-level files are not
# expected (the vhost serves only what this list ships)
rsync -a --delete --checksum "${FILES[@]}" "${DIRS[@]}" "$HOST:$DEST/"

# ---- verify what a browser will actually receive -----------------------------
# Assert the RESOLVED headers, never the config that asked for them — a vhost
# edit on the box, a matcher typo, a proxy in between: curl sees what ships.
check() { # path, required header substring
  hdr=$(ssh "$HOST" "curl -sI '$BASE$1'")
  if ! echo "$hdr" | grep -qi "$2"; then
    echo "VERIFY FAILED on $1: wanted '$2', got:" >&2
    echo "$hdr" >&2
    exit 1
  fi
}
check "/" "cache-control: no-store"
check "/index.html" "cache-control: no-store"
check "/version.json" "cache-control: no-store"
check "/engine.js?v=$local_build" "immutable"
check "/vendor/Tone.js" "max-age=86400"
check "/" "geolocation=(self)"
ssh "$HOST" "curl -s $BASE/api/health" | grep -q '"status":"ok"' || {
  echo "VERIFY FAILED: /api/health does not answer ok" >&2
  exit 1
}
echo "DEPLOYED build $local_build to $HOST:$DEST — resolved headers verified."
