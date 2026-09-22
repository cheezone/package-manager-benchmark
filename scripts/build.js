import _ from "lodash";
import chalk from "chalk";
import dayjs from "dayjs";
import semver from "semver";
import fs from "node:fs";
import ts from "typescript";
import { cliMain } from "../packages/cli/index.js";

const t0 = Date.now();

// Real computation work across several installed dependencies.
const nums = _.range(1, 2001);
const total = _.sum(_.map(nums, (x) => x * x));
const fmt = dayjs().format("YYYY-MM-DD HH:mm:ss");
const coerced = semver.coerce(process.version)?.version ?? process.version;

// Real CPU/IO work: transpile the cli workspace package with the
// TypeScript compiler API (no native binary, no postinstall script).
const src = fs.readFileSync("packages/cli/index.js", "utf8");
const transpiled = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const cliResult = cliMain();

const out = {
  ok: true,
  computed: total,
  builtAt: fmt,
  node: process.version,
  semver: coerced,
  cli: cliResult,
  transpiledBytes: transpiled.length,
  tookMs: Date.now() - t0,
};

fs.mkdirSync("dist", { recursive: true });
fs.writeFileSync("dist/output.json", JSON.stringify(out, null, 2));
fs.writeFileSync("dist/cli.transpiled.js", transpiled);
console.log(
  chalk.cyan(
    `[build] done in ${out.tookMs}ms, computed=${total}, transpiled=${transpiled.length} bytes`
  )
);
