#!/usr/bin/env bash
# Package-manager benchmark harness (hyperfine edition).
# Usage: bash bench.sh <pm> [version]
#   pm in: npm pnpm bun nub aube
#   version: optional pinned version being tested (recorded in output)
#
# Each scenario is timed with hyperfine (multiple runs -> mean + stddev):
#   install_cold    - no package-manager cache, no node_modules, no lockfile
#   install_warm    - cache + lockfile present, node_modules removed (re-link)
#   install_frozen  - cache + lockfile present, frozen/CI install (pure restore)
#   run_noop        - `pm run noop` with node_modules present (PM spawn overhead)
#   run_build       - `pm run build` real task (lodash/dayjs/semver/TS transpile)
#
# Results written to results/<pm>-<version>.json (or results/<pm>.json).
set -uo pipefail

PM="${1:-}"
REQ_VER="${2:-}"
if [[ -z "$PM" ]]; then
  echo "usage: bench.sh <npm|pnpm|bun|nub|aube> [version]" >&2
  exit 2
fi

RESULTS_DIR="results"
mkdir -p "$RESULTS_DIR"
OUT_JSON="$RESULTS_DIR/${PM}-${REQ_VER:-latest}.json"

# ---- per-PM command + cache definitions -------------------------------------
# CACHE_WIPE / WARM_PREPARE / FROZEN_PREPARE are *command strings* (not
# functions) because hyperfine's --prepare runs in a child shell and cannot
# see our functions.
# Nested workspace node_modules left by another PM corrupt npm's ideal tree
# ("Invalid Version: ") — always wipe them with the root node_modules.
NM_WIPE="rm -rf node_modules packages/core/node_modules packages/cli/node_modules"
LOCKFILES="package-lock.json pnpm-lock.yaml bun.lock bun.lockb nub.lock aube-lock.yaml aube.lock"

case "$PM" in
  npm)
    INSTALL="npm install --no-audit --no-fund"
    WARM_INSTALL="npm install --prefer-offline --no-audit --no-fund"
    FROZEN_INSTALL="npm ci --prefer-offline --no-audit --no-fund"
    RUN="npm run"
    CACHE_WIPE="rm -rf \"$HOME/.npm\""
    version_cmd="npm --version"
    ;;
  pnpm)
    export PNPM_STORE_DIR="$PWD/.pnpm-store"
    pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
    INSTALL="pnpm install --store-dir $PNPM_STORE_DIR"
    WARM_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --prefer-offline"
    FROZEN_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --frozen-lockfile --prefer-offline"
    RUN="pnpm run"
    CACHE_WIPE="rm -rf \"$PNPM_STORE_DIR\""
    version_cmd="pnpm --version"
    ;;
  bun)
    export BUN_INSTALL_CACHE_DIR="$PWD/.bun-cache"
    INSTALL="bun install"
    WARM_INSTALL="bun install"
    FROZEN_INSTALL="bun install --frozen-lockfile"
    RUN="bun run"
    CACHE_WIPE="rm -rf \"$BUN_INSTALL_CACHE_DIR\""
    version_cmd="bun --version"
    ;;
  nub)
    INSTALL="nub install"
    WARM_INSTALL="nub install"
    FROZEN_INSTALL="nub install --frozen-lockfile"
    RUN="nub run"
    CACHE_WIPE="rm -rf \"$HOME/.nub\" \"$HOME/.local/share/nub\" \"$HOME/.cache/nub\" \"$PWD/.nub-store\""
    version_cmd="nub --version"
    ;;
  aube)
    INSTALL="aube install"
    WARM_INSTALL="aube install"
    FROZEN_INSTALL="aube install --frozen-lockfile"
    RUN="aube run"
    CACHE_WIPE="rm -rf \"$HOME/.aube\" \"$HOME/.local/share/aube\" \"$HOME/.cache/aube\" \"$PWD/.aube-store\""
    version_cmd="aube --version"
    ;;
  *)
    echo "unknown pm: $PM" >&2
    exit 2
    ;;
esac

WARM_PREPARE="$NM_WIPE"
FROZEN_PREPARE="$NM_WIPE"
COLD_PREPARE="$CACHE_WIPE; $NM_WIPE; rm -f $LOCKFILES"

PM_VERSION="$($version_cmd 2>/dev/null || echo unknown)"
NODE_VERSION="$(node --version)"

echo "==> Benchmarking '$PM'  (pm=$PM_VERSION, requested=$REQ_VER, node=$NODE_VERSION)"

# ---------- hyperfine helpers ----------
hf_json() { mktemp -d "/tmp/hf.XXXXXX"; }
read_ms() {
  # prints "mean stddev" in SECONDS (hyperfine exports seconds).
  # stddev may be null when runs=1.
  node -e '
    const fs=require("fs");
    const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const r=d.results && d.results[0];
    if(!r || typeof r.mean!=="number") process.exit(1);
    const sd=(r.stddev==null?0:r.stddev);
    console.log(r.mean.toFixed(4)+" "+sd.toFixed(4));
  ' "$1"
}
# Overridable for local smoke tests (CI uses the defaults below).
HF_RUNS_COLD="${HF_RUNS_COLD:-3}"
HF_RUNS_WARM="${HF_RUNS_WARM:-4}"
HF_RUNS_FROZEN="${HF_RUNS_FROZEN:-4}"
HF_RUNS_NOOP="${HF_RUNS_NOOP:-8}"
HF_RUNS_BUILD="${HF_RUNS_BUILD:-4}"

# ---------- Scenario 1: cold install ----------
d=$(hf_json)
hyperfine --runs "$HF_RUNS_COLD" --warmup 0 \
  --prepare "$COLD_PREPARE" \
  --ignore-failure --export-json "$d/cold.json" \
  --show-output \
  "$INSTALL" >/dev/null 2>&1 || true
COLD=$(read_ms "$d/cold.json" 2>/dev/null | awk '{print $1}') || COLD=""
COLD_SD=$(read_ms "$d/cold.json" 2>/dev/null | awk '{print $2}') || COLD_SD=""
echo "install_cold: ${COLD:-NA} s (±${COLD_SD:-NA})"

# ---------- Scenario 2: warm install (cache + lockfile kept) ----------
# Untimed warm-up so the resolution cache is fully populated, then time
# re-linking from cache.
( eval "$WARM_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
d2=$(hf_json)
hyperfine --runs "$HF_RUNS_WARM" --warmup 0 \
  --prepare "$WARM_PREPARE" \
  --ignore-failure --export-json "$d2/warm.json" \
  "$WARM_INSTALL" >/dev/null 2>&1 || true
WARM=$(read_ms "$d2/warm.json" 2>/dev/null | awk '{print $1}') || WARM=""
WARM_SD=$(read_ms "$d2/warm.json" 2>/dev/null | awk '{print $2}') || WARM_SD=""
echo "install_warm: ${WARM:-NA} s (±${WARM_SD:-NA})"

# ---------- Scenario 3: frozen/CI install (lockfile restore path) ----------
( eval "$FROZEN_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
dF=$(hf_json)
hyperfine --runs "$HF_RUNS_FROZEN" --warmup 0 \
  --prepare "$FROZEN_PREPARE" \
  --ignore-failure --export-json "$dF/frozen.json" \
  "$FROZEN_INSTALL" >/dev/null 2>&1 || true
FROZEN=$(read_ms "$dF/frozen.json" 2>/dev/null | awk '{print $1}') || FROZEN=""
FROZEN_SD=$(read_ms "$dF/frozen.json" 2>/dev/null | awk '{print $2}') || FROZEN_SD=""
echo "install_frozen: ${FROZEN:-NA} s (±${FROZEN_SD:-NA})"

# ---------- Scenario 4: run noop (PM spawn overhead) ----------
( [ -d node_modules ] || $WARM_INSTALL >/dev/null 2>&1 ) || true
d3=$(hf_json)
hyperfine --runs "$HF_RUNS_NOOP" --warmup 1 \
  --ignore-failure --export-json "$d3/noop.json" \
  "$RUN noop" >/dev/null 2>&1 || true
NOOP=$(read_ms "$d3/noop.json" 2>/dev/null | awk '{print $1}') || NOOP=""
NOOP_SD=$(read_ms "$d3/noop.json" 2>/dev/null | awk '{print $2}') || NOOP_SD=""
echo "run_noop: ${NOOP:-NA} s (±${NOOP_SD:-NA})"

# ---------- Scenario 5: run build (real task) ----------
d4=$(hf_json)
hyperfine --runs "$HF_RUNS_BUILD" --warmup 1 \
  --ignore-failure --export-json "$d4/build.json" \
  "$RUN build" >/dev/null 2>&1 || true
BUILD=$(read_ms "$d4/build.json" 2>/dev/null | awk '{print $1}') || BUILD=""
BUILD_SD=$(read_ms "$d4/build.json" 2>/dev/null | awk '{print $2}') || BUILD_SD=""
echo "run_build: ${BUILD:-NA} s (±${BUILD_SD:-NA})"

# ---------- write results ----------
export PM PM_VERSION REQ_VER NODE_VERSION OUT_JSON
export HF_RUNS_COLD HF_RUNS_WARM HF_RUNS_FROZEN HF_RUNS_NOOP HF_RUNS_BUILD
export COLD COLD_SD WARM WARM_SD FROZEN FROZEN_SD NOOP NOOP_SD BUILD BUILD_SD
export SCHEMA_VERSION=2
node -e '
const fs=require("fs");
const o={
  schema: 2,
  pm: process.env.PM,
  pm_version: process.env.PM_VERSION,
  requested_version: process.env.REQ_VER || null,
  node_version: process.env.NODE_VERSION,
  recorded_at: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  hyperfine_runs: {
    cold: +process.env.HF_RUNS_COLD,
    warm: +process.env.HF_RUNS_WARM,
    frozen: +process.env.HF_RUNS_FROZEN,
    noop: +process.env.HF_RUNS_NOOP,
    build: +process.env.HF_RUNS_BUILD,
  },
  scenarios: {
    install_cold:   num(process.env.COLD, process.env.COLD_SD),
    install_warm:   num(process.env.WARM, process.env.WARM_SD),
    install_frozen: num(process.env.FROZEN, process.env.FROZEN_SD),
    run_noop:       num(process.env.NOOP, process.env.NOOP_SD),
    run_build:      num(process.env.BUILD, process.env.BUILD_SD),
  }
};
function num(m,s){ return (m===""||m==null)?null:{mean:+m, stddev:+(s||0)}; }
fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(o,null,2));
'
echo "==> Wrote $OUT_JSON"

# cleanup temp hf dirs
rm -rf /tmp/hf.* 2>/dev/null || true
