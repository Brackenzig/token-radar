// Token Radar's entry point (radar-3): read the sealed snapshot, fit the comparables curve to its
// traded tokens, rank the pre-token protocols by implied value, and write the dashboard's whole
// dataset plus board.json.
//
// The three screenshots the bounty asks for are taken from the built dashboard: the board, a
// protocol's detail view and a filtered view.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
//   node screenshots.mjs out/dashboard screenshots
//
// A run refuses, rather than writes, when the snapshot is not the shape the model scores, when
// the board misses a watchlist slug, or when the screenshots are missing or the wrong count.
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseSnapshot,
  buildRadar,
  boardIssue,
  dataScript,
  MODEL_VERSION,
  type Snapshot,
} from './lib/model.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here);
const outRoot = process.env.MAKEFUN_OUTPUT_DIR ?? resolve(here, 'out');
const dashboardRoot = join(root, 'dashboard');
const screenshotsRoot = join(root, 'screenshots');

function usage(code: number): never {
  console.error(`token radar: usage: node main.ts --input <snapshot.json>`);
  process.exit(code);
}

function parseArgs(argv: string[]): { input: string } {
  const args = argv.slice(2);
  let input: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--input') {
      input = args[i + 1] ?? null;
      i++;
    }
  }
  if (input === null) usage(2);
  return { input };
}

function shotOk(path: string): boolean {
  try {
    const b = readFileSync(path);
    if (b.length < 1000 || b.length > 512 * 1024) return false;
    if (b.subarray(0, 4).toString('latin1') !== '\x89PNG') return false;
    const w = b.readUInt32BE(16);
    const h = b.readUInt32BE(20);
    const long = Math.max(w, h);
    const short = Math.min(w, h);
    return long <= 1440 && short >= 800;
  } catch {
    return false;
  }
}

function main(): void {
  const { input } = parseArgs(process.argv);
  let text: string;
  try {
    text = readFileSync(resolve(input), 'utf8');
  } catch {
    console.error(`token radar: cannot read ${input}`);
    process.exit(1);
  }
  let snapshot: Snapshot;
  try {
    snapshot = parseSnapshot(text);
  } catch (err) {
    console.error(`token radar: ${(err as Error).message}`);
    process.exit(1);
  }

  const { board, radar, fit } = buildRadar(snapshot);

  const missing = snapshot.watchlist.filter((s) => !board.some((r) => r.slug === s));
  if (missing.length > 0) {
    console.error(`token radar: the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}`);
    process.exit(1);
  }
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    console.error(`token radar: ${issue}`);
    process.exit(1);
  }
  for (const r of board) {
    if (r.token_status !== 'pre-token') {
      console.error(`token radar: ${r.slug} is not a pre-token row`);
      process.exit(1);
    }
  }

  const outDashboard = join(outRoot, 'dashboard');
  const outShots = join(outRoot, 'screenshots');
  mkdirSync(outDashboard, { recursive: true });
  mkdirSync(outShots, { recursive: true });

  // The gate wants board.json at the output root and a full dashboard/ copy beside it.
  writeFileSync(join(outRoot, 'board.json'), `${JSON.stringify({ rows: board }, null, 2)}\n`, 'utf8');
  const script = dataScript(radar);
  writeFileSync(join(outDashboard, 'data.js'), script, 'utf8');
  for (const f of ['index.html', 'app.css', 'app.js']) copyFileSync(join(dashboardRoot, f), join(outDashboard, f));

  // The screenshots the dossier wants live in the repo root's screenshots/; the output copy is
  // what the gate reads. Both are the same three files.
  const shots = existsSync(screenshotsRoot) ? readdirSync(screenshotsRoot).filter((f) => f.toLowerCase().endsWith('.png')).sort() : [];
  if (shots.length !== 3) {
    console.error(`token radar: screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
    process.exit(1);
  }
  for (const f of shots) {
    if (!shotOk(join(screenshotsRoot, f))) {
      console.error(`token radar: ${f} is not a PNG of 1KB..512KiB with a long side of at most 1440 and a short side of at least 800`);
      process.exit(1);
    }
    copyFileSync(join(screenshotsRoot, f), join(outShots, f));
  }

  const farm = board.filter((r) => r.verdict === 'FARM').length;
  const thin = board.filter((r) => r.verdict === 'THIN').length;
  const skip = board.filter((r) => r.verdict === 'SKIP').length;
  const top = board[0]!;
  const ts = fit.time_split;
  console.log(`token radar ${MODEL_VERSION}: ${board.length} rows (${snapshot.watchlist.length} watchlist + ${radar.early_size} early), ${radar.live.length} live-token protocols kept apart`);
  console.log(`comps curve: log10(mcap) = ${fit.intercept.toFixed(4)} + ${fit.slope.toFixed(4)} x log10(tvl)  (n=${fit.families} families, R^2=${fit.r_squared.toFixed(3)}, residual SD=${fit.residual_sd.toFixed(3)})`);
  console.log(`leave-one-out: median miss x${fit.loo_median_miss.toFixed(2)}, within 3x ${(fit.loo_within_3x * 100).toFixed(0)}%  |  flat mcap/TVL x${fit.flat_multiple.toFixed(3)}: median miss x${fit.flat_median_miss.toFixed(2)}, within 3x ${(fit.flat_within_3x * 100).toFixed(0)}%`);
  if (ts !== null) console.log(`time split (fit pre-2024 n=${ts.train}, test 2024+ n=${ts.test}): median miss x${ts.median_miss.toFixed(2)}, within 3x ${(ts.within_3x * 100).toFixed(0)}%`);
  console.log(`verdicts at $1,000 a plan: FARM ${farm} · THIN ${thin} · SKIP ${skip}`);
  console.log(`top pick: ${top.name} — ${top.implied_value_usd.toLocaleString('en-US')} implied (${top.implied_p25_usd.toLocaleString('en-US')}..${top.implied_p75_usd.toLocaleString('en-US')}), ${top.verdict} ${top.net_usd > 0 ? '+' : ''}$${top.net_usd}/plan, $${top.net_per_hour_usd}/h`);
  console.log(`wrote ${outRoot}/board.json, ${outDashboard}/ and ${outShots}/ (${shots.length} screenshots)`);
}

main();
