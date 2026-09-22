#!/usr/bin/env node
// Result store helpers + CLI.
//
// Layout: data/bench/<fixture>__<pm>__<version>.json  (committed to the repo)
// Key normalizes version to X.Y.Z so "12.0.2 linux-x64" == "12.0.2".
//
// CLI:
//   node scripts/result-store.js key <fixture> <pm> <version>
//   node scripts/result-store.js has <fixture> <pm> <version>   → exit 0 if usable
//   node scripts/result-store.js get  <fixture> <pm> <version>
//   node scripts/result-store.js put  <fixture> <pm> <version>  (reads result JSON on stdin)
//   node scripts/result-store.js list
//   node scripts/result-store.js merge <incomingDir>            (overlay new results)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STORE = path.join(ROOT, "data", "bench");

export function cleanVer(v) {
  const m = String(v || "").match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  return m ? m[0] : String(v || "").trim().split(/\s+/)[0];
}

export function storeKey(fixture, pm, version) {
  return `${fixture}__${pm}__${cleanVer(version)}.json`;
}

export function storePath(fixture, pm, version) {
  return path.join(STORE, storeKey(fixture, pm, version));
}

export function isUsable(row) {
  if (!row || !row.pm || !row.scenarios) return false;
  const ok = row.ok || {};
  const s = row.scenarios || {};
  for (const k of ["install_cold", "install_warm", "install_frozen", "run_noop"]) {
    if (ok[k] !== false && s[k]) return true;
  }
  return false;
}

export function readStore() {
  const rows = [];
  if (!fs.existsSync(STORE)) return rows;
  for (const f of fs.readdirSync(STORE)) {
    if (!f.endsWith(".json")) continue;
    try {
      rows.push(JSON.parse(fs.readFileSync(path.join(STORE, f), "utf8")));
    } catch {
      /* skip corrupt */
    }
  }
  return rows;
}

export function writeStoreRow(row) {
  fs.mkdirSync(STORE, { recursive: true });
  const p = storePath(row.fixture || "handle", row.pm, row.pm_version || row.requested_version);
  fs.writeFileSync(p, JSON.stringify(row, null, 2) + "\n");
  return p;
}

export function hasUsable(fixture, pm, version) {
  const p = storePath(fixture, pm, version);
  if (!fs.existsSync(p)) return false;
  try {
    return isUsable(JSON.parse(fs.readFileSync(p, "utf8")));
  } catch {
    return false;
  }
}

// ---- CLI (only when executed directly) ----
const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    if (cmd === "key") {
      console.log(storeKey(args[0], args[1], args[2]));
    } else if (cmd === "has") {
      process.exit(hasUsable(args[0], args[1], args[2]) ? 0 : 1);
    } else if (cmd === "get") {
      process.stdout.write(fs.readFileSync(storePath(args[0], args[1], args[2]), "utf8"));
    } else if (cmd === "put") {
      const chunks = [];
      process.stdin.on("data", (d) => chunks.push(d));
      process.stdin.on("end", () => {
        const row = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        console.error("# stored", writeStoreRow(row));
      });
    } else if (cmd === "list") {
      for (const r of readStore()) {
        console.log(`${r.fixture}\t${r.pm}\t${cleanVer(r.pm_version)}`);
      }
    } else if (cmd === "merge") {
      const dir = args[0];
      let n = 0;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith(".json") || f === "aggregate.json") continue;
        try {
          const row = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
          if (row.pm) {
            writeStoreRow(row);
            n++;
          }
        } catch {
          /* skip */
        }
      }
      console.error(`# merged ${n} rows into ${STORE}`);
    } else {
      console.error("usage: result-store.js key|has|get|put|list|merge ...");
      process.exit(2);
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
