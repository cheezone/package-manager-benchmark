/* 包管理器性能对比 — ECharts 浅色 */
(function () {
  const DATA = window.BENCH_DATA || { meta: {}, rows: [] };
  const meta = DATA.meta || {};
  function cleanVer(v) {
    const m = String(v || "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
    return m ? m[0] : String(v || "").trim().split(/\s+/)[0];
  }
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
  ];
  const SCEN_CN = {
    install_cold: "冷安装",
    install_warm: "热安装",
    install_frozen: "冻结安装",
    run_noop: "脚本启动",
  };
  const PM_ORDER = meta.pm_order || ["npm", "pnpm", "bun", "nub", "aube"];
  const PM_COLOR = {
    npm: "#cb3837",
    pnpm: "#f9ad00",
    bun: "#fb923c",
    nub: "#7c3aed",
    aube: "#0d9488",
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
  function color(pm) {
    return PM_COLOR[pm] || "#2563eb";
  }

  function rowsInFx(fx) {
    return rows.filter((r) => r.fixture === fx);
  }
  function latestPerPm(fx) {
    const map = new Map();
    for (const r of rowsInFx(fx)) {
      const prev = map.get(r.pm);
      if (!prev || cmpVer(r.pm_version, prev.pm_version) > 0) map.set(r.pm, r);
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

  function renderChart() {
    const data = chartRows();
    document.getElementById("chart-title").textContent =
      `${SCEN_CN[state.scenario] || state.scenario} · ${FX_CN[state.fixture] || state.fixture}`;
    document.getElementById("chart-meta").textContent = data.length
      ? (state.allVersions ? "全部版本 · " : "最新版 · ") + data.length + " 条"
      : "无有效数据";

    const el = document.getElementById("chart");
    if (!chart) chart = echarts.init(el, null, { renderer: "canvas" });

    const view = data.slice().reverse();
    const names = view.map((d) =>
      state.allVersions ? `${d.pm} ${d.version}` : d.pm
    );
    const values = view.map((d) => +d.mean.toFixed(1));
    const colors = view.map((d) => color(d.pm));

    chart.setOption(
      {
        backgroundColor: "transparent",
        grid: { left: 8, right: 72, top: 16, bottom: 24, containLabel: true },
        tooltip: {
          trigger: "item",
          formatter: (p) => {
            const d = view[p.dataIndex];
            if (!d) return "";
            return `${d.pm} ${d.version}<br/>${fmtMs(d.mean)}${
              d.sd ? ` ± ${fmtMs(d.sd)}` : ""
            }`;
          },
        },
        xAxis: {
          type: "value",
          axisLabel: {
            formatter: (v) => (v >= 1000 ? v / 1000 + "s" : v + "ms"),
            color: "#6b7280",
            fontSize: 11,
          },
          splitLine: { lineStyle: { color: "#eef0f3" } },
        },
        yAxis: {
          type: "category",
          data: names,
          axisLabel: { color: "#1f2328", fontSize: 12 },
          axisLine: { show: false },
          axisTick: { show: false },
        },
        series: [
          {
            type: "bar",
            data: values.map((v, i) => ({
              value: v,
              itemStyle: { color: colors[i], borderRadius: [0, 4, 4, 0] },
            })),
            barWidth: 16,
            label: {
              show: true,
              position: "right",
              formatter: (p) => fmtMs(view[p.dataIndex]?.mean),
              color: "#1f2328",
              fontSize: 11,
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
    const show = state.allVersions
      ? src
      : src.filter((r) => latestPerPm(state.fixture).get(r.pm) === r);

    const best = {};
    for (const s of SCEN) {
      let b = null;
      for (const r of show) {
        const m = msOf(r, s);
        if (m != null && (b === null || m < b)) b = m;
      }
      best[s] = b;
    }

    show.sort((a, b) => {
      const d = PM_ORDER.indexOf(a.pm) - PM_ORDER.indexOf(b.pm);
      if (d !== 0) return d;
      return cmpVer(b.pm_version, a.pm_version);
    });

    const latest = latestPerPm(state.fixture);
    const head = ["管理器", "版本", ...SCEN.map((s) => SCEN_CN[s] || s)];
    const body = show
      .map((r) => {
        const isLatest = latest.get(r.pm) === r;
        const tds = SCEN.map((s) => {
          if (!isOk(r, s)) return `<td class="num fail">失败</td>`;
          const m = msOf(r, s);
          if (m == null) return `<td class="num">—</td>`;
          const cls = best[s] === m ? "num best" : "num";
          return `<td class="${cls}">${fmtMs(m)}</td>`;
        }).join("");
        const tag = state.allVersions && !isLatest ? ` <span class="pill">旧</span>` : "";
        return `<tr>
          <td><span class="dot" style="background:${color(r.pm)}"></span>${r.pm}</td>
          <td class="ver">${r.pm_version}${tag}</td>
          ${tds}
        </tr>`;
      })
      .join("");

    document.getElementById("table-wrap").innerHTML = `<table>
      <thead><tr>${head
        .map((h, i) => (i < 2 ? `<th>${h}</th>` : `<th class="num">${h}</th>`))
        .join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  function renderFoot() {
    const t = (meta.generated_at || "").replace("T", " ").slice(0, 19);
    document.getElementById("foot").innerHTML =
      `${t ? t + " UTC · " : ""}Node LTS · ` +
      `${rows.length} 条 · ` +
      `<a href="https://github.com/cheezone/package-manager-benchmark">源码</a>`;
  }

  function render() {
    renderSegs();
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
