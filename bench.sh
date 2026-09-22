#!/usr/bin/env bash
# Package-manager benchmark harness (hyperfine edition).
# Usage: bash bench.sh <pm> [version]
#   pm in: npm pnpm bun nub aube yarn
#   version: optional pinned version being tested (recorded in output)
#
# Each scenario is timed with hyperfine (multiple runs -> mean + stddev):
#   install_cold  - no package-manager cache, no node_modules, no lockfile
#   install_warm  - cache + lockfile present, node_modules removed (re-link)
#   run_noop      - `pm run noop` with node_modules present (PM spawn overhead)
#   run_build     - `pm run build` real task (lodash/dayjs/semver/TS transpile)
#
# Results written to results/<pm>-<version>.json (or results/<pm>.json).
set -uo pipefail

PM="${1:-}"
REQ_VER="${2:-}"
if [[ -z "$PM" ]]; then
  echo "usage: bench.sh <npm|pnpm|bun|nub|aube|yarn> [version]" >&2
  exit 2
fi

RESULTS_DIR="results"
mkdir -p "$RESULTS_DIR"
OUT_JSON="$RESULTS_DIR/${PM}-${REQ_VER:-latest}.json"

# ---- per-PM command + cache definitions -------------------------------------
# CACHE_WIPE / WARM_PREPARE are *command strings* (not functions) because
# hyperfine's --prepare runs in a child shell and cannot see our functions.
case "$PM" in
  npm)
    INSTALL="npm install"
    CI_INSTALL="npm install --prefer-offline --no-audit --no-fund"
    RUN="npm run"
    CACHE_WIPE="rm -rf \"$HOME/.npm\""
    WARM_PREPARE="rm -f package-lock.json; rm -rf node_modules"
    version_cmd="npm --version"
    ;;
  pnpm)
    export PNPM_STORE_DIR="$PWD/.pnpm-store"
    pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
    INSTALL="pnpm install --store-dir $PNPM_STORE_DIR"
    CI_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --frozen-lockfile"
    RUN="pnpm run"
    CACHE_WIPE="rm -rf \"$PNPM_STORE_DIR\""
    WARM_PREPARE="rm -rf node_modules"
    version_cmd="pnpm --version"
    ;;
  bun)
    export BUN_INSTALL_CACHE_DIR="$PWD/.bun-cache"
    INSTALL="bun install"
    CI_INSTALL="bun install"
    RUN="bun run"
    CACHE_WIPE="rm -rf \"$BUN_INSTALL_CACHE_DIR\""
    WARM_PREPARE="rm -rf node_modules"
    version_cmd="bun --version"
    ;;
  nub)
    INSTALL="nub install"
    CI_INSTALL="nub install"
    RUN="nub run"
    CACHE_WIPE="rm -rf \"$HOME/.nub\" \"$HOME/.local/share/nub\" \"$HOME/.cache/nub\" \"$PWD/.nub-store\""
    WARM_PREPARE="rm -rf node_modules"
    version_cmd="nub --version"
    ;;
  aube)
    INSTALL="aube install"
    CI_INSTALL="aube install"
    RUN="aubr"
    CACHE_WIPE="rm -rf \"$HOME/.aube\" \"$HOME/.local/share/aube\" \"$HOME/.cache/aube\" \"$PWD/.aube-store\""
    WARM_PREPARE="rm -rf node_modules"
    version_cmd="aube --version"
    ;;
  yarn)
    # Mirror vltpkg/benchmarks' proven berry setup: explicit corepack version
    # (no reliance on a packageManager field), immutable installs disabled,
    # no mirror, node-modules linker. Reliably works on CI Linux runners.
    cat > .yarnrc.yml <<'YML'
enableImmutableInstalls: false
enableMirror: false
nodeLinker: node-modules
YML
    YV="${REQ_VER:-latest}"
    INSTALL="corepack yarn@$YV install"
    CI_INSTALL="corepack yarn@$YV install"
    RUN="corepack yarn@$YV run"
    CACHE_WIPE="rm -rf \"$HOME/.yarn\" \"$PWD/.yarn\""
    WARM_PREPARE="rm -rf node_modules"
    version_cmd="corepack yarn@$YV --version"
    ;;
  *)
    echo "unknown pm: $PM" >&2
    exit 2
    ;;
esac

LOCKFILES="package-lock.json pnpm-lock.yaml bun.lock bun.lockb yarn.lock nub.lock aube-lock.yaml"
COLD_PREPARE="$CACHE_WIPE; rm -rf node_modules; rm -f $LOCKFILES"

PM_VERSION="$($version_cmd 2>/dev/null || echo unknown)"
NODE_VERSION="$(node --version)"

echo "==> Benchmarking '$PM'  (pm=$PM_VERSION, requested=$REQ_VER, node=$NODE_VERSION)"

# ---------- hyperfine helpers ----------
hf_json() { mktemp -d "/tmp/hf.XXXXXX"; }
read_ms() {
  # prints "mean stddev" in SECONDS (hyperfine exports seconds)
  node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('$1','utf8'));const r=d.results[0];if(!r){process.exit(1)}console.log((r.mean).toFixed(4)+' '+(r.stddev).toFixed(4))"
}
HF_RUNS_COLD=3
HF_RUNS_WARM=4
HF_RUNS_NOOP=8
HF_RUNS_BUILD=4

# ---------- Scenario 1: cold install ----------
d=$(hf_json)
hyperfine --runs "$HF_RUNS_COLD" --warmup 0 \
  --prepare "$COLD_PREPARE" \
  --export-json "$d/cold.json" \
  "$INSTALL" >/dev/null 2>&1 || true
COLD=$(read_ms "$d/cold.json" 2>/dev/null | awk '{print $1}') || COLD=""
COLD_SD=$(read_ms "$d/cold.json" 2>/dev/null | awk '{print $2}') || COLD_SD=""
echo "install_cold: ${COLD:-NA} s (±${COLD_SD:-NA})"

# ---------- Scenario 2: warm install (cache + lockfile kept) ----------
# Untimed warm-up so the resolution cache is fully populated, then time
# re-linking from cache. For npm, also drop the workspace lockfile (npm bug
# re-reading its own workspace lock) so it re-resolves from cache.
( eval "$WARM_PREPARE"; $CI_INSTALL >/dev/null 2>&1 ) || true
d2=$(hf_json)
hyperfine --runs "$HF_RUNS_WARM" --warmup 0 \
  --prepare "$WARM_PREPARE" \
  --export-json "$d2/warm.json" \
  "$CI_INSTALL" >/dev/null 2>&1 || true
WARM=$(read_ms "$d2/warm.json" 2>/dev/null | awk '{print $1}') || WARM=""
WARM_SD=$(read_ms "$d2/warm.json" 2>/dev/null | awk '{print $2}') || WARM_SD=""
echo "install_warm: ${WARM:-NA} s (±${WARM_SD:-NA})"

# ---------- Scenario 3: run noop (PM spawn overhead) ----------
# Ensure node_modules present for the run scenarios.
( [ -d node_modules ] || $CI_INSTALL >/dev/null 2>&1 ) || true
d3=$(hf_json)
hyperfine --runs "$HF_RUNS_NOOP" --warmup 1 \
  --export-json "$d3/noop.json" \
  "$RUN noop" >/dev/null 2>&1 || true
NOOP=$(read_ms "$d3/noop.json" 2>/dev/null | awk '{print $1}') || NOOP=""
NOOP_SD=$(read_ms "$d3/noop.json" 2>/dev/null | awk '{print $2}') || NOOP_SD=""
echo "run_noop: ${NOOP:-NA} s (±${NOOP_SD:-NA})"

# ---------- Scenario 4: run build (real task) ----------
d4=$(hf_json)
hyperfine --runs "$HF_RUNS_BUILD" --warmup 1 \
  --export-json "$d4/build.json" \
  "$RUN build" >/dev/null 2>&1 || true
BUILD=$(read_ms "$d4/build.json" 2>/dev/null | awk '{print $1}') || BUILD=""
BUILD_SD=$(read_ms "$d4/build.json" 2>/dev/null | awk '{print $2}') || BUILD_SD=""
echo "run_build: ${BUILD:-NA} s (±${BUILD_SD:-NA})"

# ---------- write results ----------
export PM PM_VERSION REQ_VER NODE_VERSION OUT_JSON
export HF_RUNS_COLD HF_RUNS_WARM HF_RUNS_NOOP HF_RUNS_BUILD
export COLD COLD_SD WARM WARM_SD NOOP NOOP_SD BUILD BUILD_SD
node -e '
const fs=require("fs");
const o={
  pm: process.env.PM,
  pm_version: process.env.PM_VERSION,
  requested_version: process.env.REQ_VER || null,
  node_version: process.env.NODE_VERSION,
  hyperfine_runs: { cold: process.env.HF_RUNS_COLD, warm: process.env.HF_RUNS_WARM, noop: process.env.HF_RUNS_NOOP, build: process.env.HF_RUNS_BUILD },
  scenarios: {
    install_cold: num(process.env.COLD, process.env.COLD_SD),
    install_warm: num(process.env.WARM, process.env.WARM_SD),
    run_noop:     num(process.env.NOOP, process.env.NOOP_SD),
    run_build:    num(process.env.BUILD, process.env.BUILD_SD),
  }
};
function num(m,s){ return (m===""||m==null)?null:{mean:+m, stddev:+(s||0)}; }
fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(o,null,2));
'
echo "==> Wrote $OUT_JSON"

# cleanup temp hf dirs
rm -rf /tmp/hf.* 2>/dev/null || true
