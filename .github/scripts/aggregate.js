import fs from "node:fs";
import path from "node:path";

// Read all result JSONs from a directory (default: all-results) and emit a
// Markdown table plus a machine-readable aggregate.json for the static site.
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
  .filter((r) => r && r.pm && r.scenarios)
  .map((r) => ({
    ...r,
    fixture: r.fixture || "synthetic",
  }));

const order = ["npm", "pnpm", "bun", "nub", "aube"];
const fixtureOrder = ["handle", "vitesse"];
rows.sort((a, b) => {
  const fd =
    (fixtureOrder.indexOf(a.fixture) + 99) % 99 -
    ((fixtureOrder.indexOf(b.fixture) + 99) % 99);
  if (fd !== 0 && fixtureOrder.includes(a.fixture) && fixtureOrder.includes(b.fixture)) {
    return fixtureOrder.indexOf(a.fixture) - fixtureOrder.indexOf(b.fixture);
  }
  const d = order.indexOf(a.pm) - order.indexOf(b.pm);
  if (d !== 0) return d;
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
const scenLabels = {
  install_cold: "install_cold (ms)",
  install_warm: "install_warm (ms)",
  install_frozen: "install_frozen (ms)",
  run_noop: "run_noop (ms)",
  run_build: "run_build (ms)",
};

function norm(v) {
  if (v == null) return null;
  if (typeof v === "number") return { mean: v, stddev: 0 };
  if (typeof v.mean === "number") return v;
  return null;
}

function cell(v) {
  const n = norm(v);
  if (!n) return "—";
  const m = (n.mean * 1000).toFixed(1);
  const s = n.stddev ? ` ±${(n.stddev * 1000).toFixed(1)}` : "";
  return `${m}${s}`;
}

// Fixture labels for markdown
const fxLabel = {
  handle: "antfu/handle",
  vitesse: "antfu-collective/vitesse",
};

let md = "# Package Manager Benchmark (hyperfine, mean ± stddev)\n\n";
md += "Numbers are milliseconds. **Lower is better.**\n\n";
md += "Fixtures: `synthetic` (内置 monorepo) · `handle` (antfu/handle) · `vitesse` (antfu-collective/vitesse @ pre-catalog).\n\n";
md += "- `install_cold` — no cache, no lockfile, no `node_modules`\n";
md += "- `install_warm` — cache + lockfile primed, `node_modules` removed\n";
md += "- `install_frozen` — frozen/CI install (`npm ci` / `--frozen-lockfile`)\n";
md += "- `run_noop` — `pm run noop` spawn overhead\n";
md += "- `run_build` — fixture's real `build` script\n\n";

const fixtures = [...new Set(rows.map((r) => r.fixture))];
for (const fx of fixtures) {
  const fxRows = rows.filter((r) => r.fixture === fx);
  md += `\n## Fixture: ${fxLabel[fx] || fx}\n\n`;

  const best = {};
  for (const k of scenKeys) {
    let b = null;
    for (const r of fxRows) {
      const v = norm(r.scenarios?.[k]);
      if (v && (b === null || v.mean < b)) b = v.mean;
    }
    best[k] = b;
  }

  const header = ["PM", "Version", "Node", ...scenKeys.map((k) => scenLabels[k])];
  md += "| " + header.join(" | ") + " |\n";
  md += "|" + header.map(() => "---").join("|") + "|\n";
  for (const r of fxRows) {
    const s = r.scenarios || {};
    const cells = scenKeys.map((k) => {
      const n = norm(s[k]);
      const c = cell(s[k]);
      return best[k] != null && n && n.mean === best[k] ? `**${c}**` : c;
    });
    md += `| ${r.pm} | ${r.pm_version} | ${r.node_version} | ${cells.join(" | ")} |\n`;
  }
}

md += "\n## Version trends (newest → oldest, cold install ms)\n\n";
for (const fx of fixtures) {
  for (const pm of order) {
    const series = rows
      .filter((r) => r.pm === pm && r.fixture === fx)
      .sort((a, b) =>
        String(b.pm_version).localeCompare(String(a.pm_version), undefined, {
          numeric: true,
        })
      );
    if (series.length < 2) continue;
    const line = series
      .map((r) => `${r.pm_version}: ${cell(r.scenarios?.install_cold)}`)
      .join("  →  ");
    md += `- **${pm}** / ${fx}: ${line}\n`;
  }
}

const meta = {
  generated_at: new Date().toISOString(),
  runner: {
    os: "ubuntu-latest (GitHub Actions)",
    node: rows[0]?.node_version ?? "unknown",
    note: "4 vCPU / 16 GB RAM, x86_64 Linux",
  },
  scenarios: scenKeys,
  pm_order: order,
  fixtures: fixtureOrder.filter((f) => fixtures.includes(f)),
  fixture_labels: fxLabel,
  row_count: rows.length,
};

console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(
  "results/aggregate.json",
  JSON.stringify({ meta, rows }, null, 2)
);
fs.writeFileSync("results/LAST_RESULTS.md", md);
console.error(`# aggregated ${rows.length} rows -> results/aggregate.json`);
