#!/usr/bin/env node
// One-shot normalization of vendored fixtures (run when a fixture is first
// dropped into fixtures/). After this the tree is PM-neutral:
//   - no packageManager / pnpm policy / postinstall hooks
//   - npm workspaces field if packages/* exists
//   - inter-workspace deps rewritten to workspace:* (vlt needs it; npm/bun
//     also accept it) — same idea as vlt-benchmarks/add-workspace-protocol.js
//   - pnpm.onlyBuiltDependencies allow-list so pnpm 10+ won't ERR_PNPM_IGNORED_BUILDS
//
// Usage: node scripts/normalize-fixture.js fixtures/handle

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "");
if (!root || !fs.existsSync(path.join(root, "package.json"))) {
  console.error("usage: normalize-fixture.js <fixture-dir>");
  process.exit(2);
}

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

// never keep install artifacts in the vendored tree
for (const junk of [
  "node_modules",
  ".npmrc",
  ".yarn",
  ".yarnrc.yml",
  "package-lock.json",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "yarn.lock",
  "nub.lock",
  "aube-lock.yaml",
  "aube.lock",
]) rmrf(path.join(root, junk));

// aube trustPolicy=no-downgrade rejects old fixtures (handle → rollup@3)
// that later majors have trusted publisher for. Not under test here.
fs.writeFileSync(
  path.join(root, ".npmrc"),
  [
    "trust-policy=off",
    "trustPolicy=off",
    // skip lifecycle for every PM (aube/nub also honor this)
    "ignore-scripts=true",
    "ignore_scripts=true",
    // nub/aube defaultTrust can still run "trusted" build scripts
    "defaultTrust=false",
    "default-trust=false",
    "default-trust-builds=false",
    "",
  ].join("\n")
);

// wipe nested node_modules
(function wipe(dir) {
  const nm = path.join(dir, "node_modules");
  if (fs.existsSync(nm)) rmrf(nm);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules") {
      wipe(path.join(dir, e.name));
    }
  }
})(root);

const pkgPath = path.join(root, "package.json");
const raw = fs.readFileSync(pkgPath, "utf8");
const pkg = JSON.parse(raw);
delete pkg.packageManager;
delete pkg.engines;
delete pkg.pnpm;
delete pkg.resolutions;
if (pkg.scripts) {
  delete pkg.scripts.postinstall;
  delete pkg.scripts.preinstall;
  delete pkg.scripts.prepare;
  delete pkg.scripts.prepublishOnly;
  pkg.scripts.noop = "node -e \"process.exit(0)\"";
}

const pkgsDir = path.join(root, "packages");
const hasPkgs = fs.existsSync(pkgsDir);
if (hasPkgs && !pkg.workspaces) pkg.workspaces = ["packages/*"];

// collect workspace package names
const names = new Set();
if (pkg.name) names.add(pkg.name);
if (hasPkgs) {
  for (const d of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(pkgsDir, d.name, "package.json");
    if (fs.existsSync(p)) {
      const j = JSON.parse(fs.readFileSync(p, "utf8"));
      if (j.name) names.add(j.name);
    }
  }
}

const depFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];
function rewrite(obj) {
  let hit = false;
  if (!obj) return hit;
  for (const [name, spec] of Object.entries(obj)) {
    if (names.has(name) && typeof spec === "string" && !spec.startsWith("workspace:")) {
      obj[name] = "workspace:*";
      hit = true;
    }
  }
  return hit;
}
let rewrote = rewrite(pkg) || depFields.some((f) => rewrite(pkg[f]));

if (hasPkgs) {
  for (const d of fs.readdirSync(pkgsDir, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const p = path.join(pkgsDir, d.name, "package.json");
    if (!fs.existsSync(p)) continue;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    let ch = false;
    for (const f of depFields) ch = rewrite(j[f]) || ch;
    if (ch) {
      fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
      rewrote = true;
    }
  }
}

// Do NOT put native packages in pnpm.onlyBuiltDependencies — aube/pnpm will
// then compile nodejieba/esbuild during install and blow the measurement.
// npm/pnpm/bun installs already use --ignore-scripts.
delete pkg.pnpm;

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// pnpm-workspace.yaml: packages only
const pws = path.join(root, "pnpm-workspace.yaml");
if (fs.existsSync(pws) || hasPkgs) {
  fs.writeFileSync(
    pws,
    hasPkgs ? "packages:\n  - \"packages/*\"\n" : "packages:\n  - \".\"\n"
  );
}

console.log(`normalized ${root}  names=${[...names].join(",")}  workspace:rewrote=${rewrote}`);
