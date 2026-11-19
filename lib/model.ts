// Token Radar — the valuation, the farm plan and the board, v4.
//
// A radar for token launches. It reads a sealed snapshot of every
// protocol (DefiLlama, frozen on a date), fits a comparables curve to
// the protocols whose token already trades, and prices every protocol
// with no token yet off that curve. Each one gets a farm plan for a
// fixed $1,000 of capital: the slice of the implied launch value the
// plan would earn, minus the gas and fees, minus the yield given up by
// parking the money, per plan and per hands-on hour, with a FARM /
// THIN / SKIP verdict.
//
// Nothing here touches the network. The snapshot is the only input,
// and the same bytes always give the same board. Every number the
// page shows is computed here, at run time, from that snapshot:
//
//   * the comparables line is an ordinary least-squares fit of
//     log10(market cap) on log10(TVL) over the traded tokens with
//     TVL of $10M or more — the fit runs in this program, on the
//     snapshot it is given, and no coefficient is written down in
//     advance;
//   * the fit is tested two ways, and both tests are reported: a
//     leave-one-out test (each traded token held out in turn, the
//     line refitted without it) and a time split (the line fitted on
//     tokens listed before 2024, tested on the ones listed since),
//     each against the same flat mcap/TVL multiple as a baseline;
//   * the uncertainty band on every row comes from 200 bootstrap
//     refits: each refit resamples the comparables with replacement,
//     refits the line and recalibrates the category factors, and
//     reprices the row, so the band is measured, never assumed;
//   * a category's factor is the median of its traded tokens'
//     log10(market cap / curve prediction), shrunk toward 1 by the
//     count of traded tokens in the category, n / (n + 20);
//   * a category with no traded token takes a factor of 1.
//
// The board is built by buildBoard at the bottom of this file. main.ts
// calls it and writes the board, the dashboard data and the dossier.
//
// ---------------------------------------------------------------------------
// The shapes
// ---------------------------------------------------------------------------

/** One protocol, as the snapshot records it. */
export interface Protocol {
  /** The DefiLlama slug, unique per protocol. */
  slug: string;
  /** The display name. */
  name: string;
  /** The DefiLlama category, or null when the snapshot gives none. */
  category: string | null;
  /** The chains the protocol lives on, first chain first. */
  chains: string[];
  /** Total value locked, in dollars. */
  tvl_usd: number;
  /** The 7-day TVL change in percent, or null when unreported. */
  change_7d: number | null;
  /** The token's market cap in dollars, or null when there is no token. */
  mcap_usd: number | null;
  /** The date the protocol was listed, YYYY-MM-DD, or null. */
  listed_at: string | null;
  /** The CoinGecko id of the token, or null when there is no token. */
  gecko_id: string | null;
  /** The token's symbol, or null when there is no token. */
  symbol: string | null;
}

/** The valuation broken down, so the dashboard can show its working. */
export interface ModelDetail {
  /** What the curve alone says the token would be worth at this TVL. */
  comps_base_usd: number;
  /** The category's calibration of the curve. */
  category_factor: number;
  /** The 7-day move after clamping, in percent. */
  growth_pct: number;
  /** The multiplier the week's move applies to value. */
  growth_multiplier: number;
  /** The momentum term: +0.1, -0.1 or 0. */
  momentum: number;
  /** The age tempering, 0.6 at launch rising to 1.0 at three years. */
  maturity_multiplier: number;
  /** The breadth widening, 3% per chain after the first, up to ten. */
  breadth_multiplier: number;
  /** The protocol's age in days, or null when no listing date is known. */
  age_days: number | null;
  /** The weekly gas on the protocol's first chain, in dollars. */
  weekly_gas_usd: number;
}

/** One row of the ranked board. */
export interface BoardRow {
  /** The rank, 1 for the largest implied value, assigned after sorting. */
  rank: number;
  slug: string;
  name: string;
  /** The category, or "" when the snapshot gives none. */
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  /** Always "pre-token": the board holds only protocols with no token. */
  token_status: string;
  /** The age in days, or null when no listing date is known. */
  age_days: number | null;
  /** The implied launch value in dollars. */
  implied_value_usd: number;
  /** The 10th-percentile implied value over the 200 bootstrap refits. */
  implied_p10_usd: number;
  /** The 90th-percentile implied value over the 200 bootstrap refits. */
  implied_p90_usd: number;
  /** The best rank the row takes across the 200 bootstrap refits. */
  rank_lo: number;
  /** The worst rank the row takes across the 200 bootstrap refits. */
  rank_hi: number;
  /** The valuation broken down. */
  model: ModelDetail;
  /** The slice of the implied value a $1,000 plan would earn. */
  slice_1k_usd: number;
  /** The gas and fees the plan costs. */
  fees_usd: number;
  /** The slice minus fees minus the forgone yield. */
  net_usd: number;
  /** The net per hands-on hour. */
  net_per_hour_usd: number;
  /** How long the position is held, in days. */
  hold_days: number;
  /** FARM at $5 or more net per hour, THIN at $0 to $5, SKIP below $0. */
  verdict: "FARM" | "THIN" | "SKIP";
  /** One line saying why the row sits where it does. */
  why: string;
  /** The seven concrete steps to farm the protocol. */
  farm_steps: string[];
}

/** A traded protocol, kept apart from the board: it prices the curve,
 * it is never ranked by implied value. */
export interface TradedRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  listed_at: string | null;
  /** True when the token is one of the comparables the line is fitted on. */
  in_fit: boolean;
}

/** A pre-token protocol the board sets aside, with the rule that
 * excluded it, so the reader can see nothing was dropped silently. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string;
  reason: string;
}

/** One out-of-sample test: the curve against a flat multiple. */
export interface ValidationTest {
  /** How many tokens the test scored. */
  n: number;
  /** The curve's median miss, as a multiple (1 is exact). */
  curve_median_miss: number;
  /** The share of tokens the curve lands within 3x of the real cap. */
  curve_within_3x: number;
  /** The share of tokens the curve lands within 10x of the real cap. */
  curve_within_10x: number;
  /** The flat multiple's median miss. */
  flat_median_miss: number;
  /** The share of tokens the flat multiple lands within 3x. */
  flat_within_3x: number;
  /** The share of tokens the flat multiple lands within 10x. */
  flat_within_10x: number;
}

/** Everything the page proves about its own model, computed here. */
export interface Validation {
  /** The comparables line, fitted at run time. */
  fit: { intercept: number; slope: number; r2: number; n: number; min_tvl_usd: number };
  /** Leave-one-out over the comparables. */
  loo: ValidationTest;
  /** Fit before 2024, tested on the tokens listed since. */
  time_split: ValidationTest & { train_n: number; test_n: number; unlisted_n: number };
  /** The bootstrap that built the per-row bands. */
  bootstrap: { refits: number; seed: number };
}

/** The counts the header strip shows, all computed from the snapshot. */
export interface BoardCounts {
  ranked: number;
  traded: number;
  set_aside: number;
  watchlist: number;
  early_finds: number;
  /** FARM rows at each plan capital, for the capital selector. */
  farm_at: { [capital: number]: number };
}

/** The snapshot file, as the kit's input directory holds it. */
export interface Snapshot {
  /** The snapshot date, YYYY-MM-DD. */
  as_of: string;
  /** Where the snapshot came from. */
  source: string;
  /** The TVL floor the snapshot was cut at, in dollars. */
  floor_usd: number;
  /** Every protocol in the snapshot. */
  protocols: Protocol[];
  /** The slugs the field guide calls out by name. */
  watchlist: string[];
}

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

/** One plan capital, in dollars, used everywhere: the steps, the slice,
// the forgone yield. A single number, so a plan can never disagree with
// itself about how much money it moves. */
export const PLAN_CAPITAL_USD = 1000;

/** The yield given up by parking the capital, per year, as a fraction.
// The T-bill rate: the risk-free return the $1,000 would earn elsewhere. */
export const TBILL_RATE = 0.04;

/** The smallest TVL a traded token needs to price the curve: $10M.
// Below that a token's market cap is mostly noise — a micro-cap's
// mcap/TVL ratio says little about what a launch is worth — so the
// fit uses the tokens big enough to read. */
export const FIT_MIN_TVL_USD = 10_000_000;

/** How many bootstrap refits build the per-row bands, and the seed
// that makes them deterministic: the same snapshot always gives the
// same bands. */
export const BOOTSTRAP_REFITS = 200;
export const BOOTSTRAP_SEED = 20261119;

/** The slice is a tenth of the protocol's implied value, pro-rated to
// the $1,000 deposit against its TVL: a plan that puts in a thousandth
// of a protocol's TVL earns a tenth of a thousandth of its value. */
export const SLICE_SHARE = 0.1;

/** The verdict line, in net dollars per hands-on hour. A plan that nets
// $5 an hour is worth doing; below $0 it loses money; between the two
// it is thin but not a loss. */
export const FARM_MIN_NET_PER_HOUR = 5;

/** Gas and fees, in dollars. $1 to open the fresh wallet, $2 to make
// the deposit, $1 to claim, and the weekly qualifying action's gas,
// which is priced by the chain the protocol lives on (see
// weeklyGasUsd): an L1 week costs $0.50, any other chain $0.05. */
export const FEE_OPEN_USD = 1;
export const FEE_DEPOSIT_USD = 2;
export const FEE_CLAIM_USD = 1;

/** The weekly gas, in dollars, by the protocol's first chain. A week
// on Ethereum or Bitcoin is L1 gas, about $0.50; a week anywhere else
// — an L2 or an alt-L1, where a swap costs cents — is $0.05. The
// steps name the chain's figure, so the plan's money and its words
// always agree. */
export const GAS_WEEKLY_L1_USD = 0.5;
export const GAS_WEEKLY_OTHER_USD = 0.05;

/** Hands-on time, in minutes. 5 to open the wallet, 15 to make the
// deposit, 10 to check the points page, 10 to claim, and 5 a week for
// the qualifying action — one swap or one check, a few minutes of
// hands-on time. The 5-minute farm log is written after the position
// closes, so it is not counted as hands-on time. */
export const MIN_OPEN = 5;
export const MIN_DEPOSIT = 15;
export const MIN_CHECK = 10;
export const MIN_CLAIM = 10;
export const MIN_WEEKLY = 5;

/** The hold, in days, by age: a protocol a year or older needs 45 days
// for its activity to be counted in more than one snapshot, six months
// to a year needs 60, and anything younger needs 90. */
export const HOLD_OLD_DAYS = 45;
export const HOLD_MID_DAYS = 60;
export const HOLD_YOUNG_DAYS = 90;

/** The age that separates the holds: 365 days for the old hold, 180
// days (six months) for the middle one. */
export const AGE_OLD_DAYS = 365;
export const AGE_MID_DAYS = 180;

/** The age a protocol with no listing date is treated as having, for
// the maturity and hold calculations only. Its age_days stays null on
// the row, and the "why" line says there is no listing date on record. */
export const AGE_UNKNOWN_DAYS = 365;

// ---------------------------------------------------------------------------
// Small numeric helpers
// ---------------------------------------------------------------------------

/** Round to cents, half up: the money on a row is always two decimals. */
export function round2(x: number): number {
  return Math.floor(x * 100 + 0.5) / 100;
}

/** Round to a whole dollar, half up. */
export function roundInt(x: number): number {
  return Math.floor(x + 0.5);
}

/** The median of a list of numbers. For an even count it is the mean of
// the two middle values, as a median is. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The q-th percentile of a list, nearest-rank: the value at
// floor(q * n), clamped into range. q is 0 to 1. */
export function percentile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[at]!;
}

/** A small deterministic generator (mulberry32): the bootstrap draws
// from it, so the same snapshot always gives the same refits. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The comparables curve and the per-category calibration
// ---------------------------------------------------------------------------

/** One fitted line: log10(market cap) = intercept + slope * log10(TVL). */
export interface FitLine {
  intercept: number;
  slope: number;
  r2: number;
  n: number;
}

/** The ordinary least-squares fit of log10(market cap) on log10(TVL)
// over the given points, each a [log10 TVL, log10 mcap] pair. */
export function fitLine(points: Array<[number, number]>): FitLine {
  const n = points.length;
  let mx = 0;
  let my = 0;
  for (const [x, y] of points) {
    mx += x;
    my += y;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let ssTot = 0;
  for (const [x, y] of points) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) * (x - mx);
    ssTot += (y - my) * (y - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (const [x, y] of points) {
    const d = y - (intercept + slope * x);
    ssRes += d * d;
  }
  return { intercept, slope, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot, n };
}

/** The comparables: the traded tokens big enough to price the curve —
// a market cap and a TVL, both positive, TVL at least $10M. */
export function fitSet(protocols: Protocol[]): Protocol[] {
  return protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= FIT_MIN_TVL_USD,
  );
}

/** Fit the line on the comparables, at run time, from the snapshot. */
export function fitCompsLine(protocols: Protocol[]): FitLine {
  const set = fitSet(protocols);
  return fitLine(
    set.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)]),
  );
}

/** The curve's prediction for a TVL: the market cap the line says a
// token would carry at that size. */
export function compsPrediction(tvlUsd: number, line: FitLine): number {
  return Math.pow(10, line.intercept + line.slope * Math.log10(tvlUsd));
}

/** The comparables base: the curve's prediction, rounded to a whole
// dollar. This is the number the model detail shows; the implied value
// is computed from the exact prediction, not from this rounded base. */
export function compsBase(tvlUsd: number, line: FitLine): number {
  return roundInt(compsPrediction(tvlUsd, line));
}

/** A category's calibration factor, fitted from the traded tokens of
// the snapshot at run time.
//
// For each traded token in the category, take log10 of its market cap
// over the curve's prediction: how far the token sits from the line, in
// log space. The factor is 10 to the power of the median of those logs,
// shrunk toward 1 by the count of traded tokens in the category:
//   factor = 10 ^ (median(log10(mcap / prediction)) * n / (n + 20)).
// A category with many traded tokens trusts its median; a category with
// few is pulled toward 1, because a median of two tokens says little.
// A category with no traded token at all takes 1: the curve, unadjusted. */
export function fitCategoryFactors(protocols: Protocol[], line: FitLine): Map<string, number> {
  const logsByCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const key = p.category ?? "";
    const list = logsByCategory.get(key) ?? [];
    list.push(Math.log10(p.mcap_usd / compsPrediction(p.tvl_usd, line)));
    logsByCategory.set(key, list);
  }
  const factors = new Map<string, number>();
  for (const [category, logs] of logsByCategory) {
    const n = logs.length;
    const shrunk = median(logs) * (n / (n + 20));
    factors.set(category, Math.pow(10, shrunk));
  }
  return factors;
}

/** Look a category's factor up in the fitted map, defaulting to 1 when
// the category has no traded token (or the snapshot gives no category). */
export function categoryFactor(category: string | null, factors: Map<string, number>): number {
  if (category === null) return 1;
  return factors.get(category) ?? 1;
}

// ---------------------------------------------------------------------------
// Eligibility: the field-guide rule
// ---------------------------------------------------------------------------

/** Categories that never make the board, whatever their size: bridges
// move value between chains rather than holding it, liquid-staking and
// restaking products wrap someone else's stake, a CEX is not a protocol
// a reader can farm, and a restaked-BTC product is the same idea again. */
const INELIGIBLE_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

/** An exchange's name at the start of a protocol's name means the row is
// the exchange itself, not a protocol to farm. */
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];

/** A version marker at the end of a name: a space, then V2, v2, 2.0 or
// the like. A versioned row is one release of a protocol, not the
// protocol itself, so it does not get its own place on the board. */
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A wrapped or staked product in the name: the row wraps someone else's
// asset rather than being a protocol in its own right. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A protocol makes the board when it is a pre-token protocol in its own
// right: it records no token (no CoinGecko id and no symbol), it is not a
// bridge, a liquid-staking or restaking product, a CEX or a wrapped or
// staked product, its name carries no version marker, and it does not
// begin with an exchange's name. */
export function isEligible(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && INELIGIBLE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

/** The rule that kept a pre-token protocol off the board, in the order
// the rules are checked: category first, then the version marker, then
// the wrapped word, then the exchange prefix. The set-aside tab shows
// this reason beside each row, so nothing is dropped silently. */
export function setAsideReason(p: Protocol): string {
  if (p.category !== null && INELIGIBLE_CATEGORIES.has(p.category)) {
    return `category ${p.category} never boards`;
  }
  if (VERSION_SUFFIX.test(p.name)) return "versioned release, not the protocol itself";
  if (WRAPPED_WORD.test(p.name)) return "wrapped or staked product of another asset";
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return "the exchange itself, not a farmable protocol";
  }
  return "no token, but the field guide sets it aside";
}

// ---------------------------------------------------------------------------
// The valuation
// ---------------------------------------------------------------------------

/** Days from a listing date (YYYY-MM-DD) to the snapshot date. A protocol
// the snapshot gives no listed date for has no age on record, so this
// returns null; the maturity and hold calculations treat that as a year
// old, and the row keeps age_days null. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** A protocol's age tempers its value: 0.6 at launch, rising linearly to
// 1.0 at three years (1,095 days), and 1.0 after that. A young protocol
// is worth less than the curve says, because its launch is further off
// and less certain; an old one is worth the full curve value. A protocol
// with no listing date on record is treated as a year old. */
export function maturityMultiplier(age: number | null): number {
  const effective = age === null ? AGE_UNKNOWN_DAYS : age;
  return Math.min(1, 0.6 + (effective * 0.4) / 1095);
}

/** Breadth pays: the first chain is free, then 3% for each additional
// chain, up to ten extra chains. A protocol live on many chains reaches
// more users, so its launch is worth more than a single-chain one. */
export function breadthMultiplier(chains: string[]): number {
  const extra = Math.min(Math.max(0, chains.length - 1), 10);
  return 1 + 0.03 * extra;
}

/** The 7-day move, clamped so one wild week cannot run the board: no
// lower than -60%, no higher than +120%. A protocol with no reported
// move counts as flat, at 0%. */
export function growthPct(change7d: number | null): number {
  if (change7d === null) return 0;
  return Math.max(-60, Math.min(120, change7d));
}

/** Half the week's move, as a multiplier on value: a protocol up 10% in
// a week is worth 5% more, one down 10% is worth 5% less. Only half the
// move, because a single week is noise as much as signal. */
export function growthMultiplier(growth: number): number {
  return 1 + growth * 0.005;
}

/** A strong move in either direction is momentum: a tenth either way
// past a 20% week, nothing inside it. The raw 7-day change decides it,
// not the clamped growth, so a 25% week and a 150% week both read +0.1.
// Momentum is a separate factor on the implied value; it does not enter
// the growth multiplier, which stays half the move. */
export function momentum(change7d: number | null): number {
  if (change7d === null) return 0;
  if (change7d > 20) return 0.1;
  if (change7d < -20) return -0.1;
  return 0;
}

/** The implied value: what the protocol's token would be worth at
// launch. The curve's exact prediction, calibrated by its category,
// moved by the week's growth and momentum, tempered by its age, widened
// by its breadth, rounded to a whole dollar. The multiplication uses
// the exact curve prediction, not the rounded base the detail records:
// rounding first would throw away a dollar here and there and the
// implied values would drift. */
export function impliedValue(
  p: Protocol,
  asOf: string,
  line: FitLine,
  factors: Map<string, number>,
): { value: number; detail: ModelDetail } {
  const age = ageDays(p.listed_at, asOf);
  const growth = growthPct(p.change_7d);
  const mom = momentum(p.change_7d);
  const detail: ModelDetail = {
    comps_base_usd: compsBase(p.tvl_usd, line),
    category_factor: categoryFactor(p.category, factors),
    growth_pct: growth,
    growth_multiplier: growthMultiplier(growth),
    momentum: mom,
    maturity_multiplier: maturityMultiplier(age),
    breadth_multiplier: breadthMultiplier(p.chains),
    age_days: age,
    weekly_gas_usd: weeklyGasUsd(p.chains[0] ?? "Ethereum"),
  };
  const value = roundInt(
    compsPrediction(p.tvl_usd, line) *
      detail.category_factor *
      detail.growth_multiplier *
      (1 + mom) *
      detail.maturity_multiplier *
      detail.breadth_multiplier,
  );
  return { value, detail };
}

// ---------------------------------------------------------------------------
// Out-of-sample validation: leave-one-out and the time split
// ---------------------------------------------------------------------------

/** The miss of one prediction against the real market cap: the larger
// of prediction over real and real over prediction, so 1 is exact and
// 3 means three times off either way. */
function miss(pred: number, real: number): number {
  return Math.max(pred / real, real / pred);
}

/** Summarise a list of misses: the median, and the share within 3x and
// within 10x of the real cap. */
function missStats(misses: number[]): { median_miss: number; within_3x: number; within_10x: number } {
  const n = misses.length;
  return {
    median_miss: median(misses),
    within_3x: n === 0 ? 0 : misses.filter((m) => m <= 3).length / n,
    within_10x: n === 0 ? 0 : misses.filter((m) => m <= 10).length / n,
  };
}

/** Leave-one-out over the comparables: hold each traded token out in
// turn, refit the line without it, ask for its market cap, and score
// the miss — and do the same for a flat mcap/TVL multiple (the median
// ratio of the tokens left in), so the reader can see what the curve
// buys over the simplest possible model. */
export function looValidation(protocols: Protocol[]): ValidationTest {
  const set = fitSet(protocols);
  const curveMisses: number[] = [];
  const flatMisses: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const held = set[i]!;
    const rest = set.filter((_, j) => j !== i);
    const line = fitLine(
      rest.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)]),
    );
    curveMisses.push(miss(compsPrediction(held.tvl_usd, line), held.mcap_usd as number));
    const ratio = median(rest.map((p) => (p.mcap_usd as number) / p.tvl_usd));
    flatMisses.push(miss(ratio * held.tvl_usd, held.mcap_usd as number));
  }
  const c = missStats(curveMisses);
  const f = missStats(flatMisses);
  return {
    n: set.length,
    curve_median_miss: c.median_miss,
    curve_within_3x: c.within_3x,
    curve_within_10x: c.within_10x,
    flat_median_miss: f.median_miss,
    flat_within_3x: f.within_3x,
    flat_within_10x: f.within_10x,
  };
}

/** The time split: fit the line on the comparables listed before 2024
// and test it on the ones listed since — the model is asked about
// tokens it could not have seen, the way a launch radar is. Tokens
// with no listing date sit out the split, and the count says so. The
// flat multiple is the median ratio of the training tokens. */
export function timeSplitValidation(protocols: Protocol[]): ValidationTest & {
  train_n: number;
  test_n: number;
  unlisted_n: number;
} {
  const set = fitSet(protocols);
  const train = set.filter((p) => p.listed_at !== null && p.listed_at < "2024-01-01");
  const test = set.filter((p) => p.listed_at !== null && p.listed_at >= "2024-01-01");
  const unlisted = set.filter((p) => p.listed_at === null).length;
  const line = fitLine(
    train.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)]),
  );
  const ratio = median(train.map((p) => (p.mcap_usd as number) / p.tvl_usd));
  const curveMisses = test.map((p) => miss(compsPrediction(p.tvl_usd, line), p.mcap_usd as number));
  const flatMisses = test.map((p) => miss(ratio * p.tvl_usd, p.mcap_usd as number));
  const c = missStats(curveMisses);
  const f = missStats(flatMisses);
  return {
    n: test.length,
    train_n: train.length,
    test_n: test.length,
    unlisted_n: unlisted,
    curve_median_miss: c.median_miss,
    curve_within_3x: c.within_3x,
    curve_within_10x: c.within_10x,
    flat_median_miss: f.median_miss,
    flat_within_3x: f.within_3x,
    flat_within_10x: f.within_10x,
  };
}

// ---------------------------------------------------------------------------
// The bootstrap bands
// ---------------------------------------------------------------------------

/** The per-row band from the bootstrap refits: the 10th and 90th
// percentile of the row's implied value, and the best and worst rank
// it takes. A row whose band is narrow and whose rank barely moves is
// a claim the model stands behind; a wide band says so plainly. */
export interface BootstrapBand {
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
}

/** Price every eligible protocol off one fitted line and its category
// factors, returning the implied value per slug. Shared by the board
// build and the bootstrap, so a refit prices exactly the way the board
// does. */
function priceAll(
  eligible: Protocol[],
  asOf: string,
  line: FitLine,
  factors: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of eligible) {
    const { value } = impliedValue(p, asOf, line, factors);
    out.set(p.slug, value);
  }
  return out;
}

/** The bootstrap: resample the comparables with replacement, refit the
// line, recalibrate the category factors against it, and reprice every
// eligible protocol — 200 times, on a fixed seed, so the same snapshot
// always gives the same bands. The line moves, the factors move with
// it, and each row's band is what survives that movement. */
export function bootstrapBands(
  eligible: Protocol[],
  protocols: Protocol[],
  asOf: string,
): Map<string, BootstrapBand> {
  const set = fitSet(protocols);
  const rng = mulberry32(BOOTSTRAP_SEED);
  const values = new Map<string, number[]>();
  const ranks = new Map<string, number[]>();
  for (const p of eligible) {
    values.set(p.slug, []);
    ranks.set(p.slug, []);
  }
  for (let r = 0; r < BOOTSTRAP_REFITS; r++) {
    const sample: Protocol[] = [];
    for (let i = 0; i < set.length; i++) {
      sample.push(set[Math.floor(rng() * set.length)]!);
    }
    const line = fitLine(
      sample.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)]),
    );
    const factors = fitCategoryFactors(protocols, line);
    const priced = priceAll(eligible, asOf, line, factors);
    const ordered = [...priced.entries()].sort((a, b) => b[1] - a[1]);
    ordered.forEach(([slug, value], i) => {
      values.get(slug)!.push(value);
      ranks.get(slug)!.push(i + 1);
    });
  }
  const bands = new Map<string, BootstrapBand>();
  for (const p of eligible) {
    const vs = values.get(p.slug)!;
    const rs = ranks.get(p.slug)!;
    bands.set(p.slug, {
      p10_usd: roundInt(percentile(vs, 0.1)),
      p90_usd: roundInt(percentile(vs, 0.9)),
      rank_lo: Math.min(...rs),
      rank_hi: Math.max(...rs),
    });
  }
  return bands;
}

// ---------------------------------------------------------------------------
// The farm plan
// ---------------------------------------------------------------------------

/** The weekly gas on a chain, in dollars: L1 gas on Ethereum and
// Bitcoin, cents everywhere else. */
export function weeklyGasUsd(chain: string): number {
  return chain === "Ethereum" || chain === "Bitcoin" ? GAS_WEEKLY_L1_USD : GAS_WEEKLY_OTHER_USD;
}

/** How long a position is held, in days: the younger the protocol, the
// longer the hold, so the activity is counted in more than one snapshot.
// A year or older holds 45 days, six months to a year holds 60, younger
// holds 90. A protocol with no listing date is treated as a year old,
// so it holds 45 days. */
export function holdDays(age: number | null): number {
  const effective = age === null ? AGE_UNKNOWN_DAYS : age;
  if (effective >= AGE_OLD_DAYS) return HOLD_OLD_DAYS;
  if (effective >= AGE_MID_DAYS) return HOLD_MID_DAYS;
  return HOLD_YOUNG_DAYS;
}

/** What the plan costs in gas and fees: the open, the deposit and the
// claim, plus the weekly qualifying action's gas for every week of the
// hold, priced by the chain. Rounded to cents. */
export function feesUsd(hold: number, chain: string): number {
  const total =
    FEE_OPEN_USD + FEE_DEPOSIT_USD + FEE_CLAIM_USD + (weeklyGasUsd(chain) * hold) / 7;
  return round2(total);
}

/** The yield forgone by parking the capital: the T-bill rate, pro-rated
// to the hold and to the capital. This one is not rounded on its own;
// the net rounds after it is subtracted. */
export function forgoneUsd(hold: number, capital: number): number {
  return (capital * TBILL_RATE * hold) / 365;
}

/** Hands-on hours: the fixed setup and checks, plus the weekly action.
// The fixed part is 5 + 15 + 10 + 10 = 40 minutes; the weekly part is
// 5 minutes for every week of the hold. */
export function hoursFor(hold: number): number {
  const minutes = MIN_OPEN + MIN_DEPOSIT + MIN_CHECK + MIN_CLAIM + (MIN_WEEKLY * hold) / 7;
  return minutes / 60;
}

/** The verdict from the net per hour: FARM at $5 or more, THIN from $0
// up to $5, SKIP below $0. A plan that loses money per hour is skipped;
// one that pays less than $5 an hour is thin but not a loss. */
export function verdictFor(netPerHour: number): "FARM" | "THIN" | "SKIP" {
  if (netPerHour >= FARM_MIN_NET_PER_HOUR) return "FARM";
  if (netPerHour >= 0) return "THIN";
  return "SKIP";
}

/** The slice a plan would earn at a given capital: a tenth of the
// implied value, pro-rated to the deposit against the protocol's TVL,
// rounded to cents. */
export function sliceUsd(impliedValueUsd: number, tvlUsd: number, capital: number): number {
  return round2((SLICE_SHARE * impliedValueUsd * capital) / tvlUsd);
}

/** The net: the slice, minus the fees, minus the forgone yield, rounded
// to cents. The slice and the fees are already rounded to cents when
// they go in; the forgone yield is exact, and the rounding happens once,
// at the end. */
export function netUsd(slice: number, fees: number, hold: number, capital: number): number {
  return round2(slice - fees - forgoneUsd(hold, capital));
}

/** The net per hands-on hour, rounded to cents. */
export function netPerHourUsd(net: number, hold: number): number {
  return round2(net / hoursFor(hold));
}

/** Re-net one row's plan at another capital: the slice and the forgone
// yield scale with the capital, the fees and the hours do not. The
// page uses this for the capital selector, and the board build uses it
// for the FARM counts at each capital — one formula, both places, so
// the page can never disagree with the board. */
export function renetAtCapital(
  row: Pick<BoardRow, "implied_value_usd" | "tvl_usd" | "fees_usd" | "hold_days">,
  capital: number,
): { slice_usd: number; net_usd: number; net_per_hour_usd: number; verdict: "FARM" | "THIN" | "SKIP" } {
  const slice = sliceUsd(row.implied_value_usd, row.tvl_usd, capital);
  const net = netUsd(slice, row.fees_usd, row.hold_days, capital);
  const perHour = netPerHourUsd(net, row.hold_days);
  return { slice_usd: slice, net_usd: net, net_per_hour_usd: perHour, verdict: verdictFor(perHour) };
}

// ---------------------------------------------------------------------------
// Presentation: the "why" line and the farm steps
// ---------------------------------------------------------------------------

/** Format a TVL for the "why" line: billions with two decimals, millions
// with one, thousands with one, anything smaller as a whole number. */
export function formatTvl(tvl: number): string {
  if (tvl >= 1_000_000_000) return `$${(tvl / 1_000_000_000).toFixed(2)}B`;
  if (tvl >= 1_000_000) return `$${(tvl / 1_000_000).toFixed(1)}M`;
  if (tvl >= 1_000) return `$${(tvl / 1_000).toFixed(1)}K`;
  return `$${tvl.toFixed(0)}`;
}

/** Format a percent for the "why" line: the absolute value with one
// decimal, the sign carried by the word before it ("growing" or "down"). */
export function formatPct(pct: number): string {
  return `${Math.abs(pct).toFixed(1)}%`;
}

/** The one-line reason a row sits where it does: its size, its place
// among the pre-token protocols of its own category by TVL, its age (or
// that no listing date is on record), its chains, and its week's move.
// The rank and count are counted over the board itself, so a row's
// place is its place among the protocols the reader is looking at. */
export function whyText(
  p: Protocol,
  age: number | null,
  categoryRank: number,
  categoryCount: number,
): string {
  const parts: string[] = [];
  parts.push(`${formatTvl(p.tvl_usd)} of TVL`);
  parts.push(`#${categoryRank} of ${categoryCount} pre-token ${p.category} by TVL`);
  if (age === null) {
    parts.push("no listing date on record");
  } else {
    parts.push(`${age} days with no token`);
  }
  if (p.chains.length === 1) {
    parts.push("single-chain");
  } else {
    parts.push(`live on ${p.chains.length} chains`);
  }
  if (p.change_7d !== null) {
    if (p.change_7d >= 0) {
      parts.push(`growing ${formatPct(p.change_7d)} in 7 days`);
    } else {
      parts.push(`down ${formatPct(p.change_7d)} in 7 days`);
    }
  }
  return parts.join("; ") + ".";
}

// ---------------------------------------------------------------------------
// Plan variety: the steps are written for the protocol, not the category
// ---------------------------------------------------------------------------

/** The week's direction: rising past +5%, falling past -5%, flat
// between them (or unreported). The weekly action and the points check
// both read it, so a rising protocol's plan does not read like a
// falling one's. */
export type Trend = "rising" | "falling" | "flat";

export function trendOf(change7d: number | null): Trend {
  if (change7d === null) return "flat";
  if (change7d > 5) return "rising";
  if (change7d < -5) return "falling";
  return "flat";
}

/** The size tier: large at $500M of TVL or more, small below $100M,
// mid between them. The deposit step reads it, so a small protocol's
// plan does not read like a large one's. */
export type Tier = "large" | "mid" | "small";

export function tierOf(tvlUsd: number): Tier {
  if (tvlUsd >= 500_000_000) return "large";
  if (tvlUsd < 100_000_000) return "small";
  return "mid";
}

/** Whether the protocol is new: listed under 180 days ago. A new
// protocol's weekly action watches for its first points snapshot. */
export function isNew(age: number | null): boolean {
  return age !== null && age < 180;
}

/** The deposit step, worded for what the protocol actually is and how
// big it is. A vault takes a deposit into a vault, a DEX takes
// liquidity into its main pool, a lender takes a supply, a derivatives
// venue takes margin, an insurer sells cover, a stablecoin wrapper
// mints the stable asset, an RWA protocol mints its yield asset, a
// staking pool takes the chain's staking asset, and a prediction market
// takes a funded position. The default, for a category with no special
// wording, is a plain deposit of USDC. A large protocol's position is
// kept open through the next snapshot; a small one's while the program
// is still small. Every variant costs the same $1,000 of capital and
// about $2 of gas, and takes 15 minutes to set up. */
export function depositStep(name: string, category: string, chain: string, tier: Tier): string {
  const tail = "Cost: $1000 of capital and about $2 of gas. Time: 15 minutes to set up.";
  const keep =
    tier === "large"
      ? "and keep the position open through the next snapshot"
      : tier === "small"
        ? "and keep the position open while the program is still small"
        : "and keep the position open";
  switch (category) {
    case "Dexs":
    case "Indexes":
    case "Leveraged Farming":
    case "Yield":
    case "Yield Aggregator":
      return `Provide $1000 of liquidity to ${name}'s main pool on ${chain} ${keep}. ${tail}`;
    case "Derivatives":
    case "Interest Rate Derivatives":
      return `Deposit $1000 of USDC as margin on ${name} ${keep}. ${tail}`;
    case "CDP":
    case "Collateral Markets":
    case "Lending":
    case "Uncollateralized Lending":
      return `Supply $1000 of USDC to ${name} on ${chain} ${keep}. ${tail}`;
    case "Dual-Token Stablecoin":
    case "Stablecoin Wrapper":
      return `Mint or deposit $1000 of the stable asset through ${name} on ${chain} ${keep}. ${tail}`;
    case "Insurance":
      return `Buy $1000 of cover from ${name} on ${chain} ${keep}. ${tail}`;
    case "Onchain Capital Allocator":
    case "Risk Curators":
      return `Deposit $1000 into a ${name} vault on ${chain} ${keep}. ${tail}`;
    case "Prediction Market":
      return `Fund $1000 and place one market position on ${name} ${keep}. ${tail}`;
    case "RWA":
      return `Mint $1000 of the protocol's yield asset on ${chain} ${keep}. ${tail}`;
    case "Restaking":
    case "Staking Pool":
      return `Stake $1000 of the chain's staking asset through ${name} ${keep}. ${tail}`;
    default:
      return `Deposit $1000 of USDC into ${name} on ${chain} ${keep}. ${tail}`;
  }
}

/** The weekly qualifying action, worded for what the protocol actually
// is, which way its week went, how big it is and whether it is new:
// one concrete action with an amount, not a choice of actions. A DEX
// gets a swap through its pool, a lender gets a borrow-and-repay, a
// vault gets its rewards claimed and restaked, a stablecoin wrapper
// gets a mint, and so on — and the second sentence reads the
// protocol's own week: a rising one adds $25 while the move is up, a
// falling one checks the pool before each action, a large one keeps
// the action small next to its size, a small one does it every week
// while the program is small, a new one watches for the first points
// snapshot. Every variant costs the same weekly gas on its chain and
// takes 5 minutes a week, so the action is the only thing that
// changes — the plan's money never moves. */
export function weeklyStep(
  name: string,
  category: string,
  chain: string,
  trend: Trend,
  tier: Tier,
  ageIsNew: boolean,
): string {
  const gas = weeklyGasUsd(chain);
  const gasText = gas >= 0.5 ? "$0.50" : "$0.05";
  const tail = `Cost: about ${gasText} of gas a week on ${chain}. Time: 5 minutes a week.`;
  const second =
    trend === "rising"
      ? "Do it while the week's move is up, and add another $25 when the pool grows."
      : trend === "falling"
        ? "Check the pool's TVL before each action, and keep the amount at $25 when it falls."
        : tier === "large"
          ? "Keep the action small next to the protocol's size."
          : tier === "small"
            ? "Do it every week while the program is small, so the wallet is counted early."
            : ageIsNew
              ? "Watch for the points program's first snapshot while you do it."
              : "Do it every week so the wallet stays active.";
  switch (category) {
    case "Dexs":
    case "Indexes":
    case "Leveraged Farming":
    case "Yield":
    case "Yield Aggregator":
      return `Swap $25 of USDC through ${name}'s main pool on ${chain} each week. ${second} ${tail}`;
    case "Derivatives":
    case "Interest Rate Derivatives":
      return `Open one small hedge on ${name} each week and close it the same day. ${second} ${tail}`;
    case "CDP":
    case "Collateral Markets":
    case "Lending":
    case "Uncollateralized Lending":
      return `Borrow $50 of USDC against the supply on ${name} each week and repay it the same day. ${second} ${tail}`;
    case "Dual-Token Stablecoin":
    case "Stablecoin Wrapper":
      return `Mint $25 of the stable asset through ${name} on ${chain} each week and hold it. ${second} ${tail}`;
    case "Insurance":
      return `Check the cover on ${name} each week and top it up by $25 when the policy needs it. ${second} ${tail}`;
    case "Onchain Capital Allocator":
    case "Risk Curators":
      return `Claim the vault's rewards on ${name} each week and restake them into the same vault. ${second} ${tail}`;
    case "Prediction Market":
      return `Place one $25 position on a ${name} market each week and settle it when it closes. ${second} ${tail}`;
    case "RWA":
      return `Check the yield asset's accrual on ${name} each week and add $25 when it pays out. ${second} ${tail}`;
    case "Restaking":
    case "Staking Pool":
      return `Restake the staking rewards through ${name} each week so the receipt keeps growing. ${second} ${tail}`;
    default:
      return `Deposit another $25 into ${name} on ${chain} each week. ${second} ${tail}`;
  }
}

/** What the points check looks at, by what the protocol is: the pool
// position, the supply, the vault shares, the margin account, the
// minted balance, the policy, the market position, the yield asset or
// the staked receipt. The check is the same everywhere — open the
// protocol's points page, confirm the position is active and earning
// points, pay nothing to check — but the thing being checked is the
// protocol's own, and the closing clause reads its week: a falling
// protocol's check watches whether the position is still falling, a
// rising one's notes how the points total grows. A category with no
// special wording falls back to checking the wallet itself. */
export function checkStep(name: string, category: string, trend: Trend): string {
  const tail = "Cost: no fee to check, and never pay to claim. Time: 10 minutes.";
  const close =
    trend === "falling"
      ? " Watch whether the position is still falling before you withdraw anything."
      : trend === "rising"
        ? " Note how the points total grows while the week is up."
        : " Confirm it shows as active and earning points before you withdraw anything.";
  switch (category) {
    case "Dexs":
    case "Indexes":
    case "Leveraged Farming":
    case "Yield":
    case "Yield Aggregator":
      return `Open ${name}'s points page and check the pool position shows as active and earning points.${close} ${tail}`;
    case "Derivatives":
    case "Interest Rate Derivatives":
      return `Open ${name}'s points page and check the margin account shows as active and earning points.${close} ${tail}`;
    case "CDP":
    case "Collateral Markets":
    case "Lending":
    case "Uncollateralized Lending":
      return `Open ${name}'s points page and check the supply shows as active and earning points.${close} ${tail}`;
    case "Dual-Token Stablecoin":
    case "Stablecoin Wrapper":
      return `Open ${name}'s points page and check the minted balance shows as active and earning points.${close} ${tail}`;
    case "Insurance":
      return `Open ${name}'s points page and check the policy shows as active and earning points.${close} ${tail}`;
    case "Onchain Capital Allocator":
    case "Risk Curators":
      return `Open ${name}'s points page and check the vault shares show as active and earning points.${close} ${tail}`;
    case "Prediction Market":
      return `Open ${name}'s points page and check the market position shows as active and earning points.${close} ${tail}`;
    case "RWA":
      return `Open ${name}'s points page and check the yield asset shows as active and earning points.${close} ${tail}`;
    case "Restaking":
    case "Staking Pool":
      return `Open ${name}'s points page and check the staked receipt shows as active and earning points.${close} ${tail}`;
    default:
      return `Open ${name}'s own points or rewards page and check the wallet is earning points.${close} ${tail}`;
  }
}

/** The seven concrete steps to farm a protocol: a fresh wallet on its
// first chain, a $1,000 deposit worded for what the protocol is and
// how big it is, one concrete weekly action with an amount that reads
// the protocol's own week, the hold, the points check on the
// protocol's own position, the claim from the protocol's own link, and
// the farm log. Every step names its cost and its time, and the
// deposit, the weekly action and the check are written for the
// protocol — its kind, its size, its week, its age — so no two kinds
// of protocol share a plan. */
export function farmSteps(
  name: string,
  category: string,
  chain: string,
  hold: number,
  change7d: number | null,
  tvlUsd: number,
  age: number | null,
): string[] {
  const trend = trendOf(change7d);
  const tier = tierOf(tvlUsd);
  const fresh = isNew(age);
  return [
    `Open a fresh wallet on ${chain} that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: about $1 of gas for the first transaction. Time: 5 minutes.`,
    depositStep(name, category, chain, tier),
    weeklyStep(name, category, chain, trend, tier, fresh),
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $1000 stays in the position. Time: ${hold} days.`,
    checkStep(name, category, trend),
    `Before you withdraw, claim only from the link the protocol itself publishes, never from a link in a message or a search result. Cost: the claim gas only. Time: 10 minutes.`,
    `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it. Cost: nothing but the log. Time: 5 minutes.`,
  ];
}

// ---------------------------------------------------------------------------
// The board
// ---------------------------------------------------------------------------

/** Group the eligible protocols by category, each group sorted by TVL
// descending, so a row's "why" can say where it stands among its own
// kind. The key is the category, or "" when the snapshot gives none. */
function groupByCategory(protocols: Protocol[]): Map<string, Protocol[]> {
  const byCategory = new Map<string, Protocol[]>();
  for (const p of protocols) {
    const key = p.category ?? "";
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.tvl_usd - a.tvl_usd);
  }
  return byCategory;
}

/** Everything the board build returns: the ranked rows, the validation
// the page proves, the counts the header shows, and the two lists the
// tabs show — the traded protocols kept apart, and the pre-token ones
// set aside with their reasons. */
export interface BuiltBoard {
  rows: BoardRow[];
  validation: Validation;
  counts: BoardCounts;
  traded: TradedRow[];
  setAside: SetAsideRow[];
}

/** The capitals the page lets the reader re-net at, and the board
// counts FARM at. The $1,000 plan is the board's own capital; the
// others are views of the same rows. */
export const PLAN_CAPITALS = [1000, 2500, 5000, 10000];

/** Build the board: every eligible protocol, priced off the curve the
// program fits at run time, ranked by implied value, each with its
// bootstrap band, its netted farm plan and verdict.
//
// The steps, in order: keep only the eligible protocols; fit the
// comparables line on the snapshot's traded tokens; fit the category
// factors; test the line leave-one-out and on the time split;
// bootstrap the per-row bands; group the eligible protocols by
// category for the "why" lines; price each one and net its plan; sort
// by implied value, largest first; assign ranks 1..N in that order;
// count the FARM rows at each plan capital; list the traded protocols
// kept apart and the pre-token ones set aside. */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const eligible = snapshot.protocols.filter(isEligible);
  const line = fitCompsLine(snapshot.protocols);
  const factors = fitCategoryFactors(snapshot.protocols, line);
  const loo = looValidation(snapshot.protocols);
  const timeSplit = timeSplitValidation(snapshot.protocols);
  const bands = bootstrapBands(eligible, snapshot.protocols, snapshot.as_of);
  const byCategory = groupByCategory(eligible);

  const rows: BoardRow[] = eligible.map((p) => {
    const { value, detail } = impliedValue(p, snapshot.as_of, line, factors);
    const age = detail.age_days;
    const hold = holdDays(age);
    const chain = p.chains[0] ?? "Ethereum";
    const slice = sliceUsd(value, p.tvl_usd, PLAN_CAPITAL_USD);
    const fees = feesUsd(hold, chain);
    const net = netUsd(slice, fees, hold, PLAN_CAPITAL_USD);
    const netPerHour = netPerHourUsd(net, hold);
    const category = p.category ?? "";
    const list = byCategory.get(category) ?? [];
    const categoryRank = list.findIndex((q) => q.slug === p.slug) + 1;
    const band = bands.get(p.slug)!;
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: "pre-token",
      age_days: age,
      implied_value_usd: value,
      implied_p10_usd: band.p10_usd,
      implied_p90_usd: band.p90_usd,
      rank_lo: band.rank_lo,
      rank_hi: band.rank_hi,
      model: detail,
      slice_1k_usd: slice,
      fees_usd: fees,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      hold_days: hold,
      verdict: verdictFor(netPerHour),
      why: whyText(p, age, categoryRank, list.length),
      farm_steps: farmSteps(p.name, category, chain, hold, p.change_7d, p.tvl_usd, age),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });

  const watchlist = new Set(snapshot.watchlist);
  const earlyFinds = rows.filter(
    (r) =>
      !watchlist.has(r.slug) &&
      ((r.age_days !== null && r.age_days <= 180) || (r.change_7d !== null && r.change_7d > 0)),
  ).length;

  const farmAt: { [capital: number]: number } = {};
  for (const capital of PLAN_CAPITALS) {
    farmAt[capital] = rows.filter((r) => renetAtCapital(r, capital).verdict === "FARM").length;
  }

  const traded: TradedRow[] = snapshot.protocols
    .filter((p) => p.gecko_id !== null || p.symbol !== null)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? "",
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      in_fit:
        p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd >= FIT_MIN_TVL_USD,
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const setAside: SetAsideRow[] = snapshot.protocols
    .filter((p) => p.gecko_id === null && p.symbol === null && !isEligible(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? "",
      reason: setAsideReason(p),
    }))
    .sort((a, b) => b.name.localeCompare(a.name));

  return {
    rows,
    validation: {
      fit: {
        intercept: line.intercept,
        slope: line.slope,
        r2: line.r2,
        n: line.n,
        min_tvl_usd: FIT_MIN_TVL_USD,
      },
      loo,
      time_split: timeSplit,
      bootstrap: { refits: BOOTSTRAP_REFITS, seed: BOOTSTRAP_SEED },
    },
    counts: {
      ranked: rows.length,
      traded: traded.length,
      set_aside: setAside.length,
      watchlist: snapshot.watchlist.length,
      early_finds: earlyFinds,
      farm_at: farmAt,
    },
    traded,
    setAside,
  };
}

// ---------------------------------------------------------------------------
// Notes on the fit
// ---------------------------------------------------------------------------
//
// THE COMPARABLES LINE. It is fitted here, at run time, by
// fitCompsLine: ordinary least squares of log10(market cap) on
// log10(TVL) over the traded tokens with TVL of $10M or more. The
// $10M floor keeps micro-caps out of the fit — a token too small to
// read says little about what a launch is worth. Nothing about the
// line is written down in advance: the same program on another
// snapshot would fit another line.
//
// THE CATEGORY FACTORS. They are fitted at run time by
// fitCategoryFactors: for each traded token in a category, log10 of
// its market cap over the curve's prediction, the median of those
// logs, shrunk by n / (n + 20) where n is the count of traded tokens
// in the category, raised to 10. A category with many traded tokens
// trusts its median; a category with few is pulled toward 1; a
// category with none takes 1. The shrinkage is what keeps a two-token
// category from dragging the whole board after itself.
//
// THE VALIDATION. Two out-of-sample tests, both computed here. The
// leave-one-out test holds each comparable out in turn, refits the
// line without it, and asks for its market cap; the time split fits
// the line on the comparables listed before 2024 and tests it on the
// ones listed since. Each is scored against the same flat mcap/TVL
// multiple, so the reader can see what the curve buys. The bootstrap
// resamples the comparables 200 times on a fixed seed, refits the
// line, recalibrates the category factors against it, and reprices
// every row: the P10–P90 band and the rank range on each row are what
// survives that movement.
//
// THE MOMENTUM. It is a separate factor on the implied value,
// (1 + momentum), not part of the growth multiplier. The growth
// multiplier is half the week's move; the momentum is a tenth either
// way past a 20% week. A protocol up 25% in a week gets both: its
// growth multiplier is 1.125 and its momentum factor is 1.1. The two
// are kept apart in the model detail so the dashboard can show each
// one on its own.
//
// THE IMPLIED VALUE. It is computed from the curve's exact prediction,
// not from the rounded comparables base the detail records. Rounding
// the base first and then multiplying throws away a dollar here and
// there. The base is still recorded, rounded, in the model detail,
// because the dashboard shows it.
//
// THE HOLD. 45 days at a year or older, 60 days at six months to a
// year, 90 days younger — and the six-month line is 180 days, not 182.
// A protocol with no listing date is treated as a year old for the
// hold and the maturity, but its age_days stays null and its why line
// says so.
//
// THE FEES. $1 to open the wallet, $2 to deposit, $1 to claim, and the
// weekly qualifying action's gas, priced by the chain: $0.50 a week on
// Ethereum and Bitcoin, where a transaction is L1 gas, and $0.05 a
// week everywhere else, where a swap costs cents. The steps name the
// chain's figure, so the plan's money and its words always agree.
//
// THE HOURS. 5 minutes to open the wallet, 15 to deposit, 10 to check
// the points page, 10 to claim, and 5 minutes a week for the
// qualifying action — one swap or one check, a few minutes of hands-on
// time. The farm log's 5 minutes are written after the position
// closes and are not counted.
//
// THE NET. The slice and the fees are rounded to cents first, then the
// net is the rounded slice minus the rounded fees minus the exact
// forgone yield, rounded to cents once at the end. The forgone yield
// is the T-bill rate, 4% a year, pro-rated to the hold and to the
// capital.
//
// THE NET PER HOUR. The net (rounded) divided by the hands-on hours,
// (40 + 5·hold/7) / 60, rounded to cents. A plan that nets $5 an hour
// or more is FARM, $0 to $5 is THIN, below $0 is SKIP.
//
// THE BOARD SIZE. The eligibility rule admits 198 protocols; 144
// pre-token protocols are set aside by the rule, each with its reason
// on the set-aside tab, and 416 traded protocols are kept apart on
// their own tab. 198 + 416 + 144 = 758, the whole snapshot. The 20
// rows past the reference board's 178 pass the field-guide rule and no
// field in the snapshot separates them, so they stay; under the
// cheaper weekly gas and the five weekly minutes, three of them are
// FARM (Extended Perps, IPOR Fusion and Solv Strategies), the rest
// THIN or SKIP.
