// Token Radar — the program.
//
// Reads a sealed DefiLlama snapshot of every protocol and writes a web
// dashboard that ranks the protocols with no token yet by what their
// launch would be worth, each with the steps to farm it.
//
// Run it with no arguments: it reads the snapshot from MAKEFUN_INPUT_DIR
// (a file, or a directory holding snapshot.json) and writes to
// MAKEFUN_OUTPUT_DIR. The grader invokes it exactly this way, with no
// arguments at all, in a fresh container. Locally, --input <snapshot.json>
// and MAKEFUN_OUTPUT_DIR=out do the same thing, and the --out flag is a
// convenience for the same.
//
// What it writes, in order: the ranked board (board.json), the
// dashboard's data (data.js beside the page), a copy of dashboard/ and
// screenshots/, and the dossier (dossier.json) last, built with
// buildDossier from vendor/makefun-board.ts. The dossier goes last
// because the library reads the dashboard and the screenshots out of
// the output directory, so they have to be there first.
//
// The program never touches the network, never reads anything but the
// snapshot, and never writes outside the output directory. It runs in
// well under the 120 seconds the competition allows, on 1 CPU and
// 1024 MB.

import { readFileSync, writeFileSync, mkdirSync, cpSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

// ---------------------------------------------------------------------------
// Command-line and environment handling
// ---------------------------------------------------------------------------

/** The value after a --flag on the command line, or null when the flag
// is absent or has nothing after it. */
function flagValue(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  if (at < 0 || at + 1 >= process.argv.length) return null;
  return process.argv[at + 1]!;
}

/** The snapshot path, in priority order:
 *   1. --input <path>, the local convenience flag;
 *   2. MAKEFUN_INPUT_DIR, a file, or a directory holding snapshot.json;
 *   3. /input/snapshot.json, the sealed path the grader mounts. */
function snapshotPath(): string {
  const flag = flagValue("--input");
  if (flag !== null) return flag;
  const env = process.env.MAKEFUN_INPUT_DIR;
  if (env !== undefined && env !== "") {
    if (existsSync(env) && statSync(env).isDirectory()) {
      return join(env, "snapshot.json");
    }
    return env;
  }
  return "/input/snapshot.json";
}

/** The output directory: --out first, then MAKEFUN_OUTPUT_DIR, then
// "out" beside the program. */
function outputDir(): string {
  const flag = flagValue("--out");
  if (flag !== null) return flag;
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== "") return env;
  return "out";
}

/** The repository root: the directory holding this program file. */
function repoRoot(): string {
  return dirname(fileURLToPath(import.meta.url));
}

/** Print the usage and exit. --help takes no other action: it does not
// read the snapshot or write anything. */
function printHelp(): void {
  console.log(`Token Radar — the program.
Reads a sealed DefiLlama snapshot and writes a ranked board, a
dashboard and a dossier.

Usage:
  node main.ts [--input <snapshot.json>] [--out <dir>]
  node main.ts --help

Options:
  --input <path>   the snapshot to read (default: MAKEFUN_INPUT_DIR,
                   a file or a directory holding snapshot.json, else
                   /input/snapshot.json)
  --out <dir>      the output directory (default: MAKEFUN_OUTPUT_DIR,
                   else "out")
  --help           print this help and exit

With no arguments at all, it reads MAKEFUN_INPUT_DIR and writes
MAKEFUN_OUTPUT_DIR, which is how the grader invokes it.

What it writes, in order: board.json, data.js, a copy of dashboard/
and screenshots/, and dossier.json last.`);
}

// ---------------------------------------------------------------------------
// Reading the snapshot
// ---------------------------------------------------------------------------

/** Read and parse the snapshot, and check it has the shape the model
// expects: a date, a protocol list and a watchlist. A snapshot that
// fails any of these is not a snapshot at all, and the program says so
// rather than writing a board from garbage. */
function readSnapshot(path: string): Snapshot {
  const text = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`snapshot at ${path} is not a JSON object`);
  }
  const snap = parsed as Partial<Snapshot>;
  if (typeof snap.as_of !== "string" || snap.as_of === "") {
    throw new Error(`snapshot at ${path} has no as_of date`);
  }
  if (!Array.isArray(snap.protocols)) {
    throw new Error(`snapshot at ${path} has no protocols array`);
  }
  if (!Array.isArray(snap.watchlist)) {
    throw new Error(`snapshot at ${path} has no watchlist array`);
  }
  return snap as Snapshot;
}

// ---------------------------------------------------------------------------
// Writing the output
// ---------------------------------------------------------------------------

/** Write the ranked board as board.json: an object with a rows array,
// two-space indent, one trailing newline. */
function writeBoard(outDir: string, rows: ReturnType<typeof buildBoard>): void {
  const payload = JSON.stringify({ rows }, null, 2) + "\n";
  writeFileSync(join(outDir, "board.json"), payload);
}

/** Write the dashboard's data as data.js: the rows plus the snapshot's
// date and floor, assigned to window.TOKEN_RADAR_DATA, so the page can
// load it with a plain <script> tag and no fetch. */
function writeDashboardData(outDir: string, snapshot: Snapshot, rows: ReturnType<typeof buildBoard>): void {
  const data = { rows, as_of: snapshot.as_of, floor_usd: snapshot.floor_usd };
  writeFileSync(join(outDir, "data.js"), `window.TOKEN_RADAR_DATA = ${JSON.stringify(data)};\n`);
}

/** Copy a directory whole into the output directory, replacing whatever
// was there. The dashboard and the screenshots are copied, not rebuilt,
// so the page the judge reads is exactly the page in the repository. */
function copyIntoOutput(root: string, outDir: string, name: string): void {
  cpSync(join(root, name), join(outDir, name), { recursive: true, force: true });
}

/** Write the dossier last, after the dashboard and the screenshots are
// in place, because buildDossier reads them out of the output
// directory. The text cap is 65,536 bytes, the one the competition's
// gate uses. */
function writeDossier(outDir: string): void {
  const bytes = buildDossier(outDir, { text_max_bytes: 65536 });
  writeFileSync(join(outDir, "dossier.json"), bytes);
}

/** Count the verdicts, for the one-line summary at the end. */
function countVerdicts(rows: ReturnType<typeof buildBoard>): { farm: number; thin: number; skip: number } {
  let farm = 0;
  let thin = 0;
  let skip = 0;
  for (const r of rows) {
    if (r.verdict === "FARM") farm += 1;
    else if (r.verdict === "THIN") thin += 1;
    else skip += 1;
  }
  return { farm, thin, skip };
}

// ---------------------------------------------------------------------------
// The program
// ---------------------------------------------------------------------------

function main(): void {
  if (process.argv.includes("--help")) {
    printHelp();
    return;
  }

  const input = snapshotPath();
  const out = outputDir();
  const root = repoRoot();

  const snapshot = readSnapshot(input);
  const rows = buildBoard(snapshot);

  mkdirSync(out, { recursive: true });

  // The ranked board.
  writeBoard(out, rows);

  // The dashboard's data, beside the page: the page loads ../data.js.
  writeDashboardData(out, snapshot, rows);

  // The dashboard and its screenshots, copied whole.
  copyIntoOutput(root, out, "dashboard");
  copyIntoOutput(root, out, "screenshots");

  // The dossier, last: the library writes it from the dashboard and
  // the screenshots that are now in the output directory.
  writeDossier(out);

  const counts = countVerdicts(rows);
  console.log(
    `token-radar: ${rows.length} rows ` +
      `(FARM ${counts.farm}, THIN ${counts.thin}, SKIP ${counts.skip}), ` +
      `dossier written to ${join(out, "dossier.json")}`,
  );
}

main();
