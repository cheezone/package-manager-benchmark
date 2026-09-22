#!/usr/bin/env node
// Build a self-contained static dashboard (site/) from results/aggregate.json.
// No CDN, no build step — one HTML file with inline SVG charts.

import fs from "node:fs";
import path from "node:path";

const IN = process.argv[2] || "results/aggregate.json";
const OUT = process.argv[3] || "site";

if (!fs.existsSync(IN)) {
  console.error(`missing input: ${IN}`);
  process.exit(1);
}

const bundle = JSON.parse(fs.readFileSync(IN, "utf8"));
const rows = bundle.rows || bundle; // accept bare array too
const meta = bundle.meta || {
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
};

const SCEN = meta.scenarios;
const SCEN_LABEL = {
  install_cold: "冷安装",
  install_warm: "热安装",
  install_frozen: "冻结安装 (CI)",
  run_noop: "脚本启动",
  run_build: "真实构建",
};
const SCEN_DESC = {
  install_cold: "无缓存 · 无 lockfile · 无 node_modules：完整解析 + 下载",
  install_warm: "缓存与 lockfile 就绪 · 删 node_modules：从缓存重链",
  install_frozen: "lockfile + 缓存就绪 · 冻结安装：CI 还原路径",
  run_noop: "`pm run noop`：仅测包管理器 spawn 开销",
  run_build: "lodash/dayjs/semver 计算 + TypeScript 转译 workspace 包",
};

const PM_COLORS = {
  npm: "#CB3837",
  pnpm: "#F9AD00",
  bun: "#FBF0DF",
  nub: "#7C3AED",
  aube: "#0D9488",
};
// bun's brand is light — use a readable fill for charts
PM_COLORS.bun = "#C2410C";

function norm(v) {
  if (v == null) return null;
  if (typeof v === "number") return { mean: v, stddev: 0 };
  if (typeof v.mean === "number") return v;
  return null;
}
function ms(v) {
  const n = norm(v);
  return n ? n.mean * 1000 : null;
}
function sdMs(v) {
  const n = norm(v);
  return n && n.stddev ? n.stddev * 1000 : 0;
}
function fmtMs(v) {
  const m = ms(v);
  if (m == null) return "—";
  if (m >= 10000) return (m / 1000).toFixed(2) + " s";
  if (m >= 1000) return (m / 1000).toFixed(2) + " s";
  return m.toFixed(1) + " ms";
}
function fmtCell(v) {
  const m = ms(v);
  if (m == null) return "—";
  const s = sdMs(v);
  const mean =
    m >= 1000 ? (m / 1000).toFixed(2) + " s" : m.toFixed(1) + " ms";
  return s ? `${mean} ±${s.toFixed(1)}` : mean;
}

// Prefer "latest" version per PM for the overview bars (highest semver-ish).
function latestPerPm(list) {
  const map = new Map();
  for (const r of list) {
    const prev = map.get(r.pm);
    if (
      !prev ||
      String(r.pm_version).localeCompare(String(prev.pm_version), undefined, {
        numeric: true,
      }) > 0
    ) {
      map.set(r.pm, r);
    }
  }
  return map;
}

const latest = latestPerPm(rows);
const pmOrder = (meta.pm_order || ["npm", "pnpm", "bun", "nub", "aube"]).filter(
  (p) => latest.has(p)
);

// ---------- SVG bar chart with error whiskers ----------
function barChart(scenario) {
  const data = pmOrder
    .map((pm) => {
      const r = latest.get(pm);
      const v = r?.scenarios?.[scenario];
      return { pm, version: r.pm_version, mean: ms(v), sd: sdMs(v) };
    })
    .filter((d) => d.mean != null)
    .sort((a, b) => a.mean - b.mean);

  if (!data.length) return "<p class='muted'>暂无数据</p>";

  const max = Math.max(...data.map((d) => d.mean + d.sd), 1);
  const rowH = 36;
  const padL = 88;
  const padR = 72;
  const w = 640;
  const h = data.length * rowH + 16;
  const plotW = w - padL - padR;

  const bars = data
    .map((d, i) => {
      const y = i * rowH + 8;
      const bw = Math.max(2, (d.mean / max) * plotW);
      const sw = (d.sd / max) * plotW;
      const color = PM_COLORS[d.pm] || "#1D4ED8";
      const label = `${d.pm}`;
      const ver = d.version;
      return `
      <g>
        <text x="${padL - 10}" y="${y + 18}" text-anchor="end" class="bar-label">${esc(label)}</text>
        <text x="${padL - 10}" y="${y + 30}" text-anchor="end" class="bar-ver">${esc(ver)}</text>
        <rect x="${padL}" y="${y + 8}" width="${bw}" height="16" rx="3" fill="${color}" opacity="0.9"/>
        ${
          sw > 0.5
            ? `<line x1="${padL + Math.max(0, bw - sw)}" y1="${y + 16}" x2="${padL + Math.min(plotW, bw + sw)}" y2="${y + 16}" stroke="#141414" stroke-width="1.2" opacity="0.55"/>
               <line x1="${padL + Math.max(0, bw - sw)}" y1="${y + 11}" x2="${padL + Math.max(0, bw - sw)}" y2="${y + 21}" stroke="#141414" stroke-width="1.2" opacity="0.55"/>
               <line x1="${padL + Math.min(plotW, bw + sw)}" y1="${y + 11}" x2="${padL + Math.min(plotW, bw + sw)}" y2="${y + 21}" stroke="#141414" stroke-width="1.2" opacity="0.55"/>`
            : ""
        }
        <text x="${padL + bw + 8}" y="${y + 18}" class="bar-val">${esc(fmtMs({ mean: d.mean / 1000, stddev: d.sd / 1000 }))}</text>
      </g>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="${esc(SCEN_LABEL[scenario] || scenario)} 对比">${bars}</svg>`;
}

// ---------- Version trend slope lines ----------
function trendChart() {
  const groups = new Map();
  for (const r of rows) {
    if (!groups.has(r.pm)) groups.set(r.pm, []);
    groups.get(r.pm).push(r);
  }

  const series = [];
  for (const pm of pmOrder) {
    const list = (groups.get(pm) || [])
      .slice()
      .sort((a, b) =>
        String(a.pm_version).localeCompare(String(b.pm_version), undefined, {
          numeric: true,
        })
      );
    if (list.length < 2) continue;
    series.push({
      pm,
      points: list.map((r) => ({
        v: r.pm_version,
        cold: ms(r.scenarios?.install_cold),
      })),
    });
  }
  if (!series.length) return "<p class='muted'>版本序列不足，无法画趋势</p>";

  const maxLen = Math.max(...series.map((s) => s.points.length));
  const allCold = series.flatMap((s) => s.points.map((p) => p.cold)).filter((x) => x != null);
  const maxV = Math.max(...allCold, 1);
  const w = 640;
  const h = 220;
  const padL = 48;
  const padR = 96;
  const padT = 16;
  const padB = 36;
  const plotW = w - padL - padR;
  const plotH = h - padT - padB;

  const xAt = (i) => padL + (maxLen === 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
  const yAt = (v) => padT + plotH - (v / maxV) * plotH;

  // x labels (version indices)
  const xLabels = Array.from({ length: maxLen }, (_, i) => {
    return `<text x="${xAt(i)}" y="${h - 12}" text-anchor="middle" class="bar-ver">v${i + 1}</text>`;
  }).join("");

  const lines = series
    .map((s) => {
      const color = PM_COLORS[s.pm] || "#1D4ED8";
      const pts = s.points
        .map((p, i) => `${xAt(i)},${yAt(p.cold || 0)}`)
        .join(" ");
      const dots = s.points
        .map(
          (p, i) =>
            `<circle cx="${xAt(i)}" cy="${yAt(p.cold || 0)}" r="3.5" fill="${color}"/>`
        )
        .join("");
      const last = s.points[s.points.length - 1];
      const lx = xAt(s.points.length - 1);
      const ly = yAt(last.cold || 0);
      return `<polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/>${dots}
        <text x="${lx + 10}" y="${ly + 4}" class="bar-label" fill="${color}">${esc(s.pm)}</text>`;
    })
    .join("");

  return `<svg viewBox="0 0 ${w} ${h}" class="chart" role="img" aria-label="冷安装版本趋势">
    <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${padT + plotH}" stroke="#E5E2DC" stroke-width="1"/>
    <line x1="${padL}" y1="${padT + plotH}" x2="${padL + plotW}" y2="${padT + plotH}" stroke="#E5E2DC" stroke-width="1"/>
    ${lines}${xLabels}
    <text x="${padL}" y="${padT + 10}" class="bar-ver">越低越快 · 冷安装</text>
  </svg>`;
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- Full table ----------
function table() {
  const head = ["PM", "版本", "Node", ...SCEN.map((s) => SCEN_LABEL[s] || s)];
  const body = rows
    .map((r) => {
      const tds = SCEN.map((s) => `<td class="num">${esc(fmtCell(r.scenarios?.[s]))}</td>`).join("");
      const color = PM_COLORS[r.pm] || "#1D4ED8";
      return `<tr>
        <td><span class="dot" style="background:${color}"></span>${esc(r.pm)}</td>
        <td class="mono">${esc(r.pm_version)}</td>
        <td class="mono">${esc(r.node_version)}</td>
        ${tds}
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table>
    <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
}

function legend() {
  return pmOrder
    .map((pm) => {
      const color = PM_COLORS[pm] || "#1D4ED8";
      return `<span class="leg"><span class="dot" style="background:${color}"></span>${esc(pm)}</span>`;
    })
    .join("");
}

const generated = meta.generated_at || new Date().toISOString();
const runner = meta.runner || {};
const scenarioCards = SCEN.map((s) => {
  return `<section class="card">
    <h3>${esc(SCEN_LABEL[s] || s)}</h3>
    <p class="muted small">${esc(SCEN_DESC[s] || "")}</p>
    ${barChart(s)}
  </section>`;
}).join("");

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Package Manager Benchmark</title>
<meta name="description" content="npm / pnpm / bun / nub / aube 在统一 monorepo 夹具上的可信性能对比（hyperfine 多次采样）。"/>
<style>
  :root {
    --paper: #F7F6F3;
    --ink: #141414;
    --muted: #6B6B6B;
    --rule: #E5E2DC;
    --card: #FFFFFF;
    --accent: #1D4ED8;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font: 15px/1.65 ui-sans-serif, "SF Pro Text", "Segoe UI", system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
    font-variant-numeric: tabular-nums;
  }
  .wrap { max-width: 920px; margin: 0 auto; padding: 48px 24px 80px; }
  header h1 {
    font-size: 32px; line-height: 1.2; letter-spacing: -0.02em;
    margin: 0 0 8px; font-weight: 650;
  }
  header .sub { color: var(--muted); margin: 0 0 28px; max-width: 62ch; }
  .meta {
    display: flex; flex-wrap: wrap; gap: 8px 20px;
    font-size: 12px; color: var(--muted);
    border-top: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
    padding: 12px 0; margin-bottom: 36px;
  }
  .meta b { color: var(--ink); font-weight: 600; }
  h2 {
    font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase;
    color: var(--muted); font-weight: 600; margin: 40px 0 12px;
  }
  h3 { font-size: 16px; margin: 0 0 4px; font-weight: 650; letter-spacing: -0.01em; }
  .card {
    background: var(--card); border: 1px solid var(--rule); border-radius: 10px;
    padding: 18px 18px 12px; margin-bottom: 16px;
  }
  .muted { color: var(--muted); }
  .small { font-size: 13px; margin: 0 0 10px; }
  .chart { width: 100%; height: auto; display: block; margin-top: 8px; }
  .bar-label { font-size: 12px; fill: var(--ink); font-family: ui-sans-serif, system-ui, sans-serif; }
  .bar-ver { font-size: 10px; fill: var(--muted); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .bar-val { font-size: 11px; fill: var(--ink); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
  .table-wrap { overflow-x: auto; background: var(--card); border: 1px solid var(--rule); border-radius: 10px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { padding: 10px 12px; text-align: left; border-bottom: 1px solid var(--rule); white-space: nowrap; }
  th { font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); font-weight: 600; background: #FBFAF8; }
  tr:last-child td { border-bottom: 0; }
  td.num, th:not(:first-child):not(:nth-child(2)):not(:nth-child(3)) { font-variant-numeric: tabular-nums; }
  .mono { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 12px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 8px; vertical-align: 1px; }
  .leg { display: inline-flex; align-items: center; margin-right: 14px; font-size: 13px; }
  .legend { margin: 8px 0 20px; }
  .method {
    background: var(--card); border: 1px solid var(--rule); border-radius: 10px;
    padding: 18px 20px; font-size: 14px;
  }
  .method ul { margin: 8px 0 0; padding-left: 1.2em; }
  .method li { margin: 4px 0; }
  footer {
    margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--rule);
    font-size: 12px; color: var(--muted);
  }
  footer a { color: var(--accent); text-decoration: none; }
  .pill {
    display: inline-block; font-size: 11px; letter-spacing: 0.04em;
    border: 1px solid var(--rule); border-radius: 999px; padding: 2px 8px;
    color: var(--muted); margin-left: 8px; vertical-align: 2px;
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Package Manager Benchmark<span class="pill">v2</span></h1>
    <p class="sub">
      在<strong>同一 monorepo 夹具</strong>上，用 <strong>hyperfine 多次采样</strong>对比
      npm / pnpm / bun / nub / aube 的安装与脚本执行性能。
      不是厂商营销页——每个数字都带标准差。
    </p>
    <div class="meta">
      <span>生成时间 <b>${esc(generated)}</b></span>
      <span>运行环境 <b>${esc(runner.os || "GitHub Actions ubuntu-latest")}</b></span>
      <span>Node <b>${esc(runner.node || "?")}</b></span>
      <span>样本 <b>${rows.length}</b> 组</span>
    </div>
  </header>

  <h2>各场景对比 · 每个 PM 取最新版本</h2>
  <div class="legend">${legend()}</div>
  ${scenarioCards}

  <h2>冷安装 · 版本趋势</h2>
  <div class="card">
    <p class="small muted">同一 PM 最近若干 minor 系列，点越低越快。用于回答「新版本真的变快了吗」。</p>
    ${trendChart()}
  </div>

  <h2>完整数据</h2>
  ${table()}

  <h2>方法与公平性</h2>
  <div class="method">
    <p style="margin:0">夹具是一个 npm/pnpm 风格 monorepo（<code>@app/core</code> + <code>@app/cli</code> + 根依赖 lodash / chalk / dayjs / typescript 等）。所有包管理器解析同一棵依赖树。</p>
    <ul>
      <li><strong>多次采样</strong>：hyperfine 取 mean ± stddev，不是单次 <code>date</code> 计时。</li>
      <li><strong>可控缓存</strong>：冷安装前清空该 PM 的缓存与 lockfile；热安装保留缓存与 lockfile。</li>
      <li><strong>冻结安装</strong>：对应日常 CI 的 <code>--frozen-lockfile</code> / <code>npm ci</code> 路径。</li>
      <li><strong>脚本开销</strong>：<code>run_noop</code> 用空脚本隔离 <code>pm run</code> 的 spawn 成本。</li>
      <li><strong>真实构建</strong>：<code>run_build</code> 做 lodash/dayjs/semver 计算并 TypeScript 转译 workspace 包。</li>
      <li><strong>版本矩阵</strong>：每个 PM 取最近 3 个 minor 系列（各系列最新 patch），可看版本趋势。</li>
      <li><strong>不含 yarn</strong>：本轮对比聚焦 npm / pnpm / bun / nub / aube。</li>
    </ul>
  </div>

  <footer>
    源码与复现方法见
    <a href="https://github.com/cheezone/package-manager-benchmark">cheezone/package-manager-benchmark</a>
    · 数值越低越好 · 本地结果会因网络/文件系统与 CI 不同，以本站 CI 数据为准。
  </footer>
</div>
</body>
</html>
`;

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "index.html"), html);
fs.writeFileSync(
  path.join(OUT, "data.json"),
  JSON.stringify({ meta, rows }, null, 2)
);
console.log(`# wrote ${OUT}/index.html (${rows.length} rows)`);
