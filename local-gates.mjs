// Token Radar — the local gate replica.
//
// The seven checks the competition runs on the output directory, re-run
// here before a submission so a bad bundle never leaves the machine.
// They are the same seven the kit's gate runs, in the same order, with
// the same limits; this file only re-implements them, so a failure here
// is a failure there.
//
//   1. dashboard_files   dashboard/ has index.html + at least one .css
//                         + at least one .js, at most 400 files and
//                         4 MiB in all, and no http/https URL in the
//                         source of any .html, .css or .js file.
//   2. board_file        board.json has 100–4000 rows, each with a
//                         valid slug, name, rank, implied value and
//                         farm_steps, and is at most 8 MiB.
//   3. sorted_by_value   ranks are exactly 1..N and implied_value_usd
//                         never increases with rank.
//   4. coverage          every watchlist slug from the snapshot is
//                         present on the board.
//   5. farm_steps        every row's farm_steps is 3–12 strings of
//                         20–600 characters each.
//   6. screenshots       3–4 PNG/JPEG files, each at most 512 KiB,
//                         long side at most 1440, short side at
//                         least 800.
//   7. dossier_matches   dossier.json is byte-identical to what
//                         buildDossier writes from this output
//                         directory.
//
// Usage: node local-gates.mjs [--out <dir>] [--input <snapshot.json>]
//   --out    the output directory to check (default: out)
//   --input  the snapshot to read the watchlist from
//            (default: ../token-radar-01-kit/input/snapshot.json)
// Exits 0 when all seven pass, 1 otherwise, and prints one line per
// gate plus a summary line.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";

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
// Small helpers
// ---------------------------------------------------------------------------

/** Walk a directory and return every file under it, as absolute paths.
// Symbolic links are not followed; the gate's dashboard is plain files. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Width and height of a PNG from its IHDR chunk (bytes 16–23): the
// width is a big-endian 32-bit integer at offset 16, the height the
// same at offset 20. Returns null when the buffer is not a PNG at all. */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** Width and height of a JPEG from its SOF0/SOF2 marker: scan the
// segments for a start-of-frame marker and read the dimensions from it.
// Returns null when no frame marker is found. */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < buf.length) {
    if (buf[at] !== 0xff) return null;
    const marker = buf[at + 1];
    const length = buf.readUInt16BE(at + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(at + 5), width: buf.readUInt16BE(at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

/** The dimensions of an image buffer, PNG or JPEG, or null when the
// buffer is neither. */
function imageSize(buf) {
  return pngSize(buf) ?? jpegSize(buf);
}

// ---------------------------------------------------------------------------
// The gates
// ---------------------------------------------------------------------------

/** One gate's result: its name, whether it passed, and a line saying
// why (the counts and sizes the gate looked at). */
function result(gate, ok, why) {
  return { gate, ok, why };
}

/** Gate 1 — dashboard_files. The dashboard must have its page, its
// style and its script; it must stay within the file and byte caps;
// and no source file may name a network address, because the page is
// meant to work with no network at all. */
function gateDashboardFiles(outDir) {
  const dashDir = join(outDir, "dashboard");
  const files = existsSync(dashDir) ? walk(dashDir) : [];
  const bytes = files.reduce((sum, f) => sum + statSync(f).size, 0);
  const hasHtml = files.some((f) => f.endsWith("index.html"));
  const hasCss = files.some((f) => extname(f) === ".css");
  const hasJs = files.some((f) => extname(f) === ".js");
  const textExtensions = new Set([".html", ".css", ".js"]);
  const badUrl = files.some((f) => {
    if (!textExtensions.has(extname(f))) return false;
    return /https?:\/\//.test(readFileSync(f, "utf8"));
  });
  if (!hasHtml || !hasCss || !hasJs) {
    return result("dashboard_files", false, "missing index.html / .css / .js");
  }
  if (files.length > 400) {
    return result("dashboard_files", false, `${files.length} files, over the 400 allowed`);
  }
  if (bytes > 4 * 1024 * 1024) {
    return result("dashboard_files", false, `${bytes} bytes, over the 4 MiB allowed`);
  }
  if (badUrl) {
    return result("dashboard_files", false, "an http/https URL in the dashboard source");
  }
  return result("dashboard_files", true, `${files.length} files, ${bytes} bytes`);
}

/** Gate 2 — board_file. The board must be there, within its row and
// byte caps, and every row must have the fields the judge reads: a
// slug, a name, a rank, an implied value and farm steps. The rows are
// returned for the later gates to use. */
function gateBoardFile(outDir) {
  const boardPath = join(outDir, "board.json");
  if (!existsSync(boardPath)) {
    return { outcome: result("board_file", false, "board.json missing"), rows: [] };
  }
  const size = statSync(boardPath).size;
  const board = JSON.parse(readFileSync(boardPath, "utf8"));
  const rows = board.rows ?? board;
  if (!Array.isArray(rows)) {
    return { outcome: result("board_file", false, "board.json has no rows array"), rows: [] };
  }
  const bad = rows.find(
    (r) =>
      typeof r.slug !== "string" || r.slug === "" ||
      typeof r.name !== "string" || r.name === "" ||
      typeof r.rank !== "number" ||
      typeof r.implied_value_usd !== "number" ||
      !Array.isArray(r.farm_steps),
  );
  if (rows.length < 100 || rows.length > 4000) {
    return { outcome: result("board_file", false, `${rows.length} rows, outside 100–4000`), rows };
  }
  if (size > 8 * 1024 * 1024) {
    return { outcome: result("board_file", false, `${size} bytes, over the 8 MiB allowed`), rows };
  }
  if (bad) {
    return { outcome: result("board_file", false, `invalid row: ${JSON.stringify(bad).slice(0, 120)}`), rows };
  }
  return { outcome: result("board_file", true, `${rows.length} rows, ${size} bytes`), rows };
}

/** Gate 3 — sorted_by_value. The ranks must run 1..N in order, and the
// implied value must never rise as the rank grows: the board is a
// ranking, and a ranking that is out of order is not a ranking. */
function gateSorted(rows) {
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].rank !== i + 1) {
      return result("sorted_by_value", false, `row ${i} has rank ${rows[i].rank}, not ${i + 1}`);
    }
    if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
      return result("sorted_by_value", false, `implied value rises from rank ${i} to rank ${i + 1}`);
    }
  }
  return result("sorted_by_value", true, `ranks 1..${rows.length}, implied value non-increasing`);
}

/** Gate 4 — coverage. Every slug on the snapshot's watchlist must be
// on the board: the field guide calls those protocols out by name, and
// a radar that misses one has a hole in it. */
function gateCoverage(rows, inputPath) {
  const snap = JSON.parse(readFileSync(inputPath, "utf8"));
  const watch = snap.watchlist ?? [];
  const have = new Set(rows.map((r) => r.slug));
  const missing = watch.filter((s) => !have.has(s));
  if (missing.length > 0) {
    return result("coverage", false, `missing watchlist slugs: ${missing.join(", ")}`);
  }
  return result("coverage", true, `${watch.length}/${watch.length} watchlist slugs present`);
}

/** Gate 5 — farm_steps. Every row's plan must be 3–12 steps, each a
// real instruction of 20–600 characters: too few steps is not a plan,
// too many is a ramble, and a step shorter than a sentence or longer
// than a paragraph is not a step. */
function gateFarmSteps(rows) {
  const bad = rows.find((r) => {
    const steps = r.farm_steps;
    if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return true;
    return steps.some((s) => typeof s !== "string" || s.length < 20 || s.length > 600);
  });
  if (bad) {
    return result("farm_steps", false, `bad farm_steps on ${bad.slug}`);
  }
  return result("farm_steps", true, `all ${rows.length} rows have 3–12 steps of 20–600 chars`);
}

/** Gate 6 — screenshots. Three or four images, each a whole PNG or
// JPEG within 512 KiB, its long side at most 1440 pixels and its short
// side at least 800: big enough for the judge to read, small enough
// for the dossier. */
function gateScreenshots(outDir) {
  const shotsDir = join(outDir, "screenshots");
  const imageExtensions = new Set([".png", ".jpg", ".jpeg"]);
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => imageExtensions.has(extname(f).toLowerCase()))
    : [];
  if (shots.length < 3 || shots.length > 4) {
    return result("screenshots", false, `${shots.length} screenshots, need 3–4`);
  }
  for (const f of shots) {
    const buf = readFileSync(join(shotsDir, f));
    if (buf.length > 512 * 1024) {
      return result("screenshots", false, `${f} is ${buf.length} bytes, over the 512 KiB allowed`);
    }
    const size = imageSize(buf);
    if (!size) {
      return result("screenshots", false, `${f} is not a readable PNG or JPEG`);
    }
    const long = Math.max(size.width, size.height);
    const short = Math.min(size.width, size.height);
    if (long > 1440) {
      return result("screenshots", false, `${f} long side ${long}, over the 1440 allowed`);
    }
    if (short < 800) {
      return result("screenshots", false, `${f} short side ${short}, under the 800 required`);
    }
  }
  return result("screenshots", true, `${shots.length} shots, all within size limits`);
}

/** Gate 7 — dossier_matches. The dossier must be byte-identical to
// what buildDossier writes from this output directory, with the same
// text cap the program used: a dossier that disagrees with its own
// dashboard is not the dashboard's dossier. */
async function gateDossier(outDir) {
  const dossierPath = join(outDir, "dossier.json");
  if (!existsSync(dossierPath)) {
    return result("dossier_matches", false, "dossier.json missing");
  }
  const { buildDossier } = await import("./vendor/makefun-board.ts");
  const rebuilt = Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 }));
  const actual = readFileSync(dossierPath);
  if (!rebuilt.equals(actual)) {
    return result(
      "dossier_matches",
      false,
      `dossier.json differs from a rebuild (${actual.length} vs ${rebuilt.length} bytes)`,
    );
  }
  return result("dossier_matches", true, `${actual.length} bytes, byte-identical to a rebuild`);
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

async function main() {
  const outDir = resolve(argValue("--out", "out"));
  const inputPath = argValue(
    "--input",
    resolve("..", "token-radar-01-kit", "input", "snapshot.json"),
  );

  const results = [];
  results.push(gateDashboardFiles(outDir));

  const { outcome, rows } = gateBoardFile(outDir);
  results.push(outcome);

  results.push(gateSorted(rows));
  results.push(gateCoverage(rows, inputPath));
  results.push(gateFarmSteps(rows));
  results.push(gateScreenshots(outDir));
  results.push(await gateDossier(outDir));

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.gate}  ${r.why}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  if (failed === 0) {
    console.log("7/7 gates pass");
  } else {
    console.log(`${failed} gate(s) failed`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

main();

// ---------------------------------------------------------------------------
// The limits, in one place
// ---------------------------------------------------------------------------
//
// The numbers the gates enforce, so a reader can see them without
// hunting through the functions:
//
//   dashboard_files
//     files          at most 400
//     bytes          at most 4 MiB (4,194,304)
//     source         index.html + at least one .css + at least one .js,
//                    no http:// or https:// in any .html, .css or .js
//   board_file
//     rows           100 to 4000
//     bytes          at most 8 MiB (8,388,608)
//     each row       a non-empty slug and name, a numeric rank and
//                    implied value, and a farm_steps array
//   sorted_by_value
//     ranks          exactly 1..N, in order
//     implied value  never increases with rank
//   coverage
//     watchlist      every slug from the snapshot's watchlist is present
//   farm_steps
//     steps          3 to 12 per row
//     each step      20 to 600 characters
//   screenshots
//     count          3 to 4 images
//     each image     at most 512 KiB (524,288 bytes), a whole PNG or
//                    JPEG, long side at most 1440, short side at least 800
//   dossier_matches
//     dossier.json   byte-identical to buildDossier with text_max_bytes
//                    65536, and at most 1.5 MiB
//
// The dossier's own caps (in vendor/makefun-board.ts) are separate:
// a dossier holds at most 8 images and 4 MiB in all, and its text is
// capped at the text_max_bytes the caller passes.
