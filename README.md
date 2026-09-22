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
(lodash, chalk, commander, dayjs, semver, esbuild, typescript, …). The
`build` task does real work: lodash/dayjs/semver computation **plus**
esbuild-bundling the cli workspace package to `dist/`.

Four scenarios are timed per package manager:

| scenario | meaning |
|---|---|
| `install_cold` | no package-manager cache, no `node_modules`, no lockfile → full resolve + download |
| `install_warm` | cache + lockfile primed, `node_modules` removed → re-link from cache |
| `run_noop`     | `pm run noop` with `node_modules` present → isolates the **`pm run` spawn overhead** (this is where nub's "24× faster than pnpm run" claim lives) |
| `run_build`    | `pm run build` real task (also compares node-runtime vs bun-runtime) |

## How the benchmark stays fair

- **Latest versions**: `install-pm.sh` installs the newest release of each
  manager at CI time (`npm@latest`, `pnpm@latest`, `bun` via bun.sh,
  `@nubjs/nub@latest`, `@endevco/aube@latest`, `yarn@stable`).
- **Controllable caches**: each manager's cache lives in a known location
  that `bench.sh` wipes for the cold run and keeps for the warm run
  (e.g. pnpm `.pnpm-store`, bun `BUN_INSTALL_CACHE_DIR`, npm `~/.npm`,
  yarn/aube/nub global stores).
- **One fixture, no `workspace:` protocol**: workspace packages are linked
  at install time and imported by relative path at runtime, so every
  manager resolves the tree the same way (no pnpm-only `workspace:*`
  syntax that would break npm/bun).

## Run it locally

```bash
# benchmark a single manager (must have it installed)
bash bench.sh pnpm
bash bench.sh bun

# results land in results/<pm>.json
```

## Run it in CI

Push to `main` (or use **Run workflow**). A matrix job benchmarks each
manager on `ubuntu-latest` with the latest Node LTS, then an `aggregate`
job combines every `results/<pm>.json` into a comparison table posted to
the job summary.

## Caveats / honesty notes

- **Auto-install features** (aube's "install-before-run", nub's similar
  behaviour) are *not* exercised by the `run_*` scenarios because
  `node_modules` is already present — those are install-time features and
  show up in `install_*` instead.
- Absolute seconds depend on the runner, the registry mirror, and network.
  **Read the table as relative ordering on the same machine**, which is
  exactly what CI gives us (one runner, one run each).
- `yarn` runs in **node-modules linker** mode on purpose, so its runtime
  imports behave like the others (no PnP magic that would make the
  `run_build` comparison unfair).
- Numbers are a single run, not an average of N. Re-run the workflow for
  tighter confidence, or wrap `bench.sh` in a loop.
