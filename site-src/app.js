/* PM Benchmark dashboard */
(function () {
  const DATA = window.BENCH_DATA || { meta: {}, rows: [] };
  const meta = DATA.meta || {};
  const rows = (DATA.rows || []).map((r) => ({ fixture: "synthetic", ...r }));

  const SCEN = meta.scenarios || [
    "install_cold",
    "install_warm",
    "install_frozen",
    "run_noop",
    "run_build",
  ];
  const SCEN_LABEL = {
    install_cold: "冷安装",
    install_warm: "热安装",
    install_frozen: "冻结安装",
    run_noop: "脚本启动",
    run_build: "真实构建",
  };
  const SCEN_DESC = {
    install_cold: "无缓存 · 无 lockfile · 无 node_modules：完整解析 + 下载",
    install_warm: "缓存 + lockfile 就绪 · 删 node_modules：从缓存重链",
    install_frozen: "lockfile + 缓存 · 冻结安装：CI 还原路径",
    run_noop: "`pm run noop`：仅测 spawn 开销",
    run_build: "运行夹具自己的 build 脚本（真实打包）",
  };
  const PM_ORDER = meta.pm_order || ["npm", "pnpm", "bun", "nub", "aube"];
  const PM_COLOR = {
    npm: "#FF6B5A",
    pnpm: "#F5A623",
    bun: "#FF9F6B",
    nub: "#B388FF",
    aube: "#3DDC97",
  };
  const FX_ORDER = meta.fixtures || [...new Set(rows.map((r) => r.fixture))];
  const FX_LABEL = meta.fixture_labels || {
    synthetic: "Synthetic",
    handle: "antfu/handle",
    vitesse: "vitesse",
  };

  let state = {
    fixture: FX_ORDER.includes("handle") ? "handle" : FX_ORDER[0],
    scenario: "install_cold",
    mode: "rel",
  };

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
  function fmtMs(m) {
    if (m == null) return "—";
    if (m >= 10000) return (m / 1000).toFixed(2) + " s";
    if (m >= 1000) return (m / 1000).toFixed(2) + " s";
    return m.toFixed(1) + " ms";
  }
  function fmtRel(x) {
    if (x == null) return "—";
    if (x <= 1.02) return "1.0×";
    return x.toFixed(1) + "×";
  }
  function cmpVer(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
  }

  function rowsFor(fixture) {
    return rows.filter((r) => r.fixture === fixture);
  }

  /** latest version per PM within a fixture */
  function latestPerPm(fixture) {
    const map = new Map();
    for (const r of rowsFor(fixture)) {
      const prev = map.get(r.pm);
      if (!prev || cmpVer(r.pm_version, prev.pm_version) > 0) map.set(r.pm, r);
    }
    return map;
  }

  function sortedForScenario(fixture, scenario) {
    const latest = latestPerPm(fixture);
    return PM_ORDER.filter((p) => latest.has(p))
      .map((pm) => {
        const r = latest.get(pm);
        const v = r.scenarios?.[scenario];
        return {
          pm,
          version: r.pm_version,
          mean: ms(v),
          sd: sdMs(v),
          row: r,
        };
      })
      .filter((d) => d.mean != null)
      .sort((a, b) => a.mean - b.mean);
  }

  function color(pm) {
    return PM_COLOR[pm] || "#4C8DFF";
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ── controls ─────────────────────────────────────── */
  function renderControls() {
    const fxSeg = document.getElementById("fixture-seg");
    fxSeg.innerHTML = FX_ORDER.map(
      (f) =>
        `<button type="button" data-fixture="${esc(f)}" aria-pressed="${
          f === state.fixture
        }">${esc(FX_LABEL[f] || f)}</button>`
    ).join("");

    const scSeg = document.getElementById("scenario-seg");
    scSeg.innerHTML = SCEN.map(
      (s) =>
        `<button type="button" data-scenario="${esc(s)}" aria-pressed="${
          s === state.scenario
        }">${esc(SCEN_LABEL[s] || s)}</button>`
    ).join("");

    const mdSeg = document.getElementById("mode-seg");
    mdSeg.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode));
    });

    fxSeg.onclick = (e) => {
      const b = e.target.closest("button[data-fixture]");
      if (!b) return;
      state.fixture = b.dataset.fixture;
      renderAll();
    };
    scSeg.onclick = (e) => {
      const b = e.target.closest("button[data-scenario]");
      if (!b) return;
      state.scenario = b.dataset.scenario;
      renderAll();
    };
    mdSeg.onclick = (e) => {
      const b = e.target.closest("button[data-mode]");
      if (!b) return;
      state.mode = b.dataset.mode;
      renderAll();
    };
  }

  /* ── podium ───────────────────────────────────────── */
  function renderPodium() {
    const el = document.getElementById("podium");
    const data = sortedForScenario(state.fixture, state.scenario);
    if (!data.length) {
      el.innerHTML = `<div class="empty">暂无数据</div>`;
      return;
    }
    const best = data[0].mean;
    const top = data.slice(0, 3);
    // fill to 3 if fewer PMs
    while (top.length < 3 && data[top.length]) top.push(data[top.length]);

    el.innerHTML = data
      .slice(0, 3)
      .map((d, i) => {
        const rel = d.mean / best;
        const vsNpm = data.find((x) => x.pm === "npm");
        let delta = "";
        if (i === 0 && vsNpm && vsNpm !== d) {
          const x = vsNpm.mean / d.mean;
          delta = `<span class="delta">比 npm 快 ${x.toFixed(1)}×</span>`;
        } else if (i > 0) {
          delta = `<span class="delta slow">慢 ${fmtRel(rel)}</span>`;
        } else {
          delta = `<span class="delta">全场最快</span>`;
        }
        return `<article class="pod rank-${i + 1}">
          <div class="rank">${["Winner", "2nd", "3rd"][i]} · ${esc(
          SCEN_LABEL[state.scenario] || state.scenario
        )}</div>
          <div class="pm-name"><span class="dot" style="background:${color(
            d.pm
          )}"></span>${esc(d.pm)}</div>
          <div class="ver">${esc(d.version)} · ${esc(state.fixture)}</div>
          <div class="metric">${esc(fmtMs(d.mean))}</div>
          <div class="metric-sub">± ${esc(fmtMs(d.sd))} · n=${d.row.hyperfine_runs?.[scenarioKey(state.scenario)] ?? "?"}</div>
          ${delta}
        </article>`;
      })
      .join("");
  }

  function scenarioKey(s) {
    return s.replace("install_", "").replace("run_", "");
  }

  /* ── main bar chart ───────────────────────────────── */
  function renderMainChart() {
    const data = sortedForScenario(state.fixture, state.scenario);
    const el = document.getElementById("main-chart");
    const axisMax = document.getElementById("axis-max");
    document.getElementById("main-title").textContent =
      (SCEN_LABEL[state.scenario] || state.scenario) + " · " + (FX_LABEL[state.fixture] || state.fixture);
    document.getElementById("main-desc").textContent =
      SCEN_DESC[state.scenario] || "";
    document.getElementById("main-badge").textContent =
      state.mode === "rel" ? "相对最快者" : "mean ± sd";

    if (!data.length) {
      el.innerHTML = `<div class="empty">暂无数据</div>`;
      axisMax.textContent = "";
      return;
    }
    const best = data[0].mean;
    // bar scale: always relative to slowest so shape is readable in both modes
    const maxV = Math.max(...data.map((d) => d.mean + d.sd), 1);

    el.innerHTML = data
      .map((d, i) => {
        const pct = (d.mean / maxV) * 100;
        const sdPct = (d.sd / maxV) * 100;
        const rel = d.mean / best;
        const wLeft = Math.max(0, pct - sdPct);
        const wWidth = Math.min(100 - wLeft, sdPct * 2);
        return `<div class="row ${i === 0 ? "is-best" : ""}">
          <div class="col-label">
            <span class="pm">${esc(d.pm)}</span>
            <span class="ver">${esc(d.version)}</span>
          </div>
          <div class="track">
            <div class="fill" style="width:${pct}%;background:linear-gradient(90deg, ${color(
          d.pm
        )}cc, ${color(d.pm)})"></div>
            ${
              d.sd > 0
                ? `<div class="whisker" style="left:${wLeft}%;width:${Math.max(
                    wWidth,
                    0.5
                  )}%"></div>`
                : ""
            }
          </div>
          <div class="col-val">${
            state.mode === "rel" ? fmtRel(rel) : fmtMs(d.mean)
          }</div>
          <div class="col-rel">${
            state.mode === "rel" ? fmtMs(d.mean) : fmtRel(rel)
          }</div>
        </div>`;
      })
      .join("");

    axisMax.textContent =
      state.mode === "rel"
        ? fmtMs(maxV) + " (全量程)"
        : fmtMs(maxV);
  }

  /* ── small multiples ──────────────────────────────── */
  function renderSmallMultiples() {
    const el = document.getElementById("sm-grid");
    const latest = latestPerPm(state.fixture);
    const pms = PM_ORDER.filter((p) => latest.has(p));
    el.innerHTML = SCEN.map((s) => {
      const items = pms
        .map((pm) => {
          const r = latest.get(pm);
          return { pm, mean: ms(r.scenarios?.[s]) };
        })
        .filter((x) => x.mean != null)
        .sort((a, b) => a.mean - b.mean);
      const maxV = Math.max(...items.map((x) => x.mean), 1);
      const bestPm = items[0]?.pm;
      const bars = items
        .map(
          (x) => `<div class="sm-row">
            <span class="n">${esc(x.pm)}</span>
            <div class="sm-track"><div class="sm-fill" style="width:${
              (x.mean / maxV) * 100
            }%;background:${color(x.pm)}"></div></div>
            <span class="t">${esc(fmtMs(x.mean))}</span>
          </div>`
        )
        .join("");
      return `<div class="sm">
        <h3>${esc(SCEN_LABEL[s] || s)}${
        bestPm
          ? ` <span style="color:${color(bestPm)};font-weight:500">· ${esc(
              bestPm
            )}</span>`
          : ""
      }</h3>
        <p class="sm-desc">${esc(SCEN_DESC[s] || "")}</p>
        <div class="sm-bars">${bars}</div>
      </div>`;
    }).join("");
  }

  /* ── slope chart ──────────────────────────────────── */
  function renderSlope() {
    const el = document.getElementById("slope");
    const groups = new Map();
    for (const r of rowsFor(state.fixture)) {
      if (!groups.has(r.pm)) groups.set(r.pm, []);
      groups.get(r.pm).push(r);
    }
    const series = PM_ORDER.filter((p) => groups.has(p))
      .map((pm) => {
        const list = groups
          .get(pm)
          .slice()
          .sort((a, b) => cmpVer(a.pm_version, b.pm_version));
        return {
          pm,
          points: list.map((r) => ({
            v: r.pm_version,
            cold: ms(r.scenarios?.install_cold),
          })),
        };
      })
      .filter((s) => s.points.length >= 2 && s.points.some((p) => p.cold != null));

    if (!series.length) {
      el.innerHTML = `<div class="empty">版本序列不足，无法画趋势</div>`;
      return;
    }

    const maxLen = Math.max(...series.map((s) => s.points.length));
    const all = series.flatMap((s) => s.points.map((p) => p.cold || 0));
    const maxV = Math.max(...all, 1);
    const w = 680;
    const h = 220;
    const padL = 48;
    const padR = 100;
    const padT = 18;
    const padB = 34;
    const plotW = w - padL - padR;
    const plotH = h - padT - padB;
    const xAt = (i) =>
      padL + (maxLen === 1 ? plotW / 2 : (i / (maxLen - 1)) * plotW);
    const yAt = (v) => padT + plotH - (v / maxV) * plotH;

    const grid = [0, 0.5, 1]
      .map((t) => {
        const y = padT + plotH * (1 - t);
        const label = fmtMs(maxV * t);
        return `<line x1="${padL}" y1="${y}" x2="${
          padL + plotW
        }" y2="${y}" stroke="#1A2430" stroke-width="1"/>
        <text x="${padL - 8}" y="${
          y + 3
        }" text-anchor="end" font-size="10">${label}</text>`;
      })
      .join("");

    const xLabels = Array.from({ length: maxLen }, (_, i) => {
      return `<text x="${xAt(i)}" y="${
        h - 12
      }" text-anchor="middle" font-size="10">v${i + 1} · older→newer</text>`;
    }).join("");

    // actually label with real versions when 2 points
    let xReal = "";
    if (maxLen === 2) {
      xReal = series[0].points
        .map((p, i) => {
          return `<text x="${xAt(i)}" y="${
            h - 12
          }" text-anchor="middle" font-size="10">${esc(p.v)}</text>`;
        })
        .join("");
    }

    const lines = series
      .map((s) => {
        const c = color(s.pm);
        const pts = s.points
          .map((p, i) => `${xAt(i)},${yAt(p.cold || 0)}`)
          .join(" ");
        const dots = s.points
          .map(
            (p, i) =>
              `<circle cx="${xAt(i)}" cy="${yAt(
                p.cold || 0
              )}" r="4" fill="${c}" stroke="#070B10" stroke-width="1.5"/>`
          )
          .join("");
        const last = s.points[s.points.length - 1];
        const lx = xAt(s.points.length - 1);
        const ly = yAt(last.cold || 0);
        return `<polyline fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round" points="${pts}"/>${dots}
          <text x="${lx + 10}" y="${ly + 4}" font-size="11" fill="${c}">${esc(
          s.pm
        )}</text>`;
      })
      .join("");

    el.innerHTML = `<svg class="slope-svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="冷安装版本趋势">
      ${grid}
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${
      padT + plotH
    }" stroke="#243041" stroke-width="1"/>
      ${lines}${xReal || xLabels}
    </svg>`;
  }

  /* ── full table ───────────────────────────────────── */
  function renderTable() {
    const el = document.getElementById("table-wrap");
    // best per fixture×scenario
    const best = {};
    for (const fx of FX_ORDER) {
      for (const s of SCEN) {
        let b = null;
        for (const r of rowsFor(fx)) {
          const m = ms(r.scenarios?.[s]);
          if (m != null && (b === null || m < b)) b = m;
        }
        best[fx + ":" + s] = b;
      }
    }

    const head = [
      "Fixture",
      "PM",
      "Version",
      "Node",
      ...SCEN.map((s) => SCEN_LABEL[s] || s),
    ];
    const body = rows
      .slice()
      .sort((a, b) => {
        const fd =
          FX_ORDER.indexOf(a.fixture) - FX_ORDER.indexOf(b.fixture);
        if (fd !== 0) return fd;
        const d = PM_ORDER.indexOf(a.pm) - PM_ORDER.indexOf(b.pm);
        if (d !== 0) return d;
        return cmpVer(b.pm_version, a.pm_version);
      })
      .map((r) => {
        const tds = SCEN.map((s) => {
          const m = ms(r.scenarios?.[s]);
          const sd = sdMs(r.scenarios?.[s]);
          const isBest =
            m != null && best[r.fixture + ":" + s] === m;
          const txt =
            m == null
              ? "—"
              : sd
              ? `${fmtMs(m)} ±${(sd > 1000 ? (sd / 1000).toFixed(2) + "s" : sd.toFixed(1))}`
              : fmtMs(m);
          return `<td class="num ${isBest ? "cell-best" : ""}">${esc(txt)}</td>`;
        }).join("");
        return `<tr>
          <td><span class="chip-fx">${esc(r.fixture)}</span></td>
          <td><span class="dot" style="background:${color(
            r.pm
          )}"></span>${esc(r.pm)}</td>
          <td class="mono">${esc(r.pm_version)}</td>
          <td class="mono">${esc(r.node_version)}</td>
          ${tds}
        </tr>`;
      })
      .join("");

    el.innerHTML = `<table>
      <thead><tr>${head
        .map((h, i) =>
          i >= 4
            ? `<th class="num">${esc(h)}</th>`
            : `<th>${esc(h)}</th>`
        )
        .join("")}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  /* ── meta ─────────────────────────────────────────── */
  function renderMeta() {
    const t = meta.generated_at || new Date().toISOString();
    document.getElementById("meta-time").textContent = t.replace("T", " ").slice(0, 19) + "Z";
    document.getElementById("meta-env").textContent =
      (meta.runner?.os || "CI") + " · Node " + (meta.runner?.node || "?");
    document.getElementById("meta-n").textContent = String(rows.length);
  }

  function renderAll() {
    renderControls();
    renderPodium();
    renderMainChart();
    renderSmallMultiples();
    renderSlope();
    renderTable();
    renderMeta();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderAll);
  } else {
    renderAll();
  }
})();
