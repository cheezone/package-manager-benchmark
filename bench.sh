#!/usr/bin/env bash
# Package-manager benchmark harness (hyperfine edition).
# Usage: bash bench.sh <pm> [version] [fixture]
#   pm in: npm pnpm bun nub aube
#   version: optional pinned version being tested (recorded in output)
#   fixture: handle | vitesse   (default: handle)
#
# Each scenario is timed with hyperfine (multiple runs -> mean + stddev):
#   install_cold    - no package-manager cache, no node_modules, no lockfile
#   install_warm    - cache + lockfile present, node_modules removed (re-link)
#   install_frozen  - cache + lockfile present, frozen/CI install (pure restore)
#   run_noop        - `pm run noop` with node_modules present (PM spawn overhead)
#
# Results written to results/<fixture>-<pm>-<version>.json
set -uo pipefail

# vlt-benchmarks: never let corepack re-pin packageManager (antfu repos
# declare packageManager=pnpm@… and corepack would hijack every PM).
export COREPACK_ENABLE_STRICT=0
export COREPACK_ENABLE_AUTO_PIN=0

PM="${1:-}"
REQ_VER="${2:-}"
FIXTURE="${3:-handle}"
if [[ -z "$PM" ]]; then
  echo "usage: bench.sh <npm|pnpm|bun|nub|aube> [version] [fixture]" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$ROOT/results"
LOG_DIR="$ROOT/logs/${FIXTURE}-${PM}-${REQ_VER:-latest}"
rm -rf "$LOG_DIR"
mkdir -p "$RESULTS_DIR" "$LOG_DIR"
# Always prefix fixture so CI artifact globs never collide across fixtures.
OUT_JSON="$RESULTS_DIR/${FIXTURE}-${PM}-${REQ_VER:-latest}.json"

# ---- prepare fixture workspace (local copy of fixtures/<id>, never clone) ----
bash "$ROOT/scripts/prepare-fixture.sh" "$FIXTURE" "$ROOT/work" >/dev/null
WORK="$ROOT/work/$FIXTURE"
cd "$WORK"

# Prefer the fixture's own `noop` (prepare-fixture.sh always injects it).
RUN_NOOP_CMD="noop"

# ---- per-PM command + cache definitions -------------------------------------
# CACHE_WIPE / WARM_PREPARE / FROZEN_PREPARE are *command strings* (not
# functions) because hyperfine's --prepare runs in a child shell and cannot
# see our functions.
# Nested workspace node_modules left by another PM corrupt npm's ideal tree
# ("Invalid Version: ") — always wipe them with the root node_modules.
NM_WIPE="rm -rf node_modules; rm -rf packages/core/node_modules packages/cli/node_modules packages/tools/node_modules 2>/dev/null; true"
LOCKFILES="package-lock.json pnpm-lock.yaml bun.lock bun.lockb nub.lock aube-lock.yaml aube.lock"

# Bare install command + log redirect. HYPERFINE_ITERATION is 0-based in logs
# (hyperfine sets it for --prepare/command; fall back to 0).
LOG="$LOG_DIR"
BENCH_TIMEOUT="${BENCH_TIMEOUT:-180}"
wrap() {
  # wrap <name> <cmd...>  →  timeout-wrapped cmd with per-iteration log
  local name="$1"; shift
  local cmd="$*"
  local body
  if command -v timeout >/dev/null 2>&1; then
    body="timeout $BENCH_TIMEOUT $cmd"
  else
    body="perl -e 'alarm shift; exec @ARGV' $BENCH_TIMEOUT $cmd"
  fi
  echo "{ $body; } >> \"$LOG/\${HYPERFINE_ITERATION:-0}-$name.log\" 2>&1"
}

case "$PM" in
  npm)
    # vitesse (pre-catalog pin) has a vite 6 vs vite-plugin-vue-layouts peer
    # clash under a fresh resolve; same trick as vlt-benchmarks' "large" fixture.
    NPM_EXTRA=""
    [[ "$FIXTURE" == "vitesse" ]] && NPM_EXTRA="--legacy-peer-deps"
    INSTALL="$(wrap install npm install --no-audit --no-fund --ignore-scripts $NPM_EXTRA)"
    WARM_INSTALL="$(wrap install npm install --prefer-offline --no-audit --no-fund --ignore-scripts $NPM_EXTRA)"
    FROZEN_INSTALL="$(wrap install npm ci --prefer-offline --no-audit --no-fund --ignore-scripts $NPM_EXTRA)"
    RUN="npm run"
    CACHE_WIPE="rm -rf \"$HOME/.npm\""
    version_cmd="npm --version"
    ;;
  pnpm)
    export PNPM_STORE_DIR="${PNPM_STORE_DIR:-$WORK/.pnpm-store}"
    pnpm config set store-dir "$PNPM_STORE_DIR" >/dev/null 2>&1 || true
    INSTALL="$(wrap install pnpm install --store-dir $PNPM_STORE_DIR --ignore-scripts)"
    WARM_INSTALL="$(wrap install pnpm install --store-dir $PNPM_STORE_DIR --prefer-offline --ignore-scripts)"
    FROZEN_INSTALL="$(wrap install pnpm install --store-dir $PNPM_STORE_DIR --frozen-lockfile --prefer-offline --ignore-scripts)"
    RUN="pnpm run"
    CACHE_WIPE="rm -rf \"$PNPM_STORE_DIR\""
    version_cmd="pnpm --version"
    ;;
  bun)
    export BUN_INSTALL_CACHE_DIR="${BUN_INSTALL_CACHE_DIR:-$WORK/.bun-cache}"
    INSTALL="$(wrap install bun install --ignore-scripts)"
    WARM_INSTALL="$(wrap install bun install --ignore-scripts)"
    FROZEN_INSTALL="$(wrap install bun install --frozen-lockfile --ignore-scripts)"
    RUN="bun run"
    CACHE_WIPE="rm -rf \"$BUN_INSTALL_CACHE_DIR\""
    version_cmd="bun --version"
    ;;
  nub)
    # Same contract as npm/pnpm/bun/aube: resolve+link only, no lifecycle.
    # Without this nub's defaultTrust runs esbuild/nodejieba/vue-demi scripts
    # (C++ compile) and the install is unfairly charged for that work.
    INSTALL="$(wrap install nub install --ignore-scripts)"
    WARM_INSTALL="$(wrap install nub install --ignore-scripts)"
    FROZEN_INSTALL="$(wrap install nub ci --ignore-scripts)"
    RUN="nub run"
    CACHE_WIPE="rm -rf \"$HOME/.nub\" \"$HOME/.local/share/nub\" \"$HOME/.cache/nub\" \"$WORK/.nub-store\""
    version_cmd="nub --version"
    ;;
  aube)
    # Skip lifecycle scripts (nodejieba node-gyp) so install measures
    # resolve+link only. .npmrc ignore-scripts is also set in the fixture.
    INSTALL="$(wrap install aube install --ignore-scripts --no-frozen-lockfile)"
    WARM_INSTALL="$(wrap install aube install --ignore-scripts --no-frozen-lockfile)"
    FROZEN_INSTALL="$(wrap install aube ci --ignore-scripts)"
    RUN="aubr"
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

# aube --version prints "2.2.4 linux-x64 (2026-08-31)" — keep only the semver
_raw_ver="$($version_cmd 2>/dev/null || true)"
PM_VERSION="$(printf '%s\n' "$_raw_ver" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?' | head -n1)"
PM_VERSION="${PM_VERSION:-unknown}"
NODE_VERSION="$(node --version)"
# node vs rust lineage (pnpm 12+ / bun are rust)
PM_IMPL="$(node -e '
  const pm=process.argv[1], ver=String(process.argv[2]||process.argv[3]||"");
  const maj=+ver.split(".")[0]||0;
  if (pm==="pnpm") process.stdout.write(maj>=12?"rust":"node");
  else if (pm==="bun") process.stdout.write("rust");
  else process.stdout.write("node");
' "$PM" "$REQ_VER" "$PM_VERSION")"

echo "==> Benchmarking '$PM'  fixture=$FIXTURE  (pm=$PM_VERSION/$PM_IMPL, requested=$REQ_VER, node=$NODE_VERSION)"
echo "==> workdir: $WORK"

# ---------- hyperfine helpers ----------
hf_json() { mktemp -d "/tmp/hf.XXXXXX"; }

# Parse one hyperfine --export-json file into $2 (JSON: mean/stddev/median/min/max/ok).
# ok=1 when stats exist AND every exit code is 0 (missing exit_codes => ok).
hf_stat() {
  node -e '
    const fs = require("fs");
    try {
      const d = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const r = d.results && d.results[0];
      if (!r || typeof r.mean !== "number") process.exit(1);
      const num = (v) => (v == null || Number.isNaN(+v) ? null : +v);
      const sd = num(r.stddev) ?? 0;
      const median = num(r.median) ?? r.mean;
      const mn = num(r.min) ?? r.mean;
      const mx = num(r.max) ?? r.mean;
      const codes = (r.exit_codes || []).map(Number);
      const ok = codes.length === 0 || codes.every((c) => c === 0) ? 1 : 0;
      fs.writeFileSync(
        process.argv[2],
        JSON.stringify({
          mean: +r.mean,
          stddev: sd,
          median,
          min: mn,
          max: mx,
          ok,
        })
      );
    } catch {
      process.exit(1);
    }
  ' "$1" "$2" 2>/dev/null
}

STAT="$(mktemp -d /tmp/bstat.XXXXXX)"

# 10 runs per scenario (override via env). Primary display metric: median.
HF_RUNS_COLD="${HF_RUNS_COLD:-10}"
HF_RUNS_WARM="${HF_RUNS_WARM:-10}"
HF_RUNS_FROZEN="${HF_RUNS_FROZEN:-10}"
HF_RUNS_NOOP="${HF_RUNS_NOOP:-10}"

report() {
  # report <name> <statfile>
  local name="$1" sf="$2"
  if [[ ! -s "$sf" ]]; then
    echo "$name: NA (failed or empty)"
    echo "" > "$sf.missing"
    return 0
  fi
  node -e '
    const fs = require("fs");
    try {
      const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      if (!s || s.ok !== 1 || s.mean == null) process.exit(1);
      const f = (x) => (+x).toFixed(4);
      console.log(
        `${process.argv[2]}: median=${f(s.median)}s mean=${f(s.mean)}s ±${f(s.stddev)} [${f(s.min)}–${f(s.max)}] ok=1`
      );
    } catch {
      process.exit(1);
    }
  ' "$sf" "$name" 2>/dev/null || {
    echo "$name: NA (failed or empty)"
    echo "" > "$sf.missing"
    return 0
  }
}

# ---------- Scenario 1: cold install ----------
d=$(hf_json)
hyperfine --runs "$HF_RUNS_COLD" --warmup 0 \
  --prepare "$COLD_PREPARE" \
  --ignore-failure --export-json "$d/cold.json" \
  "$INSTALL" >/dev/null 2>&1 || true
hf_stat "$d/cold.json" "$STAT/cold" || true
report install_cold "$STAT/cold"

# ---------- Scenario 2: warm install (cache + lockfile kept) ----------
( eval "$WARM_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
d2=$(hf_json)
hyperfine --runs "$HF_RUNS_WARM" --warmup 0 \
  --prepare "$WARM_PREPARE" \
  --ignore-failure --export-json "$d2/warm.json" \
  "$WARM_INSTALL" >/dev/null 2>&1 || true
hf_stat "$d2/warm.json" "$STAT/warm" || true
report install_warm "$STAT/warm"

# ---------- Scenario 3: frozen/CI install (lockfile restore path) ----------
( eval "$FROZEN_PREPARE"; $WARM_INSTALL >/dev/null 2>&1 ) || true
dF=$(hf_json)
hyperfine --runs "$HF_RUNS_FROZEN" --warmup 0 \
  --prepare "$FROZEN_PREPARE" \
  --ignore-failure --export-json "$dF/frozen.json" \
  "$FROZEN_INSTALL" >/dev/null 2>&1 || true
hf_stat "$dF/frozen.json" "$STAT/frozen" || true
report install_frozen "$STAT/frozen"

# ---------- package count (after a successful warm install) ----------
( [ -d node_modules ] || $WARM_INSTALL >/dev/null 2>&1 ) || true
PKG_COUNT="$(node "$ROOT/scripts/count-packages.js" . 2>/dev/null || echo 0)"
echo "package_count: $PKG_COUNT"

# ---------- Scenario 4: run noop (PM spawn overhead) ----------
( [ -d node_modules ] || $WARM_INSTALL >/dev/null 2>&1 ) || true
d3=$(hf_json)
hyperfine --runs "$HF_RUNS_NOOP" --warmup 1 \
  --ignore-failure --export-json "$d3/noop.json" \
  "$RUN $RUN_NOOP_CMD" >/dev/null 2>&1 || true
hf_stat "$d3/noop.json" "$STAT/noop" || true
report run_noop "$STAT/noop"

# ---------- write results ----------
export PM PM_VERSION REQ_VER FIXTURE NODE_VERSION OUT_JSON STAT
export PM_IMPL
export HF_RUNS_COLD HF_RUNS_WARM HF_RUNS_FROZEN HF_RUNS_NOOP
export SCHEMA_VERSION=8
export PKG_COUNT
node -e '
const fs = require("fs");
const path = require("path");
const STAT = process.env.STAT;
function load(key) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(STAT, key), "utf8"));
    if (!s || typeof s.mean !== "number") return { value: null, ok: false };
    const o = {
      mean: s.mean,
      stddev: s.stddev || 0,
      median: s.median != null ? s.median : s.mean,
      min: s.min != null ? s.min : s.mean,
      max: s.max != null ? s.max : s.mean,
    };
    return { value: s.ok === 1 ? o : null, ok: s.ok === 1 };
  } catch {
    return { value: null, ok: false };
  }
}
const cold = load("cold");
const warm = load("warm");
const frozen = load("frozen");
const noop = load("noop");
const o = {
  schema: 8,
  fixture: process.env.FIXTURE,
  pm: process.env.PM,
  pm_version: process.env.PM_VERSION,
  impl: process.env.PM_IMPL || null,
  requested_version: process.env.REQ_VER || null,
  node_version: process.env.NODE_VERSION,
  recorded_at: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  package_count: +process.env.PKG_COUNT || 0,
  hyperfine_runs: {
    cold: +process.env.HF_RUNS_COLD,
    warm: +process.env.HF_RUNS_WARM,
    frozen: +process.env.HF_RUNS_FROZEN,
    noop: +process.env.HF_RUNS_NOOP,
  },
  scenarios: {
    install_cold: cold.value,
    install_warm: warm.value,
    install_frozen: frozen.value,
    run_noop: noop.value,
  },
  // ms per installed package (null when count unknown or scenario failed)
  per_pkg_ms: (() => {
    const n = +process.env.PKG_COUNT || 0;
    const per = (v) => (v && n > 0 ? +(((v.median != null ? v.median : v.mean) * 1000) / n).toFixed(2) : null);
    return {
      install_cold: per(cold.value),
      install_warm: per(warm.value),
      install_frozen: per(frozen.value),
    };
  })(),
  ok: {
    install_cold: cold.ok,
    install_warm: warm.ok,
    install_frozen: frozen.ok,
    run_noop: noop.ok,
  },
};
fs.writeFileSync(process.env.OUT_JSON, JSON.stringify(o, null, 2));
'
echo "==> Wrote $OUT_JSON"

rm -rf /tmp/hf.* /tmp/bstat.* 2>/dev/null || true
