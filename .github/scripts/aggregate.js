import fs from "node:fs";
import path from "node:path";

// Read all result JSONs from a directory (default: all-results, the dir the
// aggregate CI job downloads artifacts into) and emit a Markdown table.
const dir = process.argv[2] || "all-results";
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
  .filter(Boolean);

const order = ["npm", "pnpm", "bun", "nub", "aube", "yarn"];
rows.sort((a, b) => {
  const d = order.indexOf(a.pm) - order.indexOf(b.pm);
  if (d !== 0) return d;
  return String(b.pm_version).localeCompare(String(a.pm_version)); // newest first
});

const scenKeys = ["install_cold", "install_warm", "run_noop", "run_build"];
const scenLabels = [
  "install_cold (ms)",
  "install_warm (ms)",
  "run_noop (ms)",
  "run_build (ms)",
];

// Render a {mean,stddev} (seconds) as "mean ± sd" in milliseconds, or "—".
function cell(v) {
  if (!v || typeof v.mean !== "number") return "—";
  const m = (v.mean * 1000).toFixed(1);
  const s = v.stddev != null ? ` ±${(v.stddev * 1000).toFixed(1)}` : "";
  return `${m}${s}`;
}

// Per-scenario fastest (lowest mean) for highlighting.
const best = {};
for (const k of scenKeys) {
  let b = null;
  for (const r of rows) {
    const v = r.scenarios?.[k];
    if (v && typeof v.mean === "number" && (b === null || v.mean < b)) b = v.mean;
  }
  best[k] = b;
}

let md = "# Package Manager Benchmark (hyperfine, mean ± stddev)\n\n";
md += "Numbers are milliseconds. **Lower is better.** Each cell is the mean of multiple ";
md += "hyperfine runs with the stddev shown. install_cold = no cache; install_warm = cache + ";
md += "lockfile primed; run_noop isolates the `pm run` spawn overhead; run_build is a real ";
md += "task (lodash/dayjs/semver computation + TypeScript transpile of a workspace package).\n\n";

const header = ["PM", "Version", "Node", ...scenLabels];
md += "| " + header.join(" | ") + " |\n";
md += "|" + header.map(() => "---").join("|") + "|\n";

for (const r of rows) {
  const s = r.scenarios || {};
  const cells = scenKeys.map((k) => {
    const c = cell(s[k]);
    return best[k] != null && s[k] && s[k].mean === best[k] ? `**${c}**` : c;
  });
  md += `| ${r.pm} | ${r.pm_version} | ${r.node_version} | ${cells.join(" | ")} |\n`;
}

// Per-PM version trend: did the newer version get faster or slower?
md += "\n## Version trends (newest → oldest, cold install ms)\n\n";
for (const pm of order) {
  const series = rows
    .filter((r) => r.pm === pm)
    .sort((a, b) => String(b.pm_version).localeCompare(String(a.pm_version)));
  if (series.length < 2) continue;
  const line = series
    .map((r) => `${r.pm_version}: ${cell(r.scenarios?.install_cold)}`)
    .join("  →  ");
  md += `- **${pm}**: ${line}\n`;
}

console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync("results/aggregate.json", JSON.stringify(rows, null, 2));
fs.writeFileSync("results/LAST_RESULTS.md", md);
