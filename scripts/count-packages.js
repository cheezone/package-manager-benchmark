#!/usr/bin/env node
// Count unique installed package names under node_modules (vlt-benchmarks style).
// Matches node_modules/<name>/package.json and node_modules/@scope/<name>/package.json
// at any nesting level, then unique-counts the name (or @scope/name).
// Prints a single integer (0 if nothing installed).
//
// Usage: node count-packages.js [cwd]

import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(process.argv[2] || process.cwd());
const nm = path.join(root, "node_modules");

try {
  const findCmd = `find -L ${JSON.stringify(
    nm
  )} -name package.json -type f 2>/dev/null | grep -E 'node_modules/([a-zA-Z0-9._-]+)/package\\.json$|node_modules/@[a-zA-Z0-9._-]+/[a-zA-Z0-9._-]+/package\\.json$' | sed 's|.*node_modules/||; s|/package\\.json$||' | sort -u | wc -l`;
  const out = execSync(findCmd, { encoding: "utf8", shell: "/bin/bash" }).trim();
  console.log(String(parseInt(out, 10) || 0));
} catch {
  console.log("0");
}
