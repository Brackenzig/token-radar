// Token Radar — the screenshots, v4.
//
// Re-takes the dashboard screenshots with headless Chrome: the full
// board, one protocol's detail panel, the board filtered to the
// farmable rows at $2,500, and the method tab. The dashboard must
// already be built into the output directory (run main.ts first),
// because the shots are taken from the built page, not from the
// repository's copy. The shots land in screenshots/ beside this
// script, which main.ts copies into the output directory on its next
// run — so re-take the shots, then re-run main.ts, then run the gates.
//
// The four shots, in order:
//   1-board.png     the board as it opens, all verdicts, by implied value
//   2-detail.png    the detail panel of the highest net-per-hour FARM row
//   3-filtered.png  the board filtered to FARM, re-netted at $2,500
//   4-method.png    the method tab: the fit, the tests and the bands
//
// The window is 1440 by 900, which satisfies the gate (long side at
// most 1440, short side at least 800) and shows the board at a readable
// width. The scrollbars are hidden so they never cover a column. A
// shot that comes out over the 512 KiB the gate allows is converted to
// JPEG at quality 88 and kept as .jpg, which the gate accepts.
//
// Usage: node screenshots.mjs [--out <dir>] [--chrome <path>]
//   --out     the output directory holding dashboard/ (default: out)
//   --chrome  the Chrome binary (default: ../chrome-linux64/chrome,
//             else $CHROME_PATH, else google-chrome on PATH)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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

/** Read a JPEG's dimensions from its first frame marker (SOF0, SOF1
// or SOF2): the height is a big-endian 16-bit integer five bytes past
// the marker, the width seven bytes past it. Returns null when the
// file is not a JPEG or carries no frame marker. */
function jpegDimensions(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = buf[i + 1];
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const len = buf.readUInt16BE(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}

/** Convert an oversize PNG to a JPEG at quality 88, in place: the
// PNG is replaced by a JPEG of the same base name. The conversion runs
// through Python's Pillow, which is installed on this machine; a shot
// that cannot be converted fails loudly rather than staying over the
// limit and failing the gate. Returns the file name that now exists. */
function convertToJpeg(shotsDir, file) {
  const pngPath = join(shotsDir, file);
  const jpgFile = file.replace(/\.png$/, ".jpg");
  const jpgPath = join(shotsDir, jpgFile);
  const code = [
    "from PIL import Image",
    `im = Image.open(${JSON.stringify(pngPath)}).convert('RGB')`,
    `im.save(${JSON.stringify(jpgPath)}, 'JPEG', quality=88, optimize=True)`,
  ].join("\n");
  execFileSync("python3", ["-c", code], { stdio: "pipe", timeout: 60000 });
  const size = readFileSync(jpgPath).length;
  if (size > 512 * 1024) {
    console.error(`${jpgFile} is still ${size} bytes after JPEG conversion, over the 512 KiB allowed`);
    process.exit(1);
  }
  rmSync(pngPath);
  console.log(`${file} was over the limit, converted to ${jpgFile} (${size} bytes)`);
  return jpgFile;
}

/** Check the shots just taken: each one must exist, be a readable
// PNG or JPEG, be at most 512 KiB, and have a long side of at most
// 1440 and a short side of at least 800 — the same limits the gate
// enforces. An oversize PNG is converted to JPEG first. A shot that
// fails any of these is reported and the program exits 1, so a bad
// screenshot never sits in the repository looking like a good one. */
function verifyShots(shotsDir, files) {
  const problems = [];
  const kept = [];
  for (let file of files) {
    let path = join(shotsDir, file);
    if (!existsSync(path)) {
      problems.push(`${file} is missing`);
      continue;
    }
    let buf = readFileSync(path);
    if (buf.length > 512 * 1024) {
      if (file.endsWith(".png")) {
        file = convertToJpeg(shotsDir, file);
        path = join(shotsDir, file);
        buf = readFileSync(path);
      } else {
        problems.push(`${file} is ${buf.length} bytes, over the 512 KiB allowed`);
        continue;
      }
    }
    const size = pngDimensions(buf) ?? jpegDimensions(buf);
    if (!size) {
      problems.push(`${file} is not a readable PNG or JPEG`);
      continue;
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440) problems.push(`${file} long side ${long}, over the 1440 allowed`);
    if (short < 800) problems.push(`${file} short side ${short}, under the 800 required`);
    kept.push(file);
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`bad screenshot: ${p}`);
    process.exit(1);
  }
  console.log(`${kept.length} screenshots verified, all within size limits`);
  return kept;
}

// ---------------------------------------------------------------------------
// The four shots
// ---------------------------------------------------------------------------

/** The shots, as [query, file] pairs, in the order they are taken.
// The detail shot opens the highest net-per-hour FARM row — the plan
// worth doing first — so the detail view shows a positive net and a
// positive net per hour, with its seven steps. The board is read from
// the output directory, which main.ts just wrote; the read happens
// here, before any shot is taken, so a missing board fails with a
// clear error instead of leaving stale images in place. */
function shotList(outDir) {
  const board = JSON.parse(readFileSync(join(outDir, "board.json"), "utf8"));
  const rows = board.rows || [];
  const best = rows
    .filter((r) => r.verdict === "FARM")
    .sort((a, b) => b.net_per_hour_usd - a.net_per_hour_usd)[0];
  const top = best ? best.slug : rows[0] ? rows[0].slug : "steakhouse-financial";
  return [
    ["", "1-board.png"],
    [`?detail=${encodeURIComponent(top)}`, "2-detail.png"],
    ["?verdict=FARM&capital=2500", "3-filtered.png"],
    ["?tab=method", "4-method.png"],
  ];
}

/** Check the detail shot's page actually opened the panel: dump the
// DOM of the detail URL and confirm the panel is unhidden and its
// name is filled. A JavaScript error in the detail rendering would
// otherwise leave a screenshot of the plain board looking like a
// detail shot. */
function verifyDetail(outDir, slug) {
  const chrome = findChrome();
  const url = pageUrl(outDir, `?detail=${encodeURIComponent(slug)}`);
  const dom = execFileSync(
    chrome,
    ["--headless", "--disable-gpu", "--no-sandbox", "--virtual-time-budget=5000", "--dump-dom", url],
    { stdio: "pipe", timeout: 120000, encoding: "utf8" },
  );
  const aside = dom.match(/<aside id="detail"[^>]*>/);
  if (!aside || /hidden/.test(aside[0])) {
    console.error(`bad screenshot: the detail panel did not open for ${slug}`);
    process.exit(1);
  }
  const name = dom.match(/id="detail-name">([^<]*)</);
  if (!name || !name[1]) {
    console.error(`bad screenshot: the detail panel is empty for ${slug}`);
    process.exit(1);
  }
  console.log(`detail panel verified: ${name[1]}`);
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
  const kept = verifyShots(
    shotsDir,
    shots.map(([, file]) => file),
  );
  const board = JSON.parse(readFileSync(join(outDir, "board.json"), "utf8"));
  const rows = board.rows || [];
  const best = rows
    .filter((r) => r.verdict === "FARM")
    .sort((a, b) => b.net_per_hour_usd - a.net_per_hour_usd)[0];
  if (best) verifyDetail(outDir, best.slug);
  console.log(`${kept.length} screenshots in ${shotsDir}: ${kept.join(", ")}`);
}

main();
