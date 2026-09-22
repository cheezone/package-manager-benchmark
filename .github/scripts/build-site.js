#!/usr/bin/env node
// Build the static dashboard into <out>/ from site-src/ + results/aggregate.json.
// Usage: node build-site.js [aggregate.json] [outDir]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const IN = process.argv[2] || path.join(ROOT, "results/aggregate.json");
const OUT = process.argv[3] || path.join(ROOT, "site");
const SRC = path.join(ROOT, "site-src");

if (!fs.existsSync(IN)) {
  console.error(`missing input: ${IN}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(IN, "utf8"));
function cleanVer(v) {
  const m = String(v || "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : String(v || "").trim().split(/\s+/)[0];
}
const rows = (raw.rows || raw).map((r) => ({
  fixture: "synthetic",
  ...r,
  pm_version: cleanVer(r.pm_version),
}));
const meta = raw.meta || {
  generated_at: new Date().toISOString(),
  runner: { os: "ubuntu-latest", node: rows[0]?.node_version ?? "?" },
  scenarios: [
    "install_cold",
    "install_warm",
    "install_frozen",
    "run_noop",
    "run_build",
  ],
  pm_order: ["npm", "pnpm", "bun", "nub", "aube"],
  fixtures: [...new Set(rows.map((r) => r.fixture))],
  fixture_labels: {
    synthetic: "合成 monorepo",
    handle: "antfu/handle",
    vitesse: "vitesse",
  },
};

// keep fixtures that actually have rows, in stable order
const present = new Set(rows.map((r) => r.fixture));
const prefer = ["handle", "vitesse", "synthetic"];
meta.fixtures = [
  ...prefer.filter((f) => present.has(f)),
  ...[...present].filter((f) => !prefer.includes(f)),
];
meta.fixture_labels = {
  synthetic: "合成 monorepo",
  handle: "antfu/handle",
  vitesse: "vitesse",
  ...(meta.fixture_labels || {}),
};

fs.mkdirSync(OUT, { recursive: true });
for (const f of ["index.html", "styles.css", "app.js"]) {
  fs.copyFileSync(path.join(SRC, f), path.join(OUT, f));
}
// icons + other static assets
function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
const assetsSrc = path.join(SRC, "assets");
if (fs.existsSync(assetsSrc)) copyDir(assetsSrc, path.join(OUT, "assets"));
const dataJs =
  "window.BENCH_DATA = " +
  JSON.stringify({ meta, rows }, null, 0) +
  ";\n";
fs.writeFileSync(path.join(OUT, "data.js"), dataJs);
fs.writeFileSync(
  path.join(OUT, "data.json"),
  JSON.stringify({ meta, rows }, null, 2)
);
console.log(`# wrote ${OUT}/ (${rows.length} rows, fixtures: ${meta.fixtures.join(", ")})`);
