# Package Manager Benchmark — CI 结果 (2026-09-22)

- **Run:** https://github.com/cheezone/package-manager-benchmark/actions/runs/35696091067
- **环境:** GitHub `ubuntu-latest` (Linux, 4 CPU, 16GB), Node **22.23.2**, 各 PM 均为最新版
- **指标:** `install_cold` = 无缓存冷装 · `install_warm` = 缓存+lockfile 就绪后重装 · `run_noop` = `pm run` 启动开销 · `run_build` = 真实任务(lodash/dayjs/semver 计算 + TypeScript 转译一个 workspace 包)
- **说明:** 单次计时(非 hyperfine 多次取均值)。数值越低越好。

## 权威对比表

| PM | 版本 | node | install_cold(s) | install_warm(s) | run_noop(s) | run_build(s) |
|---|---|---|---|---|---|---|
| **bun**  | 1.4.2  | v22.23.2 | **0.382** | **0.025** | **0.022** | **0.296** |
| aube  | 2.2.4  | v22.23.2 | 0.971 | 0.063 | 0.032 | 0.503 |
| pnpm  | 12.5.1 | v22.23.2 | 1.053 | 0.064 | 0.036 | 0.380 |
| nub   | 0.9.3  | v22.23.2 | 1.749 | 0.283 | 0.116 | 0.572 |
| npm   | 12.0.2 | v22.23.2 | 2.566 | 1.480 | 0.131 | 0.576 |
| **yarn**| 4.18.0 | v22.23.2 | 2.617 | 1.152 | 0.405 | 0.835 |

## 你的怀疑，CI 数据说话

- **bun 确实快，但没"碾压"**：冷装 0.382s 全场最快，比 npm(2.566s) 快 ~6.7×；但 warm 只比 pnpm/aube 快 2-3×，不是宣传里的 10-100×。
- **nub 的"比 pnpm run 快 24 倍"是反的**：`run_noop` nub 0.116s vs pnpm 0.036s —— **nub 反而慢约 3 倍**(本地曾测得慢 ~11 倍，因本地环境差异更大)。nub 的卖点是 auto-install + TS 运行时，不是 run 速度。
- **aube 是真强者**：warm 0.063s、run 0.032s，和 bun 同一档，且"跑前自动装依赖"是独特优势。
- **yarn(node-modules 模式) 全面垫底**：cold 2.617s、warm 1.152s、run 0.405/0.835s。瓶颈是 Link 步骤把整棵 node_modules 物化(PnP 会破坏普通 `node` 运行，故为公平保留 node-modules)。

## 修复记录(CI 曾两次 failure)

1. `node-version: lts/*` 漂到 Node 24 → yarn 4.18 崩溃 → 固定 `"22"`。
2. yarn berry 必须用 `corepack yarn@latest install`(不能裸 `yarn`)，`.yarnrc.yml` 用 vltpkg 验证过的三行：`enableImmutableInstalls: false` / `enableMirror: false` / `nodeLinker: node-modules`(不设 `npmRegistryServer`)。

## 参考：vltpkg/benchmarks 怎么测的(更严谨的范式)

- **计时工具:** `hyperfine` `--runs=5 --warmup=2 --time-unit=ms --export-json --ignore-failure` → 取均值 + 标准差，**不是单次裸 date**。
- **夹具:** 真实框架(next/astro/svelte/vue/large/Babylon.js 86+ 包 monorepo)，只用 `ubuntu-latest`，全套 ~40 分钟。
- **PM 列表:** 14 种，**明确区分 yarn classic(`corepack yarn@1`)与 berry(`corepack yarn@latest`)**。
- **公平归一化:** 安装后数包数，算 **ms/包**，抵消不同依赖图差异。
- **安装命令(要点):** 多数加 `--ignore-scripts`(只测 resolve+link)；warm = 跑两次取第二次；每次跑前用 `clean-helpers.sh` 清缓存(hyperfine 的 `--prepare/--cleanup`)。
- **建议升级:** 把本仓库 harness 换成 hyperfine(多次 + stddev)会更符合"要不要信碾压宣传"的严谨诉求。
