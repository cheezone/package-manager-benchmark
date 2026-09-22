#!/usr/bin/env bash
# Package-manager benchmark harness.
# Usage: bash bench.sh <pm>   where pm in: npm pnpm bun nub aube yarn
#
# Runs 4 scenarios and writes results/<pm>.json:
#   install_cold  - no package-manager cache, no node_modules, no lockfile
#   install_warm  - cache + lockfile present, node_modules removed (re-link from cache)
#   run_noop      - `pm run noop` with node_modules present (isolates PM spawn overhead)
#   run_build     - `pm run build` real task (lodash/dayjs/semver/esbuild + workspace bundle)
set -euo pipefail

PM="${1:-}"
if [[ -z "$PM" ]]; then
  echo "usage: bench.sh <npm|pnpm|bun|nub|aube|yarn>" >&2
  exit 2
fi

RESULTS_DIR="results"
mkdir -p "$RESULTS_DIR"
OUT_JSON="$RESULTS_DIR/$PM.json"

now() { date +%s.%N; }
elapsed() { awk "BEGIN{printf \"%.3f\", $2 - $1}"; }

# ---- per-PM command + cache definitions -------------------------------------
case "$PM" in
  npm)
    INSTALL="npm install"
    CI_INSTALL="npm ci"
    RUN="npm run"
    cache_wipe() { rm -rf "$HOME/.npm"; }
    version_cmd="npm --version"
    ;;
  pnpm)
    export PNPM_STORE_DIR="$PWD/.pnpm-store"
    pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
    INSTALL="pnpm install --store-dir $PNPM_STORE_DIR"
    CI_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --frozen-lockfile"
    RUN="pnpm run"
    cache_wipe() { rm -rf "$PNPM_STORE_DIR"; }
    version_cmd="pnpm --version"
    ;;
  bun)
    export BUN_INSTALL_CACHE_DIR="$PWD/.bun-cache"
    INSTALL="bun install"
    CI_INSTALL="bun install"
    RUN="bun run"
    cache_wipe() { rm -rf "$BUN_INSTALL_CACHE_DIR"; }
    version_cmd="bun --version"
    ;;
  nub)
    INSTALL="nub install"
    CI_INSTALL="nub install"
    RUN="nub run"
    cache_wipe() { rm -rf "$HOME/.nub" "$HOME/.local/share/nub" "$HOME/.cache/nub" "$PWD/.nub-store"; }
    version_cmd="nub --version"
    ;;
  aube)
    INSTALL="aube install"
    CI_INSTALL="aube install"
    RUN="aubr"
    cache_wipe() { rm -rf "$HOME/.aube" "$HOME/.local/share/aube" "$HOME/.cache/aube" "$PWD/.aube-store"; }
    version_cmd="aube --version"
    ;;
  yarn)
    cat > .yarnrc.yml <<'YML'
nodeLinker: node-modules
YML
    INSTALL="yarn install"
    CI_INSTALL="yarn install"
    RUN="yarn"
    cache_wipe() { rm -rf "$HOME/.yarn"; }
    version_cmd="yarn --version"
    ;;
  *)
    echo "unknown pm: $PM" >&2
    exit 2
    ;;
esac

# Lockfiles produced by the various managers (removed for cold start).
LOCKFILES="package-lock.json pnpm-lock.yaml bun.lock bun.lockb yarn.lock nub.lock aube-lock.yaml"

clean_node_modules() { rm -rf node_modules; }
clean_locks() { rm -f $LOCKFILES; rm -rf .yarn/install-state.gz; }
clean_all() { clean_node_modules; clean_locks; }

PM_VERSION="$($version_cmd 2>/dev/null || echo unknown)"
NODE_VERSION="$(node --version)"

echo "==> Benchmarking '$PM'  (pm=$PM_VERSION, node=$NODE_VERSION)"

# ---------- Scenario 1: cold install ----------
cache_wipe
clean_all
t0=$(now); $INSTALL >/dev/null 2>&1; t1=$(now)
COLD=$(elapsed "$t0" "$t1")
echo "install_cold: $COLD s"

# ---------- Scenario 2: warm install (cache + lockfile kept, node_modules removed) ----------
clean_node_modules
t0=$(now); $CI_INSTALL >/dev/null 2>&1; t1=$(now)
WARM=$(elapsed "$t0" "$t1")
echo "install_warm: $WARM s"

# ---------- Scenario 3: run noop (PM spawn overhead) ----------
t0=$(now); $RUN noop >/dev/null 2>&1; t1=$(now)
NOOP=$(elapsed "$t0" "$t1")
echo "run_noop: $NOOP s"

# ---------- Scenario 4: run build (real task) ----------
t0=$(now); $RUN build >/dev/null 2>&1; t1=$(now)
BUILD=$(elapsed "$t0" "$t1")
echo "run_build: $BUILD s"

# ---------- write results ----------
cat > "$OUT_JSON" <<JSON
{
  "pm": "$PM",
  "pm_version": "$PM_VERSION",
  "node_version": "$NODE_VERSION",
  "scenarios": {
    "install_cold": $COLD,
    "install_warm": $WARM,
    "run_noop": $NOOP,
    "run_build": $BUILD
  }
}
JSON

echo "==> Wrote $OUT_JSON"
