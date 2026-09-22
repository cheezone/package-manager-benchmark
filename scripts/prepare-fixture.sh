#!/usr/bin/env bash
# Copy a vendored fixture from fixtures/<id> into work/<id> and leave it
# PM-neutral. Never clones. Never touches fixtures/ (those stay read-only).
#
# Usage: prepare-fixture.sh <fixture_id> [work_root]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:?usage: prepare-fixture.sh <fixture_id> [work_root]}"
WORK_ROOT="${2:-$ROOT/work}"
SRC="$ROOT/fixtures/$ID"
DEST="$WORK_ROOT/$ID"

if [[ ! -d "$SRC" ]]; then
  echo "unknown fixture: $ID (expected $SRC)" >&2
  exit 2
fi

# dest only — fixtures/ is never deleted
rm -rf "$DEST"
mkdir -p "$DEST"
# copy sources (skip any accidental install junk)
rsync -a \
  --exclude node_modules \
  --exclude .git \
  --exclude '.pnpm-store' \
  --exclude '.bun-cache' \
  --exclude 'package-lock.json' \
  --exclude 'pnpm-lock.yaml' \
  --exclude 'bun.lock' \
  --exclude 'bun.lockb' \
  --exclude 'yarn.lock' \
  "$SRC/" "$DEST/"

# safety: re-normalize in case fixtures/ was edited by hand
node "$ROOT/scripts/normalize-fixture.js" "$DEST" >/dev/null

echo "# prepared $ID -> $DEST" >&2
echo "$DEST"
