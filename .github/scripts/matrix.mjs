#!/usr/bin/env node
// Build the CI matrix from the npm registry — no hardcoded version lists.
//
// Rules:
//   - npm / nub / aube: last 5 minor-series (major.minor), latest patch each
//   - bun: last 5 minor-series (single native impl; no node/rust split)
//   - pnpm: 5 Node-impl (major < 12) + 5 Rust-impl (major >= 12) = 10 total
//   - each (pm, version) × every fixture in fixtures/manifest.json
//
// Output: one-line JSON for GITHUB_OUTPUT:
//   {"include":[{pm,pkg,version,impl,fixture}, ...]}
//
// Registry responses are cached under .cache/pm-bench/ for 6h so re-runs
// don't re-hit npm view for every PM.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CACHE_DIR = path.join(ROOT, ".cache", "pm-bench");
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const PACKAGES = {
  npm: "npm",
  pnpm: "pnpm",
  bun: "bun",
  nub: "@nubjs/nub",
  aube: "@endevco/aube",
};

// How many minor-series per implementation bucket.
const PER_IMPL = 5;

function implOf(pm, version) {
  const [maj = 0] = String(version).split(".").map(Number);
  if (pm === "pnpm") return maj >= 12 ? "rust" : "node";
  // bun is a single native (Rust/Zig) implementation across versions
  if (pm === "bun") return "rust";
  // npm / nub / aube are Node CLIs (aube has a native core but one lineage)
  return "node";
}

function cachePath(pkg) {
  return path.join(CACHE_DIR, pkg.replace("/", "__") + ".json");
}

function loadCache(pkg) {
  try {
    const raw = JSON.parse(fs.readFileSync(cachePath(pkg), "utf8"));
    if (Date.now() - raw.fetched_at < CACHE_TTL_MS && Array.isArray(raw.versions)) {
      return raw.versions;
    }
  } catch {
    /* miss */
  }
  return null;
}

function saveCache(pkg, versions) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    cachePath(pkg),
    JSON.stringify({ fetched_at: Date.now(), versions }, null, 0)
  );
}

function npmVersions(pkg) {
  const hit = loadCache(pkg);
  if (hit) {
    console.error(`# cache hit ${pkg} (${hit.length} versions)`);
    return hit;
  }
  const out = execFileSync("npm", ["view", pkg, "versions", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 60_000,
  });
  let parsed = JSON.parse(out);
  if (!Array.isArray(parsed)) parsed = [parsed];
  saveCache(pkg, parsed);
  console.error(`# fetched ${pkg} (${parsed.length} versions)`);
  return parsed;
}

function isStable(v) {
  return !/[-+]/.test(v);
}

function cmpVersion(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function cmpPatch(a, b) {
  return (+String(a).split(".")[2] || 0) - (+String(b).split(".")[2] || 0);
}

/** latest patch per major.minor, ordered oldest → newest */
function minorSeries(versions) {
  const stable = versions.filter(isStable);
  const groups = new Map();
  for (const v of stable) {
    const [maj, min] = String(v).split(".");
    const key = `${maj}.${min}`;
    const prev = groups.get(key);
    if (!prev || cmpPatch(v, prev) > 0) groups.set(key, v);
  }
  return [...groups.values()].sort(cmpVersion);
}

function pickLast(ordered, n) {
  return ordered.slice(-n);
}

function pickPerImpl(ordered, pm, n) {
  const byImpl = { node: [], rust: [] };
  for (const v of ordered) {
    const impl = implOf(pm, v);
    if (byImpl[impl]) byImpl[impl].push(v);
  }
  const out = [];
  for (const impl of ["node", "rust"]) {
    out.push(...pickLast(byImpl[impl], n).map((version) => ({ version, impl })));
  }
  return out;
}

const fixtures = Object.keys(
  JSON.parse(fs.readFileSync(path.join(ROOT, "fixtures/manifest.json"), "utf8"))
);

const include = [];
for (const [pm, pkg] of Object.entries(PACKAGES)) {
  let versions;
  try {
    versions = npmVersions(pkg);
  } catch (e) {
    console.error(`# failed to fetch versions for ${pkg}: ${e.message}`);
    continue;
  }
  const ordered = minorSeries(versions).filter((v) => {
    // aube 1.x arch-installer is incompatible with npm 12 --allow-scripts
    if (pm === "aube") return cmpVersion(v, "2.0.0") >= 0;
    return true;
  });
  const picks =
    pm === "pnpm" ? pickPerImpl(ordered, pm, PER_IMPL) : pickLast(ordered, PER_IMPL).map((version) => ({ version, impl: implOf(pm, version) }));

  for (const { version, impl } of picks) {
    for (const fixture of fixtures) {
      include.push({ pm, pkg, version, impl, fixture });
    }
  }
  console.error(
    `# ${pm}: ${picks.map((p) => `${p.version}(${p.impl})`).join(", ")} × ${fixtures.length} fixtures`
  );
}

// Stable order: fixture, pm, version desc
const pmOrder = Object.keys(PACKAGES);
include.sort((a, b) => {
  const f = fixtures.indexOf(a.fixture) - fixtures.indexOf(b.fixture);
  if (f !== 0) return f;
  const p = pmOrder.indexOf(a.pm) - pmOrder.indexOf(b.pm);
  if (p !== 0) return p;
  return cmpVersion(b.version, a.version);
});

process.stdout.write(JSON.stringify({ include }));
