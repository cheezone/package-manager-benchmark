#!/usr/bin/env node
// Plan which matrix cells still need measuring.
//
// Env:
//   ONLY_FIXTURES  comma list or empty (all)
//   ONLY_PMS       comma list or empty (all)
//   ONLY_VERSIONS  comma list or empty (all) — match clean semver
//   FORCE          1 = re-measure even if store has a usable result
//   MAX_JOBS       optional cap (default 0 = no cap)
//
// Stdout: {"include":[...], "skipped":N, "selected":N}
// Existing usable rows in data/bench/ are skipped unless FORCE=1.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hasUsable, cleanVer } from "../../scripts/result-store.js";

function cmpVer(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const only = (env) =>
  (process.env[env] || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

const ONLY_FIXTURES = only("ONLY_FIXTURES");
const ONLY_PMS = only("ONLY_PMS");
const ONLY_VERSIONS = only("ONLY_VERSIONS");
const FORCE = process.env.FORCE === "1" || process.env.FORCE === "true";
const MAX_JOBS = parseInt(process.env.MAX_JOBS || "0", 10) || 0;

function inList(list, v) {
  return list.length === 0 || list.includes(v);
}

function versionMatch(list, version) {
  if (list.length === 0) return true;
  const cv = cleanVer(version);
  return list.some((x) => x === cv || x === version || cleanVer(x) === cv);
}

const raw = execFileSync("node", [path.join(ROOT, ".github/scripts/matrix.mjs")], {
  encoding: "utf8",
  cwd: ROOT,
  maxBuffer: 64 * 1024 * 1024,
  timeout: 120_000,
});
const full = JSON.parse(raw);

let skipped = 0;
let include = (full.include || []).filter((r) => {
  // handle pulls nodejieba@2.5.2; on Node 24 its prebuild is missing and
  // nub < 0.8 still ran defaultTrust lifecycle → install cannot succeed.
  // Keep those cells out of the matrix; they are documented as known gaps.
  if (
    r.fixture === "handle" &&
    r.pm === "nub" &&
    cmpVer(r.version, "0.8.0") < 0
  ) {
    skipped++;
    return false;
  }
  if (!inList(ONLY_FIXTURES, r.fixture)) {
    skipped++;
    return false;
  }
  if (!inList(ONLY_PMS, r.pm)) {
    skipped++;
    return false;
  }
  if (!versionMatch(ONLY_VERSIONS, r.version)) {
    skipped++;
    return false;
  }
  if (!FORCE && hasUsable(r.fixture, r.pm, r.version)) {
    skipped++;
    return false;
  }
  return true;
});

if (MAX_JOBS > 0 && include.length > MAX_JOBS) {
  // keep newest versions first within each pm×fixture (matrix.mjs already sorts)
  include = include.slice(0, MAX_JOBS);
}

const selected = include.length;
// matrix payload for GITHUB_OUTPUT must be {include:[...]} only
process.stdout.write(JSON.stringify({ include }));
// side channel for humans / GITHUB_OUTPUT selected=
console.error(
  `# plan: selected=${selected} skipped=${skipped}` +
    (FORCE ? " (FORCE)" : "") +
    (ONLY_FIXTURES.length ? ` fixtures=${ONLY_FIXTURES.join("|")}` : "") +
    (ONLY_PMS.length ? ` pms=${ONLY_PMS.join("|")}` : "")
);
// also emit machine-readable selected/skipped on stderr last line for scripts
console.error(JSON.stringify({ selected, skipped }));
