// Token Radar's model (radar-3): one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its index entry records no token (no market cap, no CoinGecko id, no symbol);
// the snapshot's live-token protocols are kept apart and shown as the market's own values, never
// mixed into the ranked board.
//
// Implied value is priced off the snapshot's own traded tokens, not a flat multiple. The model
// fits a comparables curve to every live-token family in the snapshot and prices each pre-token
// protocol off that curve:
//
//   comps     log10(mcap) = A + B x log10(tvl), OLS on the snapshot's live-token families
//             (one row per CoinGecko id, the family's largest protocol; CEX excluded)
//   base      = 10 ^ (A + B x log10(tvl_usd))
//   category  = 10 ^ (shrunk median residual of the protocol's category), shrink n / (n + 20)
//   growth    = clamp(change_7d, -60, 120) per cent
//   growthMult = 1 + (growth / 100) x 0.5
//   momentum  = +0.10 when growth > 20, -0.10 when growth < -20, else 0
//   maturity  = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth   = 1 + 0.03 x min(chains - 1, 10)
//   implied   = max(1, round(base x category x growthMult x (1 + momentum) x maturity x breadth))
//   band      = implied x the middle half of the fit's residuals (25th..75th percentile),
//               the range the board shows beside each implied value
//
// Why each factor is there, in one line each:
//   comps     — a token is worth what tokens like it trade for. The curve is fitted to the
//               snapshot's own traded tokens, so the price comes from the market, not a guess.
//   category  — some kinds of protocol trade richer than others at the same size; the factor is
//               the category's median residual off the curve, shrunk toward 1 by its sample size.
//   growth    — a protocol gaining TVL while its peers shrink is the one a launch is near.
//   momentum  — a breakout week (over +20%) or a bleed (under -20%) is a regime change, not noise.
//   maturity  — the longer a big protocol has run with no token, the more pent-up the launch.
//   breadth   — a protocol live on many chains has more venues for a token to land in.
//
// The curve is tested, not trusted: leave-one-out (each token left out, the curve refit, its cap
// predicted) and a time split (fit before 2024, test 2024 and later) are both reported beside a
// flat market-cap/TVL multiple, so the reader can see the curve earns its keep. No protocol name
// is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them and the page recomputes them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  momentum_up_pct: number;
  momentum_down_pct: number;
  momentum_value: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_chains: number;
  shrink_k: number;
  farm_share: number;
  tbill_rate: number;
  farm_hour_threshold: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  momentum_up_pct: 20,
  momentum_down_pct: -20,
  momentum_value: 0.1,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  breadth_per_chain: 0.03,
  breadth_max_chains: 10,
  shrink_k: 20,
  farm_share: 0.1,
  tbill_rate: 0.04,
  farm_hour_threshold: 5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many pre-token protocols below the watchlist floor the early radar carries, by TVL. */
export const EARLY_ROWS = 160;

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** The comparables curve fitted to the snapshot's traded tokens, and its validation. */
export interface CompsFit {
  families: number;
  intercept: number;
  slope: number;
  r_squared: number;
  residual_sd: number;
  loo_median_miss: number;
  loo_within_3x: number;
  loo_within_10x: number;
  flat_median_miss: number;
  flat_within_3x: number;
  flat_within_10x: number;
  flat_multiple: number;
  time_split: { train: number; test: number; median_miss: number; within_3x: number } | null;
  /** The middle half of the fit's residuals, as multipliers: the band the board shows. */
  band_lo_factor: number;
  band_hi_factor: number;
  /** The live-token families the curve was fitted on, for the scatter plot. */
  points: { tvl_usd: number; mcap_usd: number }[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  slice_1k_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  fees_usd: number;
  hold_days: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  model: {
    comps_base_usd: number;
    category_factor: number;
    growth_pct: number;
    growth_multiplier: number;
    momentum: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
  why: string;
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  slice_1k_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  fees_usd: number;
  hold_days: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  growth_multiplier: number;
  momentum: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  category_factor: number;
  why: string;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the comps curve and the model. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  total_protocols: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  comps: CompsFit;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const log10 = (n: number): number => Math.log(n) / Math.LN10;

/** Ordinary least squares on (x, y) pairs: returns intercept, slope and R squared. */
function ols(points: { x: number; y: number }[]): { a: number; b: number; r2: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  let sst = 0;
  for (const p of points) {
    sxx += (p.x - mx) * (p.x - mx);
    sxy += (p.x - mx) * (p.y - my);
    sst += (p.y - my) * (p.y - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssr = 0;
  for (const p of points) ssr += (p.y - (a + b * p.x)) ** 2;
  return { a, b, r2: sst === 0 ? 0 : 1 - ssr / sst };
}

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const m = s.length;
  if (m === 0) return 0;
  return m % 2 === 1 ? s[(m - 1) / 2]! : (s[m / 2 - 1]! + s[m / 2]!) / 2;
}

/**
 * The comparables curve: one live-token family per CoinGecko id (its largest protocol), CEX
 * excluded, fitted as log10(market cap) on log10(TVL), and validated two ways against a flat
 * market-cap/TVL multiple. Deterministic: the same snapshot always fits the same curve.
 */
export function fitComps(snapshot: Snapshot, model: ModelConstants = MODEL): CompsFit {
  const byGecko = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null || p.symbol === null) continue;
    if (p.category === 'CEX') continue;
    const prev = byGecko.get(p.gecko_id);
    if (prev === undefined || p.tvl_usd > prev.tvl_usd) byGecko.set(p.gecko_id, p);
  }
  const families = [...byGecko.values()];
  const points = families.map((p) => ({ x: log10(p.tvl_usd), y: log10(p.mcap_usd) }));
  const { a, b, r2 } = ols(points);
  const residuals = points.map((p) => p.y - (a + b * p.x));
  const sd = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(1, points.length - 2));
  // The band is the middle half of the residuals (the 25th and 75th percentiles), not a
  // normal-theory interval: the residuals are heavy-tailed, and the middle half is what the
  // board shows beside each implied value.
  const sortedResiduals = [...residuals].sort((x, y) => x - y);
  const quartile = (q: number): number => {
    const i = (sortedResiduals.length - 1) * q;
    const lo = Math.floor(i);
    const hi = Math.min(lo + 1, sortedResiduals.length - 1);
    return sortedResiduals[lo]! * (1 - (i - lo)) + sortedResiduals[hi]! * (i - lo);
  };
  const bandLo = 10 ** quartile(0.25);
  const bandHi = 10 ** quartile(0.75);

  // Leave-one-out: refit without each family, predict its cap, miss is the larger ratio.
  const looMisses: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const rest = points.filter((_, j) => j !== i);
    const f = ols(rest);
    const pred = f.a + f.b * points[i]!.x;
    looMisses.push(Math.max(10 ** (pred - points[i]!.y), 10 ** (points[i]!.y - pred)));
  }
  const looMedian = median(looMisses);
  const looWithin3 = looMisses.filter((m) => m <= 3).length / Math.max(1, looMisses.length);
  const looWithin10 = looMisses.filter((m) => m <= 10).length / Math.max(1, looMisses.length);

  // Flat baseline: the median market-cap/TVL multiple, scored the same way.
  const ratios = families.map((p) => p.mcap_usd! / p.tvl_usd).sort((x, y) => x - y);
  const flat = ratios[Math.floor(ratios.length / 2)]!;
  const flatMisses = families.map((p) => Math.max(p.mcap_usd! / (flat * p.tvl_usd), (flat * p.tvl_usd) / p.mcap_usd!));
  const flatMedian = median(flatMisses);
  const flatWithin3 = flatMisses.filter((m) => m <= 3).length / Math.max(1, flatMisses.length);
  const flatWithin10 = flatMisses.filter((m) => m <= 10).length / Math.max(1, flatMisses.length);

  // Time split: fit on protocols listed before 2024, test the ones listed in 2024 and later.
  let timeSplit: CompsFit['time_split'] = null;
  const train = families.filter((p) => p.listed_at !== null && p.listed_at < '2024-01-01');
  const test = families.filter((p) => p.listed_at !== null && p.listed_at >= '2024-01-01');
  if (train.length >= 10 && test.length >= 5) {
    const tf = ols(train.map((p) => ({ x: log10(p.tvl_usd), y: log10(p.mcap_usd!) })));
    const misses = test.map((p) => {
      const pred = tf.a + tf.b * log10(p.tvl_usd);
      const y = log10(p.mcap_usd!);
      return Math.max(10 ** (pred - y), 10 ** (y - pred));
    });
    timeSplit = {
      train: train.length,
      test: test.length,
      median_miss: median(misses),
      within_3x: misses.filter((m) => m <= 3).length / misses.length,
    };
  }

  return {
    families: families.length,
    intercept: a,
    slope: b,
    r_squared: r2,
    residual_sd: sd,
    loo_median_miss: looMedian,
    loo_within_3x: looWithin3,
    loo_within_10x: looWithin10,
    flat_median_miss: flatMedian,
    flat_within_3x: flatWithin3,
    flat_within_10x: flatWithin10,
    flat_multiple: flat,
    time_split: timeSplit,
    band_lo_factor: bandLo,
    band_hi_factor: bandHi,
    points: families.map((p) => ({ tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! })),
  };
}

/** The shrunk category factor: the category's median residual off the curve, shrunk to 1 by n. */
export function categoryFactors(snapshot: Snapshot, fit: CompsFit, model: ModelConstants = MODEL): Map<string, number> {
  const byGecko = new Map<string, SnapshotProtocol>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    if (p.gecko_id === null || p.symbol === null) continue;
    if (p.category === 'CEX') continue;
    const prev = byGecko.get(p.gecko_id);
    if (prev === undefined || p.tvl_usd > prev.tvl_usd) byGecko.set(p.gecko_id, p);
  }
  const byCategory = new Map<string, number[]>();
  for (const p of byGecko.values()) {
    const resid = log10(p.mcap_usd!) - (fit.intercept + fit.slope * log10(p.tvl_usd));
    const list = byCategory.get(p.category ?? 'Other') ?? [];
    list.push(resid);
    byCategory.set(p.category ?? 'Other', list);
  }
  const out = new Map<string, number>();
  for (const [cat, rs] of byCategory) {
    const med = median(rs);
    const shrink = rs.length / (rs.length + model.shrink_k);
    out.set(cat, 10 ** (med * shrink));
  }
  return out;
}

/** The comps base value for a TVL: the fitted curve's prediction, in dollars. */
export function compsBase(tvlUsd: number, fit: CompsFit): number {
  return 10 ** (fit.intercept + fit.slope * log10(tvlUsd));
}

/** The five multipliers and the implied value one protocol gets under `model` and `fit`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fit: CompsFit,
  categoryFactor: number,
  model: ModelConstants,
): { implied: number; p25: number; p75: number; base: number; growthPct: number; growthMult: number; momentum: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const momentum =
    growthPct > model.momentum_up_pct ? model.momentum_value : growthPct < model.momentum_down_pct ? -model.momentum_value : 0;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const base = compsBase(protocol.tvl_usd, fit);
  const implied = Math.max(1, Math.round(base * categoryFactor * growthMult * (1 + momentum) * maturityMult * breadthMult));
  return {
    implied,
    p25: Math.max(1, Math.round(implied * fit.band_lo_factor)),
    p75: Math.max(1, Math.round(implied * fit.band_hi_factor)),
    base: Math.round(base),
    growthPct,
    growthMult,
    momentum,
    maturityMult,
    breadthMult,
    age,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

function money(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  return `$${Math.round(n / 1e3)}K`;
}

/**
 * One line saying why this protocol is on the board, from its own figures only: its TVL rank in
 * its category, its growth, its age with no token and its chain count. No name is special-cased.
 */
export function whyLine(p: SnapshotProtocol, age: number | null, rankInCategory: number, categoryCount: number): string {
  const bits: string[] = [];
  bits.push(`${money(p.tvl_usd)} of TVL`);
  bits.push(`#${rankInCategory} of ${categoryCount} pre-token ${p.category ?? 'protocols'} by TVL`);
  if (age !== null) bits.push(`${age} days with no token`);
  else bits.push('no listing date on record');
  if (p.chains.length > 1) bits.push(`live on ${p.chains.length} chains`);
  else bits.push('single-chain');
  if (p.change_7d !== null && p.change_7d > 0) bits.push(`growing ${p.change_7d.toFixed(1)}% in 7 days`);
  if (p.change_7d !== null && p.change_7d < 0) bits.push(`down ${Math.abs(p.change_7d).toFixed(1)}% in 7 days`);
  return bits.join('; ') + '.';
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const fit = fitComps(snapshot, model);
  const factors = categoryFactors(snapshot, fit, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  // Category ranks: each protocol's TVL rank among the board's pre-token protocols of its category.
  const byCategory = new Map<string, SnapshotProtocol[]>();
  for (const p of chosen.values()) {
    const key = p.category ?? 'Other';
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  const categoryRank = new Map<string, number>();
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.tvl_usd - a.tvl_usd);
    list.forEach((p, i) => categoryRank.set(p.slug, i + 1));
  }

  const scored = [...chosen.values()].map((p) => {
    const catFactor = factors.get(p.category ?? 'Other') ?? 1;
    const v = impliedValue(p, snapshot.as_of, fit, catFactor, model);
    const econ = farmEconomicsFor(v.implied, p, v.age, model);
    return { p, v, catFactor, econ };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_p25_usd: s.v.p25,
    implied_p75_usd: s.v.p75,
    slice_1k_usd: s.econ.sliceUsd,
    net_usd: s.econ.netUsd,
    net_per_hour_usd: s.econ.netPerHourUsd,
    fees_usd: s.econ.feesUsd,
    hold_days: s.econ.holdDays,
    verdict: s.econ.verdict,
    model: {
      comps_base_usd: s.v.base,
      category_factor: s.catFactor,
      growth_pct: s.v.growthPct,
      growth_multiplier: s.v.growthMult,
      momentum: s.v.momentum,
      maturity_multiplier: s.v.maturityMult,
      breadth_multiplier: s.v.breadthMult,
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
    why: whyLine(s.p, s.v.age, categoryRank.get(s.p.slug) ?? 1, byCategory.get(s.p.category ?? 'Other')?.length ?? 1),
  }));
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  return 45;
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('risk')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Step 5 is the eligibility check: open the protocol's own points page before withdrawing.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'about $1 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $2 of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: 'about $0.50 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open ${p.name}'s own points or rewards page and check the wallet is earning points before you withdraw anything.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Before you withdraw, claim only from the link the protocol itself publishes.`,
      cost: 'the claim gas only',
      time: '10 minutes',
    },
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/**
 * The farm economics of one protocol: what $1,000 deposited would get if the farm share of the
 * launch goes to depositors pro rata, minus the plan's fees, gas and the forgone T-bill yield on
 * the capital, per hands-on hour. The verdict follows from it: FARM pays better than the hourly
 * threshold, THIN beats its fees only, SKIP never beats the fees. All inputs are the plan's own
 * figures and the row's implied value; nothing is hand-set per protocol.
 */
export function farmEconomicsFor(impliedUsd: number, p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL): FarmEconomics {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const weeks = hold / 7;
  const setupGas = 2;
  const feesUsd = round2(1 + setupGas + 0.5 * weeks + 1);
  const forgoneUsd = round2(capital * model.tbill_rate * (hold / 365));
  const sliceUsd = round2(impliedUsd * model.farm_share * (1000 / p.tvl_usd));
  const netUsd = round2(sliceUsd - feesUsd - forgoneUsd);
  const hours = round2(0.25 + (weeks * 10) / 60 + 10 / 60 + 10 / 60 + 5 / 60);
  const netPerHourUsd = round2(netUsd / hours);
  const verdict: FarmEconomics['verdict'] =
    netUsd > 0 && netPerHourUsd >= model.farm_hour_threshold ? 'FARM' : netUsd > 0 ? 'THIN' : 'SKIP';
  return { sliceUsd, feesUsd, forgoneUsd, netUsd, hours, netPerHourUsd, holdDays: hold, verdict };
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_p25_usd: row.implied_p25_usd,
    implied_p75_usd: row.implied_p75_usd,
    slice_1k_usd: row.slice_1k_usd,
    net_usd: row.net_usd,
    net_per_hour_usd: row.net_per_hour_usd,
    fees_usd: row.fees_usd,
    hold_days: row.hold_days,
    verdict: row.verdict,
    growth_multiplier: row.model.growth_multiplier,
    momentum: row.model.momentum,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    category_factor: row.model.category_factor,
    why: row.why,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData; fit: CompsFit } {
  const fit = fitComps(snapshot, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const totalImplied = board.reduce((sum, r) => sum + r.implied_value_usd, 0);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    total_protocols: snapshot.protocols.length,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: totalImplied,
    comps: fit,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar, fit };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
