// Token Radar — the screenshots.
//
// Re-takes the three dashboard screenshots with headless Chrome: the
// full board, one protocol's detail panel, and the board filtered to
// FARM. The dashboard must already be built into the output directory
// (run main.ts first), because the shots are taken from the built page,
// not from the repository's copy. The shots land in screenshots/
// beside this script, which main.ts copies into the output directory
// on its next run — so re-take the shots, then re-run main.ts, then
// run the gates.
//
// The three shots, in order:
//   1-board.png     the board as it opens, all verdicts, by implied value
//   2-detail.png    one protocol's detail panel, the top-ranked row
//   3-filtered.png  the board filtered to the farmable rows
//
// The window is 1440 by 900, which satisfies the gate (long side at
// most 1440, short side at least 800) and shows the board at a readable
// width. The scrollbars are hidden so they never cover a column.
//
// Usage: node screenshots.mjs [--out <dir>] [--chrome <path>]
//   --out     the output directory holding dashboard/ (default: out)
//   --chrome  the Chrome binary (default: ../chrome-linux64/chrome,
//             else $CHROME_PATH, else google-chrome on PATH)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** The value after a --flag on the command line, or the fallback when
// the flag is absent or has nothing after it. */
function argValue(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at < 0 || at + 1 >= process.argv.length) return fallback;
  return process.argv[at + 1];
}

// ---------------------------------------------------------------------------
// Finding Chrome
// ---------------------------------------------------------------------------

/** The Chrome binary to shoot with, in priority order:
//   1. --chrome <path>, when it exists;
//   2. the bundled build beside this repository, ../chrome-linux64/chrome;
//   3. $CHROME_PATH, when it names an existing file;
//   4. "google-chrome" on the PATH, which execFileSync resolves.
// The last one is a bare name, not a path, so it is returned unchecked:
// if Chrome is not installed, the shot fails loudly and says so. */
function findChrome() {
  const flag = argValue("--chrome", null);
  if (flag !== null && existsSync(flag)) return flag;

  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = resolve(here, "..", "chrome-linux64", "chrome");
  if (existsSync(bundled)) return bundled;

  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }

  return "google-chrome";
}

// ---------------------------------------------------------------------------
// Taking a shot
// ---------------------------------------------------------------------------

/** The window size the shots are taken at: 1440 wide, 900 tall. The
// gate allows a long side of at most 1440 and requires a short side of
// at least 800, and 1440x900 satisfies both exactly. */
const WINDOW_SIZE = "1440,900";

/** The flags every shot runs with: headless, no GPU, no sandbox (the
// container has no user namespace to sandbox in), scrollbars hidden,
// and the window size above. */
function chromeFlags(url, outFile) {
  return [
    "--headless",
    "--disable-gpu",
    "--no-sandbox",
    "--hide-scrollbars",
    `--window-size=${WINDOW_SIZE}`,
    `--screenshot=${outFile}`,
    url,
  ];
}

/** Take one screenshot: run Chrome headless against the URL and write
// the PNG to the output file. A shot that fails throws, with Chrome's
// own error on the console, rather than leaving a stale image in place
// and pretending it is new. */
function shot(chrome, url, outFile) {
  execFileSync(chrome, chromeFlags(url, outFile), { stdio: "pipe", timeout: 120000 });
  console.log(`shot ${outFile}`);
}

/** The page URL for the built dashboard, as a file:// URL, with an
// optional query string appended for the deep-linked views. */
function pageUrl(outDir, query = "") {
  return `file://${join(outDir, "dashboard", "index.html")}${query}`;
}

// ---------------------------------------------------------------------------
// Checking the shots
// ---------------------------------------------------------------------------

/** Read a PNG's dimensions from its IHDR chunk: the width is a
// big-endian 32-bit integer at offset 16, the height the same at
// offset 20. Returns null when the file is not a PNG. */
function pngDimensions(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Check the shots just taken: each one must exist, be a readable PNG,
// be at most 512 KiB, and have a long side of at most 1440 and a short
// side of at least 800 — the same limits the gate enforces. A shot
// that fails any of these is reported and the program exits 1, so a
// bad screenshot never sits in the repository looking like a good one. */
function verifyShots(shotsDir, files) {
  const problems = [];
  for (const file of files) {
    const path = join(shotsDir, file);
    if (!existsSync(path)) {
      problems.push(`${file} is missing`);
      continue;
    }
    const buf = readFileSync(path);
    if (buf.length > 512 * 1024) {
      problems.push(`${file} is ${buf.length} bytes, over the 512 KiB allowed`);
      continue;
    }
    const size = pngDimensions(buf);
    if (!size) {
      problems.push(`${file} is not a readable PNG`);
      continue;
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440) problems.push(`${file} long side ${long}, over the 1440 allowed`);
    if (short < 800) problems.push(`${file} short side ${short}, under the 800 required`);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`bad screenshot: ${p}`);
    process.exit(1);
  }
  console.log(`${files.length} screenshots verified, all within size limits`);
}

// ---------------------------------------------------------------------------
// The three shots
// ---------------------------------------------------------------------------

/** The shots, as [query, file] pairs, in the order they are taken.
// The detail shot opens the top-ranked protocol's panel; the filtered
// shot shows only the FARM rows. The top-ranked slug is read from the
// board, so the detail shot always shows the first row, whatever the
// data says — it is not hard-coded to one protocol. */
function shotList(outDir) {
  // The board is read from the output directory, which main.ts just
  // wrote; its first row is the top-ranked protocol. The read happens
  // here, before any shot is taken, so a missing board fails with a
  // clear error instead of leaving stale images in place.
  const board = JSON.parse(readFileSync(join(outDir, "board.json"), "utf8"));
  const top = board.rows && board.rows[0] ? board.rows[0].slug : "steakhouse-financial";
  return [
    ["", "1-board.png"],
    [`?detail=${encodeURIComponent(top)}`, "2-detail.png"],
    ["?verdict=FARM", "3-filtered.png"],
  ];
}

function main() {
  const outDir = resolve(argValue("--out", "out"));
  const here = dirname(fileURLToPath(import.meta.url));
  const shotsDir = resolve(here, "screenshots");
  mkdirSync(shotsDir, { recursive: true });

  const chrome = findChrome();
  const shots = shotList(outDir);
  for (const [query, file] of shots) {
    shot(chrome, pageUrl(outDir, query), join(shotsDir, file));
  }
  console.log(`${shots.length} screenshots in ${shotsDir}`);
  verifyShots(
    shotsDir,
    shots.map(([, file]) => file),
  );
}

main();
