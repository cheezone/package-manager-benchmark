#!/usr/bin/env node
// Build the CI benchmark matrix: for each package manager, pick the last 2
// minor-series (major.minor) releases, each represented by its latest patch,
// crossed with every real-world fixture. Prereleases are skipped.
//
// Output (to stdout) is a JSON array of:
//   { pm, pkg, version, fixture }

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MANIFEST = JSON.parse(
  fs.readFileSync(path.join(ROOT, "fixtures/manifest.json"), "utf8")
);

const PACKAGES = {
  npm: "npm",
  pnpm: "pnpm",
  bun: "bun",
  nub: "@nubjs/nub",
  aube: "@endevco/aube",
};

function npmVersions(pkg) {
  const out = execFileSync("npm", ["view", pkg, "versions", "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function isStable(v) {
  return !/[-+]/.test(v);
}

function pickLast2Minor(versions) {
  const stable = versions.filter(isStable);
  const groups = new Map();
  for (const v of stable) {
    const [maj, min] = v.split(".");
    const key = `${maj}.${min}`;
    const prev = groups.get(key);
    if (!prev || cmpPatch(v, prev) > 0) groups.set(key, v);
  }
  const ordered = [...groups.values()].sort(cmpVersion);
  return ordered.slice(-2);
}

function cmpPatch(a, b) {
  return (+a.split(".")[2] || 0) - (+b.split(".")[2] || 0);
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

const fixtures = Object.keys(MANIFEST);
const matrix = [];
for (const [pm, pkg] of Object.entries(PACKAGES)) {
  let versions;
  try {
    versions = npmVersions(pkg);
  } catch (e) {
    console.error(`# failed to fetch versions for ${pkg}: ${e.message}`);
    continue;
  }
  for (const version of pickLast2Minor(versions)) {
    for (const fixture of fixtures) {
      matrix.push({ pm, pkg, version, fixture });
    }
  }
}

console.log(JSON.stringify(matrix));
