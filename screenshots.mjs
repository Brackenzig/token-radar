// Token Radar — the screenshots.
//
// Re-takes the three dashboard screenshots with headless Chrome: the full
// board, one protocol's detail panel, and the board filtered to FARM.
// The dashboard must already be built into the output directory (run
// main.ts first). The shots land in screenshots/ beside this script.
//
// Usage: node screenshots.mjs [--out <dir>] [--chrome <path>]
//   --out     the output directory holding dashboard/ (default: out)
//   --chrome  the Chrome binary (default: ../chrome-linux64/chrome,
//             else $CHROME_PATH, else google-chrome on PATH)

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function argValue(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  return fallback;
}

function findChrome() {
  const flag = argValue("--chrome", null);
  if (flag && existsSync(flag)) return flag;
  const here = dirname(fileURLToPath(import.meta.url));
  const bundled = resolve(here, "..", "chrome-linux64", "chrome");
  if (existsSync(bundled)) return bundled;
  if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  return "google-chrome";
}

function shot(chrome, url, outFile) {
  execFileSync(
    chrome,
    [
      "--headless",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      "--window-size=1440,900",
      `--screenshot=${outFile}`,
      url,
    ],
    { stdio: "pipe", timeout: 120000 },
  );
  console.log(`shot ${outFile}`);
}

function main() {
  const outDir = resolve(argValue("--out", "out"));
  const here = dirname(fileURLToPath(import.meta.url));
  const shotsDir = resolve(here, "screenshots");
  mkdirSync(shotsDir, { recursive: true });
  const chrome = findChrome();
  const page = `file://${join(outDir, "dashboard", "index.html")}`;

  // The board, as it opens.
  shot(chrome, page, join(shotsDir, "1-board.png"));
  // One protocol's detail panel: the top-ranked row.
  shot(chrome, `${page}?detail=steakhouse-financial`, join(shotsDir, "2-detail.png"));
  // The board filtered to the farmable rows.
  shot(chrome, `${page}?verdict=FARM`, join(shotsDir, "3-filtered.png"));
}

main();
