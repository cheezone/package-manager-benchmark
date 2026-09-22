#!/usr/bin/env bash
# Prepare a benchmark fixture into work/<id> so every package manager can
# install and build it on equal footing.
#
# Usage: prepare-fixture.sh <fixture_id> [work_root]
#   fixture_id: key in fixtures/manifest.json (synthetic | handle | vitesse)
#
# Normalization (so npm/pnpm/bun/nub/aube all work):
#   - clone git fixture at a pinned SHA (or copy the local synthetic root)
#   - drop lockfiles + node_modules (including nested workspace ones)
#   - strip packageManager / packageManager pins (avoid corepack takeover)
#   - strip pnpm-only config (.npmrc shamefully-hoist, pnpm-workspace catalogs)
#   - add a root `noop` script and `workspaces` field when packages/* exists
#   - drop install-time postinstall hooks (simple-git-hooks etc.) so install
#     timing measures resolve+link, not a third-party git-hook writer
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ID="${1:?usage: prepare-fixture.sh <fixture_id> [work_root]}"
WORK_ROOT="${2:-$ROOT/work}"
DEST="$WORK_ROOT/$ID"

node -e '
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const id = process.argv[1];
const dest = process.argv[2];
const root = process.argv[3];
const man = JSON.parse(fs.readFileSync(path.join(root, "fixtures/manifest.json"), "utf8"));
const fx = man[id];
if (!fx) { console.error("unknown fixture: " + id); process.exit(2); }

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });

if (fx.type === "git") {
  console.error("# clone " + fx.url + " @ " + fx.sha.slice(0, 12));
  execFileSync("git", ["clone", "--quiet", fx.url, dest], { stdio: "inherit" });
  execFileSync("git", ["-C", dest, "checkout", "--quiet", fx.sha], { stdio: "inherit" });
  // drop .git so PMs never trip over it and copies stay cheap
  fs.rmSync(path.join(dest, ".git"), { recursive: true, force: true });
} else if (fx.type === "local") {
  // copy the synthetic fixture sources only (no caches / results / work)
  const skip = new Set([".git", "node_modules", "work", "results", "site", "dist",
    ".bun-cache", ".pnpm-store", ".yarn", "docs", "all-results"]);
  fs.cpSync(path.join(root, fx.path === "." ? "." : fx.path), dest, {
    recursive: true,
    filter: (src) => {
      const base = path.basename(src);
      if (skip.has(base)) return false;
      return true;
    },
  });
} else {
  console.error("unknown fixture type: " + fx.type);
  process.exit(2);
}

function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }

// wipe install artifacts
for (const nm of ["node_modules", "packages/core/node_modules", "packages/cli/node_modules",
                  "packages/tools/node_modules", "packages/hankit-tools/node_modules"]) {
  rmrf(path.join(dest, nm));
}
// any nested node_modules
function wipeNested(dir) {
  const nm = path.join(dir, "node_modules");
  if (fs.existsSync(nm)) rmrf(nm);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory() && e.name !== "node_modules" && !e.name.startsWith(".")) {
      wipeNested(path.join(dir, e.name));
    }
  }
}
wipeNested(dest);

for (const lf of ["package-lock.json", "pnpm-lock.yaml", "bun.lock", "bun.lockb",
                  "yarn.lock", "nub.lock", "aube-lock.yaml", "aube.lock", "npm-shrinkwrap.json"]) {
  rmrf(path.join(dest, lf));
}

// pnpm-only knobs that confuse other PMs
rmrf(path.join(dest, ".npmrc"));
rmrf(path.join(dest, ".yarnrc.yml"));
rmrf(path.join(dest, ".yarn"));

// package.json normalization
const pkgPath = path.join(dest, "package.json");
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
delete pkg.packageManager;
delete pkg.engines;
if (pkg.scripts) {
  // keep real task scripts; drop install hooks that are not install semantics
  delete pkg.scripts.postinstall;
  delete pkg.scripts.preinstall;
  delete pkg.scripts.prepare;
  delete pkg.scripts.prepublishOnly;
  pkg.scripts.noop = "node -e \"process.exit(0)\"";
}
// npm/bun need workspaces in package.json; pnpm uses pnpm-workspace.yaml
const pkgsDir = path.join(dest, "packages");
if (fs.existsSync(pkgsDir) && !pkg.workspaces) {
  pkg.workspaces = ["packages/*"];
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");

// pnpm-workspace.yaml: keep packages list only (no catalogs / onlyBuiltDependencies)
const pws = path.join(dest, "pnpm-workspace.yaml");
if (fs.existsSync(pws)) {
  fs.writeFileSync(pws, "packages:\n  - \"packages/*\"\n");
}
// vitesse had packages: [] — make pnpm treat it as a single package
if (fx.short === "vitesse") {
  fs.writeFileSync(pws, "packages:\n  - \".\"\n");
}

console.error("# prepared " + id + " -> " + dest);
console.log(dest);
' "$ID" "$DEST" "$ROOT"
