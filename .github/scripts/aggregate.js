import fs from "node:fs";
import path from "node:path";

const dir = process.argv[2] || "all-results";
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".json") && f !== "aggregate.json");

const rows = files.map((f) =>
  JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"))
);

const order = ["npm", "pnpm", "bun", "nub", "aube", "yarn"];
rows.sort((a, b) => order.indexOf(a.pm) - order.indexOf(b.pm));

const header = [
  "PM",
  "pm_version",
  "node",
  "install_cold(s)",
  "install_warm(s)",
  "run_noop(s)",
  "run_build(s)",
];

const pad = (s, n) => String(s).padEnd(n);
const num = (x) => (typeof x === "number" ? x.toFixed(3) : String(x));

let md = "# Package Manager Benchmark\n\n";
md += "Lower is better. install_cold = no cache; install_warm = cache + lockfile primed; ";
md += "run_noop isolates the `pm run` spawn overhead; run_build is a real task ";
md += "(lodash/dayjs/semver computation + TypeScript transpile of a workspace package).\n\n";

md += "| " + header.join(" | ") + " |\n";
md += "|" + header.map(() => "---").join("|") + "|\n";
for (const r of rows) {
  const s = r.scenarios;
  md +=
    `| ${pad(r.pm, 6)} ` +
    `| ${pad(r.pm_version, 12)} ` +
    `| ${pad(r.node_version, 10)} ` +
    `| ${pad(num(s.install_cold), 14)} ` +
    `| ${pad(num(s.install_warm), 14)} ` +
    `| ${pad(num(s.run_noop), 12)} ` +
    `| ${num(s.run_build)} |\n`;
}

console.log(md);

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync("results/aggregate.json", JSON.stringify(rows, null, 2));
