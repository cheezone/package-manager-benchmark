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
const rows = (raw.rows || raw).map((r) => ({
  fixture: "synthetic",
  ...r,
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
