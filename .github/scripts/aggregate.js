import fs from "node:fs";
import path from "node:path";

// Read all result JSONs from a directory (default: all-results, the dir the
// aggregate CI job downloads artifacts into) and emit a Markdown table plus
// a machine-readable aggregate.json for the static site.
const dir = process.argv[2] || "all-results";
fs.mkdirSync(dir, { recursive: true });

const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "aggregate.json");

const rows = files
  .map((f) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((r) => r && r.pm && r.scenarios);

const order = ["npm", "pnpm", "bun", "nub", "aube"];
rows.sort((a, b) => {
  const d = order.indexOf(a.pm) - order.indexOf(b.pm);
  if (d !== 0) return d;
  // newest first (loose string compare is fine for X.Y.Z)
  return String(b.pm_version).localeCompare(String(a.pm_version), undefined, {
    numeric: true,
  });
});

const scenKeys = [
  "install_cold",
  "install_warm",
  "install_frozen",
  "run_noop",
  "run_build",
];
const scenLabels = [
  "install_cold (ms)",
  "install_warm (ms)",
  "install_frozen (ms)",
  "run_noop (ms)",
  "run_build (ms)",
];

// Normalize schema v1 (plain number) and v2 ({mean,stddev}) to {mean,stddev}.
function norm(v) {
  if (v == null) return null;
  if (typeof v === "number") return { mean: v, stddev: 0 };
  if (typeof v.mean === "number") return v;
  return null;
}

// Render a {mean,stddev} (seconds) as "mean ± sd" in milliseconds, or "—".
function cell(v) {
  const n = norm(v);
  if (!n) return "—";
  const m = (n.mean * 1000).toFixed(1);
  const s = n.stddev ? ` ±${(n.stddev * 1000).toFixed(1)}` : "";
  return `${m}${s}`;
}

// Per-scenario fastest (lowest mean) for highlighting.
const best = {};
for (const k of scenKeys) {
  let b = null;
  for (const r of rows) {
    const v = norm(r.scenarios?.[k]);
    if (v && (b === null || v.mean < b)) b = v.mean;
  }
  best[k] = b;
}

let md = "# Package Manager Benchmark (hyperfine, mean ± stddev)\n\n";
md += "Numbers are milliseconds. **Lower is better.** Each cell is the mean of multiple ";
md += "hyperfine runs with the stddev shown.\n\n";
md += "- `install_cold` — no cache, no lockfile, no `node_modules` (full resolve + download)\n";
md += "- `install_warm` — cache + lockfile primed, `node_modules` removed (re-link from cache)\n";
md += "- `install_frozen` — lockfile + cache primed, frozen/CI install (pure restore path)\n";
md += "- `run_noop` — `pm run noop` spawn overhead\n";
md += "- `run_build` — real task (lodash/dayjs/semver + TypeScript transpile of a workspace package)\n\n";

const header = ["PM", "Version", "Node", ...scenLabels];
md += "| " + header.join(" | ") + " |\n";
md += "|" + header.map(() => "---").join("|") + "|\n";

for (const r of rows) {
  const s = r.scenarios || {};
  const cells = scenKeys.map((k) => {
    const n = norm(s[k]);
    const c = cell(s[k]);
    return best[k] != null && n && n.mean === best[k] ? `**${c}**` : c;
  });
  md += `| ${r.pm} | ${r.pm_version} | ${r.node_version} | ${cells.join(" | ")} |\n`;
}

// Per-PM version trend: did the newer version get faster or slower?
md += "\n## Version trends (newest → oldest, cold install ms)\n\n";
for (const pm of order) {
  const series = rows
    .filter((r) => r.pm === pm)
    .sort((a, b) =>
      String(b.pm_version).localeCompare(String(a.pm_version), undefined, {
        numeric: true,
      })
    );
  if (series.length < 2) continue;
  const line = series
    .map((r) => `${r.pm_version}: ${cell(r.scenarios?.install_cold)}`)
    .join("  →  ");
  md += `- **${pm}**: ${line}\n`;
}

// Meta for the site.
const meta = {
  generated_at: new Date().toISOString(),
  runner: {
    os: "ubuntu-latest (GitHub Actions)",
    node: rows[0]?.node_version ?? "unknown",
    note: "4 vCPU / 16 GB RAM, x86_64 Linux",
  },
  scenarios: scenKeys,
  pm_order: order,
  row_count: rows.length,
};

console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
fs.mkdirSync("results", { recursive: true });
// Machine-readable bundle for the static site.
fs.writeFileSync(
  "results/aggregate.json",
  JSON.stringify({ meta, rows }, null, 2)
);
fs.writeFileSync("results/LAST_RESULTS.md", md);
console.error(`# aggregated ${rows.length} rows -> results/aggregate.json`);
