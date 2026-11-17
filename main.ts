// Token Radar — the program.
//
// Reads a sealed DefiLlama snapshot of every protocol and writes a web
// dashboard that ranks the protocols with no token yet by what their launch
// would be worth, each with the steps to farm it.
//
// Run it with no arguments: it reads the snapshot from MAKEFUN_INPUT_DIR
// (a file or a directory holding snapshot.json) and writes to
// MAKEFUN_OUTPUT_DIR. The grader invokes it exactly this way. Locally,
// --input <snapshot.json> and MAKEFUN_OUTPUT_DIR=out do the same thing.
//
// What it writes, in order: the ranked board (board.json), the dashboard's
// data (data.js beside the page), a copy of dashboard/ and screenshots/,
// and the dossier (dossier.json) last, built with buildDossier from
// vendor/makefun-board.ts.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

function argValue(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  return null;
}

/** The snapshot path: --input first, then MAKEFUN_INPUT_DIR (a file, or a
 *  directory holding snapshot.json), then the sealed input path. */
function inputPath(): string {
  const flag = argValue("--input");
  if (flag) return flag;
  const env = process.env.MAKEFUN_INPUT_DIR;
  if (env) {
    if (existsSync(env) && statSync(env).isDirectory()) return join(env, "snapshot.json");
    return env;
  }
  return "/input/snapshot.json";
}

/** The output directory: MAKEFUN_OUTPUT_DIR, else "out" beside the program. */
function outputDir(): string {
  return process.env.MAKEFUN_OUTPUT_DIR ?? "out";
}

/** The repository root: the directory holding this program. */
function repoRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

function main(): void {
  const snapshot = JSON.parse(readFileSync(inputPath(), "utf8")) as Snapshot;
  const rows = buildBoard(snapshot);

  const out = outputDir();
  mkdirSync(out, { recursive: true });

  // The ranked board.
  writeFileSync(join(out, "board.json"), JSON.stringify({ rows }, null, 2) + "\n");

  // The dashboard's data, beside the page: the page loads ../data.js.
  const data = { rows, as_of: snapshot.as_of, floor_usd: snapshot.floor_usd };
  writeFileSync(join(out, "data.js"), `window.TOKEN_RADAR_DATA = ${JSON.stringify(data)};\n`);

  // The dashboard and its screenshots, copied whole.
  const root = repoRoot();
  cpSync(join(root, "dashboard"), join(out, "dashboard"), { recursive: true });
  cpSync(join(root, "screenshots"), join(out, "screenshots"), { recursive: true });

  // The dossier, last: the library writes it from the dashboard and the
  // screenshots that are now in the output directory.
  writeFileSync(join(out, "dossier.json"), buildDossier(out, { text_max_bytes: 65536 }));

  console.log(`token-radar: ${rows.length} rows, dossier written to ${join(out, "dossier.json")}`);
}

main();
