#!/usr/bin/env bash
# Package-manager benchmark harness (hyperfine edition).
# Usage: bash bench.sh <pm> [version] [fixture]
#   pm in: npm pnpm bun nub aube
#   version: optional pinned version being tested (recorded in output)
#   fixture: synthetic | handle | vitesse   (default: synthetic)
#
# Each scenario is timed with hyperfine (multiple runs -> mean + stddev):
#   install_cold    - no package-manager cache, no node_modules, no lockfile
#   install_warm    - cache + lockfile present, node_modules removed (re-link)
#   install_frozen  - cache + lockfile present, frozen/CI install (pure restore)
#   run_noop        - `pm run noop` with node_modules present (PM spawn overhead)
#   run_build       - `pm run <build>` real task
#
# Results written to results/[<fixture>-]<pm>-<version>.json
set -uo pipefail

PM="${1:-}"
REQ_VER="${2:-}"
FIXTURE="${3:-synthetic}"
if [[ -z "$PM" ]]; then
  echo "usage: bench.sh <npm|pnpm|bun|nub|aube> [version] [fixture]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$ROOT/results"
mkdir -p "$RESULTS_DIR"
# Always prefix fixture so CI artifact globs never collide across fixtures.
OUT_JSON="$RESULTS_DIR/${FIXTURE}-${PM}-${REQ_VER:-latest}.json"

# ---- prepare fixture workspace ----------------------------------------------
if [[ "$FIXTURE" == "synthetic" ]]; then
  WORK="$ROOT"
else
  bash "$ROOT/scripts/prepare-fixture.sh" "$FIXTURE" "$ROOT/work" >/dev/null
  WORK="$ROOT/work/$FIXTURE"
fi
cd "$WORK"

# Read fixture build/noop script names (fallback to generic).
BUILD_SCRIPT="$(node -e 'try{const m=require("fs").readFileSync(process.argv[1],"utf8");const j=JSON.parse(m);console.log((j.scripts&&j.scripts.build)?"build":"build")}catch{console.log("build")}' "$ROOT/fixtures/manifest.json" 2>/dev/null || echo build)"
# Prefer the fixture's own `build`; prepare-fixture.sh always injects `noop`.
RUN_BUILD_CMD="build"
RUN_NOOP_CMD="noop"

# ---- per-PM command + cache definitions -------------------------------------
# CACHE_WIPE / WARM_PREPARE / FROZEN_PREPARE are *command strings* (not
# functions) because hyperfine's --prepare runs in a child shell and cannot
# see our functions.
# Nested workspace node_modules left by another PM corrupt npm's ideal tree
# ("Invalid Version: ") — always wipe them with the root node_modules.
NM_WIPE="rm -rf node_modules packages/*/node_modules"
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
    export PNPM_STORE_DIR="${PNPM_STORE_DIR:-$WORK/.pnpm-store}"
    pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
    INSTALL="pnpm install --store-dir $PNPM_STORE_DIR"
    WARM_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --prefer-offline"
    FROZEN_INSTALL="pnpm install --store-dir $PNPM_STORE_DIR --frozen-lockfile --prefer-offline"
    RUN="pnpm run"
    CACHE_WIPE="rm -rf \"$PNPM_STORE_DIR\""
    version_cmd="pnpm --version"
    ;;
  bun)
    export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$WORK/.bun-cache}"
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
    CACHE_WIPE="rm -rf \"$HOME/.nub\" \"$HOME/.local/share/nub\" \"$HOME/.cache/nub\" \"$WORK/.nub-store\""
    version_cmd="nub --version"
    ;;
  aube)
    INSTALL="aube install"
    WARM_INSTALL="aube install"
    FROZEN_INSTALL="aube install --frozen-lockfile"
    RUN="aube run"
    CACHE_WIPE="rm -rf \"$HOME/.aube\" \"$HOME/.local/share/aube\" \"$HOME/.cache/aube\" \"$WORK/.aube-store\""
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

echo "==> Benchmarking '$PM'  fixture=$FIXTURE  (pm=$PM_VERSION, requested=$REQ_VER, node=$NODE_VERSION)"
echo "==> workdir: $WORK"

# ---------- hyperfine helpers ----------
hf_json() { mktemp -d "/tmp/hf.XXXXXX"; }
read_ms() {
  # prints "mean stddev ok" in SECONDS. stddev may be null when runs=1.
  # ok=1 only when every hyperfine run exited 0.
  node -e '
    const fs=require("fs");
    const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
    const r=d.results && d.results[0];
    if(!r || typeof r.mean!=="number") process.exit(1);
    const sd=(r.stddev==null?0:r.stddev);
    const codes=(r.exit_codes||[]);
    const ok=(codes.length>0 && codes.every(c=>c===0))?1:0;
    console.log(r.mean.toFixed(4)+" "+sd.toFixed(4)+" "+ok);
  ' "$1"
}
pick() { echo "$1" | awk -v n="${2:-1}" "{print \$$n}"; }
# Real-world fixtures are heavier — slightly fewer cold runs keeps CI sane.
if [[ "$FIXTURE" == "synthetic" ]]; then
  HF_RUNS_COLD="${HF_RUNS_COLD:-3}"
  HF_RUNS_WARM="${HF_RUNS_WARM:-4}"
  HF_RUNS_FROZEN="${HF_RUNS_FROZEN:-4}"
  HF_RUNS_NOOP="${HF_RUNS_NOOP:-8}"
  HF_RUNS_BUILD="${HF_RUNS_BUILD:-4}"
else
  HF_RUNS_COLD="${HF_RUNS_COLD:-2}"
  HF_RUNS_WARM="${HF_RUNS_WARM:-3}"
  HF_RUNS_FROZEN="${HF_RUNS_FROZEN:-3}"
  HF_RUNS_NOOP="${HF_RUNS_NOOP:-5}"
  HF_RUNS_BUILD="${HF_RUNS_BUILD:-3}"
fi

# ---------- Scenario 1: cold install ----------
d=$(hf_json)
hyperfine --runs "$HF_RUNS_COLD" --warmup 0 \
  --prepare "$COLD_PREPARE" \
  --ignore-failure --export-json "$d/cold.json" \
  "$INSTALL" >/dev/null 2>&1 || true
COLD_LINE=$(read_ms "$d/cold.json" 2>/dev/null) || COLD_LINE=""
COLD=$(pick "$COLD_LINE" 1); COLD_SD=$(pick "$COLD_LINE" 2); COLD_OK=$(pick "$COLD_LINE" 3)
[[ "${COLD_OK:-0}" == "1" ]] || { COLD=""; COLD_SD=""; }
echo "install_cold: ${COLD:-NA} s (±${COLD_SD:-NA}) ok=${COLD_OK:-0}"

# ---------- Scenario 2: warm install (cache + lockfile kept) ----------
( eval "$WARM_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
d2=$(hf_json)
hyperfine --runs "$HF_RUNS_WARM" --warmup 0 \
  --prepare "$WARM_PREPARE" \
  --ignore-failure --export-json "$d2/warm.json" \
  "$WARM_INSTALL" >/dev/null 2>&1 || true
WARM_LINE=$(read_ms "$d2/warm.json" 2>/dev/null) || WARM_LINE=""
WARM=$(pick "$WARM_LINE" 1); WARM_SD=$(pick "$WARM_LINE" 2); WARM_OK=$(pick "$WARM_LINE" 3)
[[ "${WARM_OK:-0}" == "1" ]] || { WARM=""; WARM_SD=""; }
echo "install_warm: ${WARM:-NA} s (±${WARM_SD:-NA}) ok=${WARM_OK:-0}"

# ---------- Scenario 3: frozen/CI install (lockfile restore path) ----------
( eval "$FROZEN_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
dF=$(hf_json)
hyperfine --runs "$HF_RUNS_FROZEN" --warmup 0 \
  --prepare "$FROZEN_PREPARE" \
  --ignore-failure --export-json "$dF/frozen.json" \
  "$FROZEN_INSTALL" >/dev/null 2>&1 || true
FROZEN_LINE=$(read_ms "$dF/frozen.json" 2>/dev/null) || FROZEN_LINE=""
FROZEN=$(pick "$FROZEN_LINE" 1); FROZEN_SD=$(pick "$FROZEN_LINE" 2); FROZEN_OK=$(pick "$FROZEN_LINE" 3)
[[ "${FROZEN_OK:-0}" == "1" ]] || { FROZEN=""; FROZEN_SD=""; }
echo "install_frozen: ${FROZEN:-NA} s (±${FROZEN_SD:-NA}) ok=${FROZEN_OK:-0}"

# ---------- Scenario 4: run noop (PM spawn overhead) ----------
( [ -d node_modules ] || $WARM_INSTALL >/dev/null 2>&1 ) || true
d3=$(hf_json)
hyperfine --runs "$HF_RUNS_NOOP" --warmup 1 \
  --ignore-failure --export-json "$d3/noop.json" \
  "$RUN $RUN_NOOP_CMD" >/dev/null 2>&1 || true
NOOP_LINE=$(read_ms "$d3/noop.json" 2>/dev/null) || NOOP_LINE=""
NOOP=$(pick "$NOOP_LINE" 1); NOOP_SD=$(pick "$NOOP_LINE" 2); NOOP_OK=$(pick "$NOOP_LINE" 3)
[[ "${NOOP_OK:-0}" == "1" ]] || { NOOP=""; NOOP_SD=""; }
echo "run_noop: ${NOOP:-NA} s (±${NOOP_SD:-NA}) ok=${NOOP_OK:-0}"

# ---------- Scenario 5: run build (real task) ----------
d4=$(hf_json)
hyperfine --runs "$HF_RUNS_BUILD" --warmup 1 \
  --ignore-failure --export-json "$d4/build.json" \
  "$RUN $RUN_BUILD_CMD" >/dev/null 2>&1 || true
BUILD_LINE=$(read_ms "$d4/build.json" 2>/dev/null) || BUILD_LINE=""
BUILD=$(pick "$BUILD_LINE" 1); BUILD_SD=$(pick "$BUILD_LINE" 2); BUILD_OK=$(pick "$BUILD_LINE" 3)
# Guard against "instant fail" (pm exits 0 without running the task) — require
# the build wall time to exceed the noop overhead by a little, or be > 200ms.
if [[ "${BUILD_OK:-0}" == "1" && -n "$BUILD" && -n "$NOOP" ]]; then
  node -e '
    const build=+process.argv[1], noop=+process.argv[2];
    const ok = build >= 0.2 && build >= noop * 1.15;
    process.exit(ok ? 0 : 1);
  ' "$BUILD" "$NOOP" || { BUILD=""; BUILD_SD=""; BUILD_OK=0; echo "run_build: discarded (too close to noop — task likely did not run)"; }
fi
[[ "${BUILD_OK:-0}" == "1" ]] || { BUILD=""; BUILD_SD=""; }
echo "run_build: ${BUILD:-NA} s (±${BUILD_SD:-NA}) ok=${BUILD_OK:-0}"

# ---------- write results ----------
export PM PM_VERSION REQ_VER FIXTURE NODE_VERSION OUT_JSON
export HF_RUNS_COLD HF_RUNS_WARM HF_RUNS_FROZEN HF_RUNS_NOOP HF_RUNS_BUILD
export COLD COLD_SD WARM WARM_SD FROZEN FROZEN_SD NOOP NOOP_SD BUILD BUILD_SD
export COLD_OK WARM_OK FROZEN_OK NOOP_OK BUILD_OK
export SCHEMA_VERSION=4
node -e '
const fs=require("fs");
const o={
  schema: 4,
  fixture: process.env.FIXTURE,
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
  },
  ok: {
    install_cold: process.env.COLD_OK === "1",
    install_warm: process.env.WARM_OK === "1",
    install_frozen: process.env.FROZEN_OK === "1",
    run_noop: process.env.NOOP_OK === "1",
    run_build: process.env.BUILD_OK === "1",
  }
};
function num(m,s){ return (m===""||m==null)?null:{mean:+m, stddev:+(s||0)}; }
fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(o,null,2));
'
echo "==> Wrote $OUT_JSON"

rm -rf /tmp/hf.* 2>/dev/null || true
