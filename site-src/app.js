/* 包管理器性能对比 — MiMo 风格 */
(function () {
  const DATA = window.BENCH_DATA || { meta: {}, rows: [] };
  const meta = DATA.meta || {};
  const rows = (DATA.rows || []).map((r) => ({
    fixture: "handle",
    ...r,
    pm_version: cleanVer(r.pm_version),
  }));

  const SCEN = meta.scenarios || [
    "install_cold",
    "install_warm",
    "install_frozen",
    "run_noop",
    "run_build",
  ];
  const SCEN_CN = {
    install_cold: "冷安装",
    install_warm: "热安装",
    install_frozen: "冻结安装",
    run_noop: "脚本启动",
    run_build: "真实构建",
  };
  const PM_ORDER = meta.pm_order || ["npm", "pnpm", "bun", "nub", "aube"];
  const PM_COLOR = {
    npm: "#cb3837",
    pnpm: "#f9ad00",
    bun: "#fb923c",
    nub: "#7c3aed",
    aube: "#0d9488",
  };
  const PM_ICON = {
    npm: "assets/icons/npm-color.svg",
    pnpm: "assets/icons/pnpm-color.svg",
    bun: "assets/icons/bun-color.svg",
    nub: "assets/icons/nub.svg",
    aube: "assets/icons/aube.svg",
  };
  const IMPL_ICON = {
    rust: "assets/icons/rust-color.svg",
    node: "assets/icons/node-color.svg",
    zig: "assets/icons/zig-color.svg",
  };
  const FX_ORDER =
    meta.fixtures && meta.fixtures.length
      ? meta.fixtures
      : [...new Set(rows.map((r) => r.fixture))];
  const FX_CN = {
    handle: "antfu/handle",
    vitesse: "vitesse",
    synthetic: "合成 monorepo",
  };

  const state = {
    fixture: FX_ORDER.includes("handle") ? "handle" : FX_ORDER[0],
    scenario: "install_cold",
    allVersions: false,
  };
  let chart = null;

  function cleanVer(v) {
    const m = String(v || "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return m ? m[0] : String(v || "").trim().split(/\s+/)[0];
  }
  function implOf(pm, version) {
    const [maj = 0, min = 0] = cleanVer(version).split(".").map(Number);
    if (pm === "pnpm") return maj >= 12 ? "rust" : "node";
    if (pm === "bun") return maj > 1 || (maj === 1 && min >= 4) ? "rust" : "zig";
    return null;
  }
  function labelOf(pm, version) {
    const impl = implOf(pm, version);
    return impl ? `${pm} · ${impl}` : pm;
  }
  function iconHtml(pm) {
    const src = PM_ICON[pm];
    return src ? `<span class="pm-icon"><img src="${src}" alt="" /></span>` : "";
  }
  function implIconHtml(impl) {
    const src = IMPL_ICON[impl];
    return src
      ? `<span class="pm-icon impl-icon" title="${impl}"><img src="${src}" alt="${impl}" /></span>`
      : "";
  }
  /** 表格/图例：管理器图标 + 名称 + 语言图标（不再显示 (rust) 文字） */
  function nameHtml(pm, version) {
    const impl = implOf(pm, version);
    return iconHtml(pm) + pm + (impl ? implIconHtml(impl) : "");
  }
  function color(pm) {
    return PM_COLOR[pm] || "#26251e";
  }
  function norm(v) {
    if (v == null) return null;
    if (typeof v === "number") return { mean: v, stddev: 0 };
    if (typeof v.mean === "number") return v;
    return null;
  }
  function isOk(r, s) {
    if (r.ok && typeof r.ok[s] === "boolean") return r.ok[s];
    return norm(r.scenarios?.[s]) != null;
  }
  function msOf(r, s) {
    if (!isOk(r, s)) return null;
    const n = norm(r.scenarios?.[s]);
    return n ? n.mean * 1000 : null;
  }
  function sdOf(r, s) {
    if (!isOk(r, s)) return 0;
    const n = norm(r.scenarios?.[s]);
    return n && n.stddev ? n.stddev * 1000 : 0;
  }
  function fmtMs(m) {
    if (m == null) return "—";
    if (m >= 1000) return (m / 1000).toFixed(2) + " s";
    return m.toFixed(0) + " ms";
  }
  function cmpVer(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function rowsInFx(fx) {
    return rows.filter((r) => r.fixture === fx);
  }
  function latestPerPm(fx) {
    const map = new Map();
    for (const r of rowsInFx(fx)) {
      const key = r.pm + "|" + (implOf(r.pm, r.pm_version) || "");
      const prev = map.get(key);
      if (!prev || cmpVer(r.pm_version, prev.pm_version) > 0) map.set(key, r);
    }
    return map;
  }
  function chartRows() {
    const src = state.allVersions
      ? rowsInFx(state.fixture)
      : [...latestPerPm(state.fixture).values()];
    return src
      .map((r) => ({
        pm: r.pm,
        version: r.pm_version,
        label: labelOf(r.pm, r.pm_version),
        mean: msOf(r, state.scenario),
        sd: sdOf(r, state.scenario),
        ok: isOk(r, state.scenario),
      }))
      .filter((d) => d.mean != null && d.ok)
      .sort((a, b) => a.mean - b.mean);
  }

  function renderSegs() {
    const fx = document.getElementById("fixture-seg");
    fx.innerHTML = FX_ORDER.map(
      (f) =>
        `<button type="button" data-fixture="${f}" aria-pressed="${
          f === state.fixture
        }">${FX_CN[f] || f}</button>`
    ).join("");
    fx.onclick = (e) => {
      const b = e.target.closest("button[data-fixture]");
      if (!b) return;
      state.fixture = b.dataset.fixture;
      render();
    };

    const sc = document.getElementById("scenario-seg");
    sc.innerHTML = SCEN.map(
      (s) =>
        `<button type="button" data-scenario="${s}" aria-pressed="${
          s === state.scenario
        }">${SCEN_CN[s] || s}</button>`
    ).join("");
    sc.onclick = (e) => {
      const b = e.target.closest("button[data-scenario]");
      if (!b) return;
      state.scenario = b.dataset.scenario;
      render();
    };

    const all = document.getElementById("all-versions");
    all.checked = state.allVersions;
    all.onchange = () => {
      state.allVersions = all.checked;
      render();
    };
  }

  function renderLegend() {
    const data = chartRows();
    const seen = new Set();
    const items = [];
    for (const d of data) {
      if (seen.has(d.pm)) continue;
      seen.add(d.pm);
      items.push(`<span class="legend-item">${iconHtml(d.pm)}${d.pm}</span>`);
    }
    document.getElementById("pm-legend").innerHTML = items.join("");
  }

  function renderChart() {
    const data = chartRows();
    document.getElementById("chart-title").textContent =
      `${SCEN_CN[state.scenario] || state.scenario} · ${FX_CN[state.fixture] || state.fixture}`;
    document.getElementById("chart-meta").textContent = data.length
      ? (state.allVersions ? "全部版本 · " : "各实现最新版 · ") + data.length + " 条"
      : "无有效数据";

    const el = document.getElementById("chart");
    if (!chart) chart = echarts.init(el, null, { renderer: "canvas" });

    const view = data.slice().reverse();
    // y 轴：用 rich 图标代替 (rust)/(zig) 文字
    const rich = {};
    const names = view.map((d, i) => {
      const impl = implOf(d.pm, d.version);
      rich["pm" + i] = {
        width: 18,
        height: 18,
        backgroundColor: { image: PM_ICON[d.pm] || "" },
        borderRadius: 3,
      };
      if (impl && IMPL_ICON[impl]) {
        rich["im" + i] = {
          width: 14,
          height: 14,
          backgroundColor: { image: IMPL_ICON[impl] },
        };
        return state.allVersions
          ? `{pm${i}|} ${d.pm} {im${i}|} ${d.version}`
          : `{pm${i}|} ${d.pm} {im${i}|}`;
      }
      return state.allVersions
        ? `{pm${i}|} ${d.pm} ${d.version}`
        : `{pm${i}|} ${d.pm}`;
    });
    const values = view.map((d) => +d.mean.toFixed(1));
    const colors = view.map((d) => color(d.pm));

    chart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 8, right: 80, top: 12, bottom: 16, containLabel: true },
        tooltip: {
          trigger: "item",
          backgroundColor: "#fff",
          borderColor: "#e5e2e0",
          textStyle: { color: "#26251e", fontSize: 12, fontFamily: "MiSans, sans-serif" },
          formatter: (p) => {
            const d = view[p.dataIndex];
            if (!d) return "";
            return `<b>${d.pm}</b> ${d.version}<br/>${fmtMs(d.mean)}${
              d.sd ? ` ± ${fmtMs(d.sd)}` : ""
            }`;
          },
        },
        xAxis: {
          type: "value",
          axisLabel: {
            formatter: (v) => (v >= 1000 ? v / 1000 + "s" : v + "ms"),
            color: "#979696",
            fontSize: 11,
          },
          splitLine: { lineStyle: { color: "#ede9e7" } },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        yAxis: {
          type: "category",
          data: names,
          axisLabel: {
            color: "#26251e",
            fontSize: 13,
            rich,
            // 数据里已是 {pm0|} 富文本
            formatter: (v) => v,
          },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            data: values.map((v, i) => ({
              value: v,
              itemStyle: { color: colors[i], borderRadius: [0, 6, 6, 0] },
            })),
            barWidth: 18,
            showBackground: true,
            backgroundStyle: { color: "#f5f0eb", borderRadius: 6 },
            label: {
              show: true,
              position: "right",
              formatter: (p) => fmtMs(view[p.dataIndex]?.mean),
              color: "#504f49",
              fontSize: 12,
            },
          },
        ],
      },
      true
    );
    chart.resize();
  }

  function renderTable() {
    const src = rowsInFx(state.fixture).slice();
    const latest = latestPerPm(state.fixture);
    const show = state.allVersions
      ? src
      : src.filter((r) => {
          const key = r.pm + "|" + (implOf(r.pm, r.pm_version) || "");
          return latest.get(key) === r;
        });

    // best per scenario across visible rows
    const best = {};
    for (const s of SCEN) {
      let b = null;
      for (const r of show) {
        const m = msOf(r, s);
        if (m != null && (b === null || m < b)) b = m;
      }
      best[s] = b;
    }

    // group by PM (stable PM_ORDER), versions newest first
    const groups = PM_ORDER.map((pm) => ({
      pm,
      rows: show
        .filter((r) => r.pm === pm)
        .sort((a, b) => cmpVer(b.pm_version, a.pm_version)),
    })).filter((g) => g.rows.length);

    const scenHead = SCEN.map((s) => `<th class="num">${SCEN_CN[s] || s}</th>`).join("");
    const body = groups
      .map((g) => {
        const rowsHtml = g.rows
          .map((r) => {
            const key = r.pm + "|" + (implOf(r.pm, r.pm_version) || "");
            const isLatest = latest.get(key) === r;
            const tds = SCEN.map((s) => {
              if (!isOk(r, s)) return `<td class="num fail">失败</td>`;
              const m = msOf(r, s);
              if (m == null) return `<td class="num">—</td>`;
              const cls = best[s] === m ? "num best" : "num";
              return `<td class="${cls}">${fmtMs(m)}</td>`;
            }).join("");
            const impl = implOf(r.pm, r.pm_version);
            return `<tr class="${isLatest ? "is-latest" : "is-old"}">
              <td class="ver">${r.pm_version}</td>
              <td class="impl">${impl ? implIconHtml(impl) : ""}</td>
              ${tds}
            </tr>`;
          })
          .join("");
        // group header: PM once, rowspan not needed — use a section row
        return `<tr class="pm-group"><td colspan="${
          2 + SCEN.length
        }"><span class="pm-cell">${iconHtml(g.pm)}<span class="pm-name">${
          g.pm
        }</span><span class="pm-count">${g.rows.length} 个版本</span></span></td></tr>${rowsHtml}`;
      })
      .join("");

    document.getElementById("table-wrap").innerHTML = `<table class="data-table">
      <thead><tr>
        <th>版本</th>
        <th>实现</th>
        ${scenHead}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderFoot() {
    const t = (meta.generated_at || "").replace("T", " ").slice(0, 19);
    document.getElementById("foot").innerHTML =
      `${t ? t + " UTC · " : ""}Node LTS · ${rows.length} 条 · ` +
      `<a href="https://github.com/cheezone/package-manager-benchmark">源码</a>`;
  }

  function render() {
    renderSegs();
    renderLegend();
    renderChart();
    renderTable();
    renderFoot();
  }

  window.addEventListener("resize", () => chart && chart.resize());
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
