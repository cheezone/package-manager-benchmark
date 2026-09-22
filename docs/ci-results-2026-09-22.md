# Package Manager Benchmark — CI 结果 (2026-09-22, hyperfine)

- **Run:** https://github.com/cheezone/package-manager-benchmark/actions/runs/35702035054
- **Live site:** https://cheezone.github.io/package-manager-benchmark/
- **环境:** GitHub `ubuntu-latest` (Linux x86_64, 4 vCPU, 16GB), Node **22.23.2**
- **计时:** hyperfine 1.20.0，多次采样 **mean ± stddev**（毫秒，越低越好）
- **场景:**
  - `install_cold` — 无缓存 / 无 lockfile / 无 node_modules
  - `install_warm` — 缓存 + lockfile 就绪，删 node_modules 重链
  - `install_frozen` — lockfile + 缓存就绪，`npm ci` / `--frozen-lockfile`
  - `run_noop` — `pm run noop` 启动开销
  - `run_build` — lodash/dayjs/semver 计算 + TypeScript 转译 workspace 包
- **PM:** npm / pnpm / bun / nub / aube（**不含 yarn**）

## 权威对比表

| PM | 版本 | install_cold (ms) | install_warm (ms) | install_frozen (ms) | run_noop (ms) | run_build (ms) |
|---|---|---|---|---|---|---|
| npm | 12.0.2 | 2513.8 ±192.2 | 1190.7 ±3.9 | 1200.3 ±11.2 | 128.2 ±0.9 | 569.3 ±7.2 |
| npm | 11.19.1 | 2551.0 ±60.5 | 1118.2 ±10.7 | 1125.9 ±7.9 | 128.6 ±0.9 | 565.9 ±3.7 |
| npm | 11.18.0 | 2074.7 ±181.7 | 782.7 ±8.3 | 784.6 ±2.5 | 101.0 ±1.7 | 472.2 ±26.7 |
| pnpm | 12.5.1 | 414.1 ±241.9 | 63.1 ±0.5 | 66.0 ±2.2 | 36.9 ±0.7 | 478.5 ±12.3 |
| pnpm | 12.4.2 | 403.3 ±244.4 | 64.2 ±1.4 | 63.7 ±2.0 | 36.9 ±1.1 | 475.5 ±7.3 |
| pnpm | 12.3.4 | 421.9 ±243.7 | 64.2 ±1.7 | 66.1 ±1.3 | 38.4 ±1.1 | 475.1 ±7.8 |
| bun | 1.4.2 | **289.2 ±14.4** | **32.2 ±2.0** | **33.2 ±2.3** | 28.7 ±1.6 | 469.5 ±6.5 |
| bun | 1.3.14 | 355.8 ±20.9 | 43.4 ±2.9 | 39.6 ±2.8 | 29.4 ±0.6 | 484.1 ±4.3 |
| bun | 1.2.23 | 403.9 ±64.0 | 42.3 ±3.1 | 42.4 ±3.7 | **17.7 ±0.7** | **275.4 ±1.8** |
| nub | v0.9.3 | 1924.9 ±338.9 | 291.8 ±4.3 | 282.3 ±3.6 | 71.5 ±2.0 | 438.9 ±3.5 |
| nub | v0.8.3 | 1450.6 ±59.7 | 67.9 ±3.4 | 69.4 ±1.5 | 66.2 ±1.6 | 437.5 ±1.1 |
| nub | v0.7.5 | 1361.8 ±80.4 | 68.5 ±2.2 | 66.8 ±3.3 | 93.6 ±2.2 | 470.0 ±7.8 |
| aube | 2.2.4 | 877.3 ±45.2 | 36.8 ±0.8 | 35.6 ±1.2 | 22.4 ±2.2 | 335.7 ±3.2 |
| aube | 2.1.0 | 773.9 ±40.7 | 64.9 ±4.0 | 62.8 ±2.7 | 31.6 ±1.6 | 483.3 ±6.0 |
| aube | 2.0.1 | 861.2 ±87.2 | 181.0 ±146.0 | 52.1 ±15.4 | 66.0 ±73.3 | 464.2 ±109.9 |

## 结论摘要（最新版本）

1. **冷安装**：bun 1.4.2 最快（0.29 s），aube / pnpm 约 0.8–0.9 s，npm 约 2.5 s。
2. **热安装 / 冻结安装**：bun ≈ aube ≈ pnpm（30–70 ms），npm 慢一个数量级（~1.2 s）。
3. **脚本启动**（`run_noop`）：bun 1.2.x 与 aube 2.2 最快；npm 最慢（~128 ms）。nub 并未比 pnpm run 更快。
4. **真实构建**：bun 1.2.23 的 runtime 路径最快（275 ms）；其余多在 330–570 ms。
5. **版本趋势**：bun 冷装在变快；nub 0.9.x 冷装反而比 0.7/0.8 更慢；aube 2.0.1 方差很大，不稳。

## 本轮相对旧结果的修复

| 问题 | 修复 |
|---|---|
| hyperfine 装完当步找不到 | 用绝对路径校验；`GITHUB_PATH` 只对后续 step 生效 |
| `stddev=null`（runs=1）导致读数崩溃 | `read_ms` 兼容 null stddev |
| workspace 嵌套 `node_modules` 搞坏 npm ideal tree（`Invalid Version`） | 冷/热/冻结准备阶段一并清掉 `packages/*/node_modules` |
| 场景单次裸计时不可信 | hyperfine 多次采样 + mean ± stddev |
| yarn 干扰矩阵 | 全面移除 yarn |
| 结果只在 Actions 日志里 | 聚合后发布到 GitHub Pages |

复现：`bash bench.sh <npm\|pnpm\|bun\|nub\|aube> [version]`
