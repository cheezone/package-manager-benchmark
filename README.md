# Package Manager Benchmark

A monorepo fixture + CI harness to measure, on **equal ground**, how
`npm`, `pnpm`, `bun`, `nub` and `aube` perform at the things you do all day:

1. **install** dependencies (cold / warm / frozen-CI)
2. **run a task** (`pm run <script>`)

Live results: **https://cheezone.github.io/package-manager-benchmark/**

> The internet is full of "X is 17× faster than npm" claims. This repo
> tests them with the **latest released versions** on a **real monorepo**,
> in **GitHub Actions**, so the numbers are reproducible and not from a
> vendor's marketing page.

## What is being measured

The fixture is a pnpm/npm-style **monorepo** with two workspace packages
(`@app/core`, `@app/cli`) and a root that pulls in ~12 real dependencies
(lodash, chalk, commander, dayjs, semver, typescript, …). The `build`
task does real work: lodash/dayjs/semver computation **plus** a
TypeScript transpile of the cli workspace package to `dist/`.

Five scenarios are timed per package manager, **each measured with
[hyperfine](https://github.com/sharkdp/hyperfine)** (multiple runs →
**mean ± stddev**, not a single sample):

| scenario | meaning | hyperfine runs |
|---|---|---|
| `install_cold` | no package-manager cache, no `node_modules`, no lockfile → full resolve + download | 3 (cache wiped before each run) |
| `install_warm` | cache + lockfile primed, `node_modules` removed → re-link from cache | 4 |
| `install_frozen` | cache + lockfile primed, frozen/CI install (`npm ci` / `--frozen-lockfile`) → pure restore | 4 |
| `run_noop`     | `pm run noop` with `node_modules` present → isolates the **`pm run` spawn overhead** | 8 |
| `run_build`    | `pm run build` real task (also compares node-runtime vs bun-runtime) | 4 |

## Package managers covered

| PM | npm package / source |
|---|---|
| npm | `npm` |
| pnpm | `pnpm` |
| bun | GitHub release binary |
| nub | `@nubjs/nub` |
| aube | `@endevco/aube` |

Yarn is intentionally **not** in this sweep.

## How the benchmark stays fair

- **Version sweep**: `.github/scripts/matrix.mjs` queries the npm registry
  for each manager and picks the **last 3 minor-series releases** (each
  represented by its latest patch). The result is pasted into the workflow
  as a static matrix of **(pm × version)** — 15 combos — so you can see
  whether a new release actually got faster or just changed its marketing.
  Re-run the script and paste a fresh list to update the sweep.
- **Controllable caches**: each manager's cache lives in a known location
  that `bench.sh` wipes for the cold run and keeps for warm/frozen runs
  (e.g. pnpm `.pnpm-store`, bun `BUN_INSTALL_CACHE_DIR`, npm `~/.npm`,
  nub/aube global stores).
- **One fixture, no `workspace:` protocol**: workspace packages are linked
  at install time and imported by relative path at runtime, so every
  manager resolves the tree the same way (no pnpm-only `workspace:*`
  syntax that would break npm/bun).
- **hyperfine, not a stopwatch**: every cell is mean ± stddev over multiple
  runs. Wide stddev means the runner was noisy — read the number with that
  in mind.

## Run it locally

```bash
# benchmark a single manager at a specific version
bash bench.sh pnpm 12.5.1
bash bench.sh bun 1.4.2

# results land in results/<pm>-<version>.json
```

You need [hyperfine](https://github.com/sharkdp/hyperfine) on your PATH
(`brew install hyperfine`) and the manager installed.

## Run it in CI

Push to `main` (or use **Run workflow**; a weekly cron also refreshes the
site). A **(pm × version)** matrix benchmarks each combo on `ubuntu-latest`;
then `aggregate` combines every result into a Markdown table **and** a
static dashboard; `deploy` publishes that dashboard to **GitHub Pages**.

## CI test environment

Every combo runs on GitHub-hosted **`ubuntu-latest`** (x86_64 Linux):

- **Hardware**: 4 vCPU, 16 GB RAM, ~14 GB SSD (ephemeral, fresh per job)
- **OS**: Ubuntu 24.04 LTS (the current `ubuntu-latest` image)
- **Node**: pinned to **22.x** via `actions/setup-node`
- **Registry**: default `registry.npmjs.org` (no local mirror)
- **Timing**: `hyperfine` **1.20.0** (downloaded from its GitHub release)
- **Clean state**: each job is a fresh runner, so cold-cache numbers start
  from an empty cache every time (no warm-up leakage between combos)

## Why local numbers differ from CI

They will, and that is expected. The biggest factors:

1. **OS / architecture**: local was Apple Silicon macOS (arm64, APFS);
   CI is x86_64 Linux (ext4). Filesystem and syscall costs differ a lot
   for `node_modules` linking.
2. **Network to the registry**: CI runners sit inside GitHub's network
   and reach `registry.npmjs.org` with very low latency and stable
   bandwidth. A laptop on a home connection (especially outside the US)
   sees far higher and far more variable cold-install times — that is why
   local `install_cold` stddev can blow up to tens of seconds while CI
   stays tight.
3. **Package-manager versions**: local validation used whatever was
   globally installed; CI pins the exact latest per the matrix.
4. **Node version**: local may be a different Node minor than the CI-pinned
   22.x; bun in particular is sensitive to this.
5. **Filesystem / disk**: NVMe on CI vs whatever the laptop has.

**Rule of thumb**: trust the CI table / live site for absolute ordering and
the version-trend section; treat any single local run as a rough sanity
check only.

## Caveats / honesty notes

- **Auto-install features** (aube's "install-before-run", nub's similar
  behaviour) are *not* exercised by the `run_*` scenarios because
  `node_modules` is already present — those are install-time features and
  show up in `install_*` instead.
- Each cell is the **mean of N hyperfine runs with stddev** (see the runs
  column above). Re-run the workflow to tighten confidence; the stddev
  tells you how noisy a given runner was.
- `install_frozen` is the path most teams hit in CI; `install_warm` is the
  local "I deleted node_modules" path. They can differ a lot for npm
  (`npm ci` vs `npm install`).

## Repo layout

```
bench.sh                  # scenario harness (hyperfine)
package.json              # monorepo fixture root
packages/core, packages/cli
scripts/build.js          # real work for run_build
scripts/noop.js           # empty task for run_noop
.github/scripts/
  install-pm.sh           # pin/install one PM version on CI
  matrix.mjs              # regenerate (pm × version) matrix
  aggregate.js            # results → Markdown + aggregate.json
  build-site.js           # aggregate.json → static dashboard
  versions.sh
.github/workflows/benchmark.yml
```
