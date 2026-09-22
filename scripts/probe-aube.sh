#!/usr/bin/env bash
# Probe an aube CLI: print help / try a dry install so we know the right flags.
# Usage: probe-aube.sh
set -uo pipefail
export COREPACK_ENABLE_STRICT=0 COREPACK_ENABLE_AUTO_PIN=0
echo "=== which aube ==="
command -v aube || true
command -v aubr || true
command -v aubx || true
echo "=== aube --help ==="
aube --help 2>&1 | head -40 || true
echo "=== aube install --help ==="
aube install --help 2>&1 | head -40 || true
echo "=== aubr --help ==="
aubr --help 2>&1 | head -40 || true
echo "=== aubx --help ==="
aubx --help 2>&1 | head -40 || true
