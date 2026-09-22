# Package Manager Benchmark

A monorepo fixture + CI harness to measure, on **equal ground**, how
`npm`, `pnpm`, `bun`, `nub`, `aube` and `yarn` (berry, node-modules linker)
perform at the two things you do all day:

1. **install** dependencies (cold vs warm cache)
2. **run a task** (`pm run <script>`)

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

Four scenarios are timed per package manager, **each measured with
[hyperfine](https://github.com/sharkdp/hyperfine)** (multiple runs →
**mean ± stddev**, not a single sample):

| scenario | meaning | hyperfine runs |
|---|---|---|
| `install_cold` | no package-manager cache, no `node_modules`, no lockfile → full resolve + download | 3 (cache wiped before each run) |
| `install_warm` | cache + lockfile primed, `node_modules` removed → re-link from cache | 4 |
| `run_noop`     | `pm run noop` with `node_modules` present → isolates the **`pm run` spawn overhead** (this is where nub's "24× faster than pnpm run" claim lives) | 8 |
| `run_build`    | `pm run build` real task (also compares node-runtime vs bun-runtime) | 4 |

## How the benchmark stays fair

- **Version sweep**: a `setup` job (`.github/scripts/matrix.mjs`) queries
  the npm registry for each manager and picks the **last 3 minor-series
  releases** (each represented by its latest patch). The benchmark then
  runs as a matrix over **(pm × version)** — 18 combos today — so you can
  see whether a new release actually got faster or just changed its
  marketing.
- **Controllable caches**: each manager's cache lives in a known location
  that `bench.sh` wipes for the cold run and keeps for the warm run
  (e.g. pnpm `.pnpm-store`, bun `BUN_INSTALL_CACHE_DIR`, npm `~/.npm`,
  yarn/aube/nub global stores).
- **One fixture, no `workspace:` protocol**: workspace packages are linked
  at install time and imported by relative path at runtime, so every
  manager resolves the tree the same way (no pnpm-only `workspace:*`
  syntax that would break npm/bun).
- **yarn berry parity**: the berry setup mirrors
  [vltpkg/benchmarks](https://github.com/vltpkg/benchmarks) — explicit
  `corepack yarn@<ver>`, `enableImmutableInstalls: false`,
  `enableMirror: false`, `nodeLinker: node-modules`. This is the config
  that reliably works on CI Linux runners.

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

Push to `main` (or use **Run workflow**). The `setup` job computes the
version matrix, then a **(pm × version)** matrix benchmarks each combo on
`ubuntu-latest`; finally the `aggregate` job combines every
`results/<pm>-<version>.json` into a Markdown table (mean ± stddev,
fastest cell bolded) posted to the job summary.

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
   globally installed (e.g. npm 10.9, pnpm 12.4, bun 1.3); CI pins the
   exact latest per the matrix. Different versions, different numbers.
4. **Node version**: local may be a different Node minor than the CI-pinned
   22.x; bun in particular is sensitive to this.
5. **Filesystem / disk**: NVMe on CI vs whatever the laptop has.

**Rule of thumb**: trust the CI table for absolute ordering and the
version-trend section; treat any single local run as a rough sanity check
only.

## Caveats / honesty notes

- **Auto-install features** (aube's "install-before-run", nub's similar
  behaviour) are *not* exercised by the `run_*` scenarios because
  `node_modules` is already present — those are install-time features and
  show up in `install_*` instead.
- Each cell is the **mean of N hyperfine runs with stddev** (see the runs
  column above). Re-run the workflow to tighten confidence; the stddev
  tells you how noisy a given runner was.
- `yarn` runs in **node-modules linker** mode on purpose, so its runtime
  imports behave like the others (no PnP magic that would make the
  `run_build` comparison unfair).
