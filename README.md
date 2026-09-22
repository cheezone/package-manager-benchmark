# Package Manager Benchmark

A multi-fixture + CI harness to measure, on **equal ground**, how
`npm`, `pnpm`, `bun`, `nub` and `aube` perform at the things you do all day:

1. **install** dependencies (cold / warm / frozen-CI)
2. **run a task** (`pm run <script>`)

Live results: **https://cheezone.github.io/package-manager-benchmark/**

> The internet is full of "X is 17× faster than npm" claims. This repo
> tests them on **real open-source repos** and a controlled monorepo, in
> **GitHub Actions**, with hyperfine **mean ± stddev** — not a vendor page.

## Fixtures

| id | source | why |
|---|---|---|
| `handle` | [antfu/handle@`2003b777`](https://github.com/antfu/handle) | 汉字 Wordle · Vue 3 + Vite monorepo · ~39 deps · 完整真实前端工程 |
| `vitesse` | [antfu-collective/vitesse@`136a8b52`](https://github.com/antfu-collective/vitesse) | Vite + Vue 启动模板 · ~51 deps · 钉在 pnpm `catalog:` 引入之前，多 PM 可装 |
| `synthetic` | this repo | 12 个真实依赖的 monorepo，隔离 PM 自身 spawn / 链接开销 |

Fixtures are **pinned by SHA** and normalized before timing (`scripts/prepare-fixture.sh`):

- drop lockfiles + all `node_modules`
- strip `packageManager` pins (no corepack takeover)
- strip pnpm-only `.npmrc` / catalog workspace config
- strip `postinstall` hooks (`simple-git-hooks` etc.)
- inject a root `noop` script for spawn-overhead measurement
- add npm `workspaces` when `packages/*` exists

## Scenarios (hyperfine, mean ± stddev)

| scenario | meaning | runs (synthetic / real) |
|---|---|---|
| `install_cold` | no cache, no lockfile, no `node_modules` | 3 / 2 |
| `install_warm` | cache + lockfile primed, `node_modules` removed | 4 / 3 |
| `install_frozen` | `npm ci` / `--frozen-lockfile` restore path | 4 / 3 |
| `run_noop` | `pm run noop` spawn overhead | 8 / 5 |
| `run_build` | fixture's real `build` script (vite / vite-ssg) | 4 / 3 |

## Run it locally

```bash
# prepare a real fixture (clone + normalize) — or let bench.sh do it
bash scripts/prepare-fixture.sh handle

# benchmark one combo (CI is the source of truth)
bash bench.sh pnpm 12.5.1 handle
bash bench.sh bun 1.4.2 vitesse

# results land in results/<fixture>-<pm>-<version>.json
```

You need [hyperfine](https://github.com/sharkdp/hyperfine) and the PM installed.
Real-fixture cold installs are heavy — prefer CI numbers.

## Run it in CI → GitHub Pages

Push to `main` (or **Run workflow** / weekly cron). Matrix is
**(fixture × pm × version)**; `aggregate` merges JSON into a Markdown table
**and** a dashboard (`site-src/` → `site/`); `deploy` publishes to
**GitHub Pages**.

## Fairness notes

- One fixture tree per combo, fresh runner, controllable per-PM caches
- No `workspace:` protocol tricks; npm/pnpm/bun all resolve the same tree
- `run_build` runs the repo's own production `build`
- Yarn is intentionally out of scope
- Local numbers will differ (OS / disk / network) — trust the site

## Repo layout

```
bench.sh                      # scenario harness (hyperfine)
fixtures/manifest.json        # fixture pins (repo + SHA)
scripts/prepare-fixture.sh    # clone + normalize a fixture
site-src/                     # dashboard sources (index.html / css / js)
.github/scripts/
  install-pm.sh  matrix.mjs  aggregate.js  build-site.js  versions.sh
.github/workflows/benchmark.yml
```
