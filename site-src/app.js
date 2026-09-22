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
    if (typeof v === "number")
      return { mean: v, median: v, stddev: 0, min: null, max: null };
    if (typeof v.mean === "number") {
      return {
        mean: v.mean,
        median: v.median != null ? v.median : v.mean,
        stddev: v.stddev || 0,
        // 仅在 hyperfine 真给了 min/max 时使用，不拿 mean 冒充区间
        min: typeof v.min === "number" ? v.min : null,
        max: typeof v.max === "number" ? v.max : null,
      };
    }
    return null;
  }
  function isOk(r, s) {
    if (r.ok && typeof r.ok[s] === "boolean") return r.ok[s];
    return norm(r.scenarios?.[s]) != null;
  }
  /** 主指标：hyperfine median（无则 mean） */
  function msOf(r, s) {
    if (!isOk(r, s)) return null;
    const n = norm(r.scenarios?.[s]);
    return n ? n.median * 1000 : null;
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
  /** min–max 用同一单位，避免出现「200 ms – 2.20 s」 */
  function fmtRange(a, b) {
    if (a == null || b == null) return null;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    if (hi >= 1000) {
      return `${(lo / 1000).toFixed(2)} – ${(hi / 1000).toFixed(2)} s`;
    }
    return `${lo.toFixed(0)} – ${hi.toFixed(0)} ms`;
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
      .map((r) => {
        const n = norm(r.scenarios?.[state.scenario]);
        return {
          pm: r.pm,
          version: r.pm_version,
          label: labelOf(r.pm, r.pm_version),
          mean: msOf(r, state.scenario),
          sd: sdOf(r, state.scenario),
          minMs: n && n.min != null ? n.min * 1000 : null,
          maxMs: n && n.max != null ? n.max * 1000 : null,
          ok: isOk(r, state.scenario),
        };
      })
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

    const mobile = window.innerWidth < 720;
    const view = data.slice().reverse();
    // 多版本：抬高画布、拉开柱距，避免挤成一团
    const n = view.length;
    const elH = state.allVersions
      ? Math.max(mobile ? 320 : 360, n * (mobile ? 32 : 36) + 40)
      : Math.max(mobile ? 280 : 280, n * (mobile ? 36 : 40) + 32);
    el.style.height = elH + "px";
    if (chart) chart.resize();

    // y 轴：图标 + 名称 + 实现语言小标（手机也保留，只是更小）
    const rich = {};
    const names = view.map((d, i) => {
      const impl = implOf(d.pm, d.version);
      rich["pm" + i] = {
        width: mobile ? 14 : 18,
        height: mobile ? 14 : 18,
        backgroundColor: { image: PM_ICON[d.pm] || "" },
        borderRadius: 3,
      };
      const nameTxt = state.allVersions ? `${d.pm} ${d.version}` : d.pm;
      if (impl && IMPL_ICON[impl]) {
        rich["im" + i] = {
          width: mobile ? 12 : 14,
          height: mobile ? 12 : 14,
          backgroundColor: { image: IMPL_ICON[impl] },
        };
        return `{pm${i}|} ${nameTxt} {im${i}|}`;
      }
      return `{pm${i}|} ${nameTxt}`;
    });
    const values = view.map((d) => +d.mean.toFixed(1));
    const colors = view.map((d) => color(d.pm));

    chart.setOption(
      {
        backgroundColor: "transparent",
        animation: !mobile,
        grid: {
          left: 2,
          right: mobile ? 52 : 64,
          top: 8,
          bottom: mobile ? 28 : 16,
          containLabel: true,
        },
        tooltip: {
          trigger: "item",
          backgroundColor: "#fff",
          borderColor: "#e5e2e0",
          textStyle: { color: "#26251e", fontSize: 12, fontFamily: "MiSans, sans-serif" },
          formatter: (p) => {
            const d = view[p.dataIndex];
            if (!d) return "";
            const lines = [
              `<b>${d.pm}</b> ${d.version}`,
              `中位数 ${fmtMs(d.mean)}`,
            ];
            if (d.sd) lines.push(`标准差 ${fmtMs(d.sd)}`);
            const rg = fmtRange(d.minMs, d.maxMs);
            if (rg && d.maxMs - d.minMs > 0.5) lines.push(`区间 ${rg}`);
            return lines.join("<br/>");
          },
        },
        xAxis: {
          type: "value",
          axisLabel: {
            formatter: (v) => (v >= 1000 ? v / 1000 + "s" : v + "ms"),
            color: "#979696",
            fontSize: mobile ? 10 : 11,
            hideOverlap: true,
            margin: 8,
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
            fontSize: mobile ? 11 : 13,
            rich,
            formatter: (v) => v,
            hideOverlap: true,
            margin: 6,
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
            barWidth: state.allVersions ? (mobile ? 10 : 12) : mobile ? 14 : 18,
            barCategoryGap: state.allVersions ? "38%" : "32%",
            barGap: "28%",
            showBackground: true,
            backgroundStyle: { color: "#f5f0eb", borderRadius: 6 },
            label: {
              show: true,
              position: "right",
              formatter: (p) => fmtMs(view[p.dataIndex]?.mean),
              color: "#504f49",
              fontSize: mobile ? 10 : 12,
              distance: mobile ? 4 : 6,
            },
          },
        ],
      },
      true
    );
    chart.resize();
    placeWinFloat(view, values);
  }

  /** 浮贴纸贴在最快一根柱的数值右侧（不占图表布局） */
  function placeWinFloat(view, values) {
    const tip = document.getElementById("win-float");
    const wrap = tip && tip.parentElement;
    if (!tip || !chart || !wrap) return;
    if (!view.length) {
      tip.hidden = true;
      return;
    }
    // view 已 reverse：最后一项 = 最快（图上最上）
    const i = view.length - 1;
    let px = null;
    try {
      px = chart.convertToPixel({ xAxisIndex: 0, yAxisIndex: 0 }, [values[i], i]);
    } catch {
      px = null;
    }
    if (!px || !isFinite(px[0]) || !isFinite(px[1])) {
      tip.hidden = true;
      return;
    }
    const wrapW = wrap.clientWidth || 320;
    const tipW = tip.offsetWidth || 40;
    // 柱端 + 数值文字；右侧不够时贴到容器内并略靠上，避免溢出
    const gap = window.innerWidth < 720 ? 36 : 48;
    let left = px[0] + gap;
    if (left + tipW > wrapW - 4) left = Math.max(4, wrapW - tipW - 4);
    let top = px[1];
    if (left <= px[0] + 8) top = px[1] - 24;
    tip.hidden = false;
    tip.style.left = Math.round(left) + "px";
    tip.style.top = Math.round(top) + "px";
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

    // 当前场景的全局最快一行 → 雷军比心
    let winnerId = null;
    {
      let bestM = Infinity;
      for (const r of show) {
        if (!isOk(r, state.scenario)) continue;
        const m = msOf(r, state.scenario);
        if (m != null && m < bestM) {
          bestM = m;
          winnerId = r.pm + "@" + r.pm_version + "|" + r.fixture;
        }
      }
    }

    const scenHead = SCEN.map((s) => `<th class="num">${SCEN_CN[s] || s}</th>`).join("");
    const body = groups
      .map((g) => {
        const rowsHtml = g.rows
          .map((r) => {
            const key = r.pm + "|" + (implOf(r.pm, r.pm_version) || "");
            const isLatest = latest.get(key) === r;
            const rid = r.pm + "@" + r.pm_version + "|" + r.fixture;
            const isWin = rid === winnerId;
            const tds = SCEN.map((s) => {
              if (!isOk(r, s)) return `<td class="num fail">失败</td>`;
              const m = msOf(r, s);
              if (m == null) return `<td class="num">—</td>`;
              const cls = best[s] === m ? "num best" : "num";
              return `<td class="${cls}">${fmtMs(m)}</td>`;
            }).join("");
            const impl = implOf(r.pm, r.pm_version);
            return `<tr class="${isLatest ? "is-latest" : "is-old"}${
              isWin ? " is-winner" : ""
            }" data-id="${rid}">
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

    // 冠军浮贴纸由 placeWinFloat 贴在主图最快数值旁

    document.getElementById("table-wrap").innerHTML = `<table class="data-table${
      state.allVersions ? " is-multi" : ""
    }">
      <thead><tr>
        <th>版本</th>
        <th>实现</th>
        ${scenHead}
      </tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  /** 点击贴纸：放大再弹回 + 「牛哇牛哇」配音 */
  const NIUNIU_SRC = window.NIUNIU_SRC || "assets/niuniu.mp3";
  let niuniuAudio = null;
  function playNiuniu() {
    try {
      if (!niuniuAudio) {
        niuniuAudio = new Audio(NIUNIU_SRC);
        niuniuAudio.preload = "auto";
      }
      niuniuAudio.currentTime = 0;
      const p = niuniuAudio.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch (_) {}
  }
  function bindWinPop() {
    const tip = document.getElementById("win-float");
    if (!tip || tip.dataset.bound) return;
    tip.dataset.bound = "1";
    const pop = () => {
      tip.classList.remove("is-pop");
      void tip.offsetWidth;
      tip.classList.add("is-pop");
      playNiuniu();
    };
    tip.addEventListener("click", pop);
    tip.addEventListener("animationend", (e) => {
      if (e.animationName === "rotate-scale-up") tip.classList.remove("is-pop");
    });
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
    bindWinPop();
    renderFoot();
  }

  window.addEventListener("resize", () => {
    if (!chart) return;
    chart.resize();
    // 重算浮贴纸位置
    const data = chartRows();
    const view = data.slice().reverse();
    const values = view.map((d) => +d.mean.toFixed(1));
    placeWinFloat(view, values);
  });
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render);
  } else {
    render();
  }
})();
