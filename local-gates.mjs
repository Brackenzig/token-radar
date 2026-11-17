// Token Radar — the local gate replica.
//
// The seven checks the competition runs on the output directory, re-run
// here before a submission so a bad bundle never leaves the machine.
//   1. dashboard_files    dashboard/ has index.html + >=1 .css + >=1 .js,
//                          <=400 files / 4 MiB, no http/https URLs in source
//   2. board_file         board.json has 100-4000 rows, each with a valid
//                          slug, name, rank, implied_value_usd and
//                          farm_steps, and is <=8 MiB
//   3. sorted_by_value    ranks are exactly 1..N and implied_value_usd is
//                          non-increasing with rank
//   4. coverage           every watchlist slug from the snapshot is present
//   5. farm_steps         every row's farm_steps is 3-12 strings of
//                          20-600 characters each
//   6. screenshots        3-4 PNG/JPEG, each <=512 KiB, long side <=1440,
//                          short side >=800
//   7. dossier_matches    dossier.json is byte-identical to what
//                          buildDossier writes from this output directory
//
// Usage: node local-gates.mjs [--out <dir>] [--input <snapshot.json>]
// Exits 0 when all seven pass, 1 otherwise.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { join, resolve, extname } from "node:path";

function argValue(flag, fallback) {
  const at = process.argv.indexOf(flag);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1];
  return fallback;
}

/** Width and height of a PNG from its IHDR chunk (bytes 16-23). */
function pngSize(buf) {
  if (buf.length < 24 || buf.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

async function main() {
  const outDir = resolve(argValue("--out", "out"));
  const inputPath = argValue(
    "--input",
    resolve("..", "token-radar-01-kit", "input", "snapshot.json"),
  );
  const results = [];
  const fail = (gate, why) => results.push({ gate, ok: false, why });
  const pass = (gate, why) => results.push({ gate, ok: true, why });

  // -- 1. dashboard_files -------------------------------------------------
  {
    const dashDir = join(outDir, "dashboard");
    const files = existsSync(dashDir) ? walk(dashDir) : [];
    const bytes = files.reduce((s, f) => s + statSync(f).size, 0);
    const hasHtml = files.some((f) => f.endsWith("index.html"));
    const hasCss = files.some((f) => extname(f) === ".css");
    const hasJs = files.some((f) => extname(f) === ".js");
    const badUrl = files.some((f) => {
      if (![".html", ".css", ".js"].includes(extname(f))) return false;
      return /https?:\/\//.test(readFileSync(f, "utf8"));
    });
    if (!hasHtml || !hasCss || !hasJs) fail("dashboard_files", "missing index.html / .css / .js");
    else if (files.length > 400) fail("dashboard_files", `${files.length} files > 400`);
    else if (bytes > 4 * 1024 * 1024) fail("dashboard_files", `${bytes} bytes > 4 MiB`);
    else if (badUrl) fail("dashboard_files", "an http/https URL in the dashboard source");
    else pass("dashboard_files", `${files.length} files, ${bytes} bytes`);
  }

  // -- 2. board_file -------------------------------------------------------
  let rows = [];
  {
    const boardPath = join(outDir, "board.json");
    if (!existsSync(boardPath)) {
      fail("board_file", "board.json missing");
    } else {
      const size = statSync(boardPath).size;
      const board = JSON.parse(readFileSync(boardPath, "utf8"));
      rows = board.rows ?? board;
      const bad = rows.find(
        (r) =>
          typeof r.slug !== "string" || !r.slug ||
          typeof r.name !== "string" || !r.name ||
          typeof r.rank !== "number" ||
          typeof r.implied_value_usd !== "number" ||
          !Array.isArray(r.farm_steps),
      );
      if (rows.length < 100 || rows.length > 4000) fail("board_file", `${rows.length} rows outside 100-4000`);
      else if (size > 8 * 1024 * 1024) fail("board_file", `${size} bytes > 8 MiB`);
      else if (bad) fail("board_file", `invalid row: ${JSON.stringify(bad).slice(0, 120)}`);
      else pass("board_file", `${rows.length} rows, ${size} bytes`);
    }
  }

  // -- 3. sorted_by_value --------------------------------------------------
  {
    let ok = true;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].rank !== i + 1) { ok = false; break; }
      if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) { ok = false; break; }
    }
    if (ok) pass("sorted_by_value", `ranks 1..${rows.length}, implied value non-increasing`);
    else fail("sorted_by_value", "ranks are not 1..N or implied value increases with rank");
  }

  // -- 4. coverage ---------------------------------------------------------
  {
    const snap = JSON.parse(readFileSync(inputPath, "utf8"));
    const watch = snap.watchlist ?? [];
    const have = new Set(rows.map((r) => r.slug));
    const missing = watch.filter((s) => !have.has(s));
    if (missing.length === 0) pass("coverage", `${watch.length}/${watch.length} watchlist slugs present`);
    else fail("coverage", `missing watchlist slugs: ${missing.join(", ")}`);
  }

  // -- 5. farm_steps -------------------------------------------------------
  {
    const bad = rows.find((r) => {
      const steps = r.farm_steps;
      if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) return true;
      return steps.some((s) => typeof s !== "string" || s.length < 20 || s.length > 600);
    });
    if (!bad) pass("farm_steps", `all ${rows.length} rows have 3-12 steps of 20-600 chars`);
    else fail("farm_steps", `bad farm_steps on ${bad.slug}`);
  }

  // -- 6. screenshots ------------------------------------------------------
  {
    const shotsDir = join(outDir, "screenshots");
    const shots = existsSync(shotsDir)
      ? readdirSync(shotsDir).filter((f) => [".png", ".jpg", ".jpeg"].includes(extname(f).toLowerCase()))
      : [];
    let why = "";
    if (shots.length < 3 || shots.length > 4) {
      why = `${shots.length} screenshots, need 3-4`;
    } else {
      for (const f of shots) {
        const buf = readFileSync(join(shotsDir, f));
        const size = pngSize(buf);
        if (buf.length > 512 * 1024) { why = `${f} is ${buf.length} bytes > 512 KiB`; break; }
        if (!size) { why = `${f} is not a readable PNG`; break; }
        const long = Math.max(size.width, size.height);
        const short = Math.min(size.width, size.height);
        if (long > 1440) { why = `${f} long side ${long} > 1440`; break; }
        if (short < 800) { why = `${f} short side ${short} < 800`; break; }
      }
    }
    if (why) fail("screenshots", why);
    else pass("screenshots", `${shots.length} shots, all within size limits`);
  }

  // -- 7. dossier_matches --------------------------------------------------
  {
    const dossierPath = join(outDir, "dossier.json");
    if (!existsSync(dossierPath)) {
      fail("dossier_matches", "dossier.json missing");
    } else {
      const { buildDossier } = await import("./vendor/makefun-board.ts");
      const rebuilt = Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 }));
      const actual = readFileSync(dossierPath);
      if (rebuilt.equals(actual)) pass("dossier_matches", `${actual.length} bytes, byte-identical to a rebuild`);
      else fail("dossier_matches", `dossier.json differs from a rebuild (${actual.length} vs ${rebuilt.length} bytes)`);
    }
  }

  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.gate}  ${r.why}`);
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? `7/7 gates pass` : `${failed} gate(s) failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
