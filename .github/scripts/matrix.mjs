#!/usr/bin/env node
// Build the CI benchmark matrix: for each package manager, pick the last 3
// minor-series (major.minor) releases, each represented by its latest patch.
// Prereleases (anything with a dash, e.g. 1.0.0-rc.1) are skipped.
//
// Output (to stdout) is a JSON array of:
//   { pm, pkg, version }
// which the GitHub Actions setup job forwards as a fromJson matrix.

import { execFileSync } from "node:child_process";

const PACKAGES = {
  npm: "npm",
  pnpm: "pnpm",
  bun: "bun",
  nub: "@nubjs/nub",
  aube: "@endevco/aube",
  yarn: "yarn",
};

function npmVersions(pkg) {
  const out = execFileSync("npm", ["view", pkg, "versions", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function isStable(v) {
  return !/[-+]/.test(v); // drop prereleases / build metadata
}

function pickLast3Minor(versions) {
  const stable = versions.filter(isStable);
  // latest patch per major.minor group
  const groups = new Map();
  for (const v of stable) {
    const [maj, min] = v.split(".");
    const key = `${maj}.${min}`;
    const prev = groups.get(key);
    // keep the highest patch within the group
    if (!prev || cmpPatch(v, prev) > 0) groups.set(key, v);
  }
  const ordered = [...groups.values()].sort(cmpVersion);
  return ordered.slice(-3);
}

function cmpPatch(a, b) {
  const pa = +a.split(".")[2] || 0;
  const pb = +b.split(".")[2] || 0;
  return pa - pb;
}

function cmpVersion(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

const matrix = [];
for (const [pm, pkg] of Object.entries(PACKAGES)) {
  let versions;
  try {
    versions = npmVersions(pkg);
  } catch (e) {
    console.error(`# failed to fetch versions for ${pkg}: ${e.message}`);
    continue;
  }
  const picks = pickLast3Minor(versions);
  for (const version of picks) {
    matrix.push({ pm, pkg, version });
  }
}

// Compact single-line JSON so it can be safely set as a GitHub Actions
// job output (multi-line outputs are cumbersome to quote).
console.log(JSON.stringify(matrix));
