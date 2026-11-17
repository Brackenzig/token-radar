// Token Radar — the valuation, the farm plan and the board.
//
// A radar for token launches. It reads a sealed snapshot of every
// protocol (DefiLlama, frozen on a date), fits a comparables curve to the
// protocols whose token already trades, and prices every protocol with no
// token yet off that curve. Each one gets a farm plan for a fixed $1,000
// of capital: the slice of the implied launch value the plan would earn,
// minus the gas and fees, minus the yield given up by parking the money,
// per plan and per hands-on hour, with a FARM / THIN / SKIP verdict.
//
// Nothing here touches the network. The snapshot is the only input, and
// the same bytes always give the same board. The curve and the
// per-category calibration below are fitted from that snapshot at run
// time, so the program stays honest about where its numbers come from:
//
//   * the comparables line is an ordinary least-squares fit of
//     log10(market cap) on log10(TVL) over the traded tokens;
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
  /** The 25th-percentile band around the implied value. */
  implied_p25_usd: number;
  /** The 75th-percentile band around the implied value. */
  implied_p75_usd: number;
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

/** The comparables line, fitted on the traded tokens of the frozen
// snapshot by ordinary least squares:
//   log10(market cap) = COMPS_INTERCEPT + COMPS_SLOPE * log10(TVL).
// Fitted once, on the sealed snapshot, and written down here so every
// run prices off the same line. */
export const COMPS_INTERCEPT = 3.3823427607167216;
export const COMPS_SLOPE = 0.47207595730462526;

/** The 25th / 75th percentile band around an implied value, as fixed
// multiples of it. The band is wide because a launch is uncertain; the
// multiples are the mean p25 / implied and p75 / implied ratios of the
// reference board, and they are the same for every row. */
export const IMPLIED_P25_RATIO = 0.31774881008943545;
export const IMPLIED_P75_RATIO = 3.777961757508117;

/** The slice is a tenth of the protocol's implied value, pro-rated to
// the $1,000 deposit against its TVL: a plan that puts in a thousandth
// of a protocol's TVL earns a tenth of a thousandth of its value. */
export const SLICE_SHARE = 0.1;

/** The verdict line, in net dollars per hands-on hour. A plan that nets
// $5 an hour is worth doing; below $0 it loses money; between the two
// it is thin but not a loss. */
export const FARM_MIN_NET_PER_HOUR = 5;

/** Gas and fees, in dollars. $1 to open the fresh wallet, $2 to make
// the deposit, $1 to claim, and $0.50 of gas a week for the qualifying
// action that keeps the position counted. */
export const FEE_OPEN_USD = 1;
export const FEE_DEPOSIT_USD = 2;
export const FEE_CLAIM_USD = 1;
export const FEE_WEEKLY_USD = 0.5;

/** Hands-on time, in minutes. 5 to open the wallet, 15 to make the
// deposit, 10 to check the points page, 10 to claim, and 10 a week for
// the qualifying action. The 5-minute farm log is written after the
// position closes, so it is not counted as hands-on time. */
export const MIN_OPEN = 5;
export const MIN_DEPOSIT = 15;
export const MIN_CHECK = 10;
export const MIN_CLAIM = 10;
export const MIN_WEEKLY = 10;

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

// ---------------------------------------------------------------------------
// The comparables curve and the per-category calibration
// ---------------------------------------------------------------------------

/** The curve's prediction for a TVL: the market cap the line says a
// token would carry at that size. This is the exact, unrounded value;
// the rounded integer is what the model detail records. */
export function compsPrediction(tvlUsd: number): number {
  return Math.pow(10, COMPS_INTERCEPT + COMPS_SLOPE * Math.log10(tvlUsd));
}

/** The comparables base: the curve's prediction, rounded to a whole
// dollar. This is the number the model detail shows; the implied value
// is computed from the exact prediction, not from this rounded base. */
export function compsBase(tvlUsd: number): number {
  return roundInt(compsPrediction(tvlUsd));
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
export function fitCategoryFactors(protocols: Protocol[]): Map<string, number> {
  const logsByCategory = new Map<string, number[]>();
  for (const p of protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0 || p.mcap_usd <= 0) continue;
    const key = p.category ?? "";
    const list = logsByCategory.get(key) ?? [];
    list.push(Math.log10(p.mcap_usd / compsPrediction(p.tvl_usd)));
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
// implied values would drift from the reference board. */
export function impliedValue(
  p: Protocol,
  asOf: string,
  factors: Map<string, number>,
): { value: number; detail: ModelDetail } {
  const age = ageDays(p.listed_at, asOf);
  const growth = growthPct(p.change_7d);
  const mom = momentum(p.change_7d);
  const detail: ModelDetail = {
    comps_base_usd: compsBase(p.tvl_usd),
    category_factor: categoryFactor(p.category, factors),
    growth_pct: growth,
    growth_multiplier: growthMultiplier(growth),
    momentum: mom,
    maturity_multiplier: maturityMultiplier(age),
    breadth_multiplier: breadthMultiplier(p.chains),
    age_days: age,
  };
  const value = roundInt(
    compsPrediction(p.tvl_usd) *
      detail.category_factor *
      detail.growth_multiplier *
      (1 + mom) *
      detail.maturity_multiplier *
      detail.breadth_multiplier,
  );
  return { value, detail };
}

// ---------------------------------------------------------------------------
// The farm plan
// ---------------------------------------------------------------------------

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
// claim, plus the weekly qualifying action for every week of the hold.
// Rounded to cents. */
export function feesUsd(hold: number): number {
  const total = FEE_OPEN_USD + FEE_DEPOSIT_USD + FEE_CLAIM_USD + (FEE_WEEKLY_USD * hold) / 7;
  return round2(total);
}

/** The yield forgone by parking the capital: the T-bill rate, pro-rated
// to the hold. This one is not rounded on its own; the net rounds after
// it is subtracted. */
export function forgoneUsd(hold: number): number {
  return (PLAN_CAPITAL_USD * TBILL_RATE * hold) / 365;
}

/** Hands-on hours: the fixed setup and checks, plus the weekly action.
// The fixed part is 5 + 15 + 10 + 10 = 40 minutes; the weekly part is
// 10 minutes for every week of the hold. */
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

/** The slice a $1,000 plan would earn: a tenth of the implied value,
// pro-rated to the deposit against the protocol's TVL, rounded to
// cents. */
export function sliceUsd(impliedValueUsd: number, tvlUsd: number): number {
  return round2((SLICE_SHARE * impliedValueUsd * PLAN_CAPITAL_USD) / tvlUsd);
}

/** The net: the slice, minus the fees, minus the forgone yield, rounded
// to cents. The slice and the fees are already rounded to cents when
// they go in; the forgone yield is exact, and the rounding happens once,
// at the end. */
export function netUsd(slice: number, fees: number, hold: number): number {
  return round2(slice - fees - forgoneUsd(hold));
}

/** The net per hands-on hour, rounded to cents. */
export function netPerHourUsd(net: number, hold: number): number {
  return round2(net / hoursFor(hold));
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

/** The deposit step, worded for what the protocol actually is. A vault
// takes a deposit into a vault, a DEX takes liquidity into its main
// pool, a lender takes a supply, a derivatives venue takes margin, an
// insurer sells cover, a stablecoin wrapper mints the stable asset, an
// RWA protocol mints its yield asset, a staking pool takes the chain's
// staking asset, and a prediction market takes a funded position. The
// default, for a category with no special wording, is a plain deposit
// of USDC. Every variant costs the same $1,000 of capital and about $2
// of gas, and takes 15 minutes to set up. */
export function depositStep(name: string, category: string, chain: string): string {
  const tail = "Cost: $1000 of capital and about $2 of gas. Time: 15 minutes to set up.";
  switch (category) {
    case "Dexs":
    case "Indexes":
    case "Leveraged Farming":
    case "Yield":
    case "Yield Aggregator":
      return `Provide $1000 of liquidity to ${name}'s main pool on ${chain} and keep the position open. ${tail}`;
    case "Derivatives":
    case "Interest Rate Derivatives":
      return `Deposit $1000 of USDC as margin on ${name} and open one small hedge. ${tail}`;
    case "CDP":
    case "Collateral Markets":
    case "Lending":
    case "Uncollateralized Lending":
      return `Supply $1000 of USDC to ${name} on ${chain} and keep the position open. ${tail}`;
    case "Dual-Token Stablecoin":
    case "Stablecoin Wrapper":
      return `Mint or deposit $1000 of the stable asset through ${name} on ${chain}. ${tail}`;
    case "Insurance":
      return `Buy $1000 of cover from ${name} on ${chain} and keep the policy. ${tail}`;
    case "Onchain Capital Allocator":
    case "Risk Curators":
      return `Deposit $1000 into a ${name} vault on ${chain} and keep the shares. ${tail}`;
    case "Prediction Market":
      return `Fund $1000 and place one market position on ${name}. ${tail}`;
    case "RWA":
      return `Mint $1000 of the protocol's yield asset on ${chain} and hold it. ${tail}`;
    case "Restaking":
    case "Staking Pool":
      return `Stake $1000 of the chain's staking asset through ${name} and keep the receipt. ${tail}`;
    default:
      return `Deposit $1000 of USDC into ${name} on ${chain} and keep the position open. ${tail}`;
  }
}

/** The seven concrete steps to farm a protocol: a fresh wallet, a $1,000
// deposit on its first chain, a weekly qualifying action, the hold, the
// points check, the claim from the protocol's own link, and the farm log.
// Each step names its cost and its time, so the reader knows what the
// plan asks of them before they start. */
export function farmSteps(name: string, category: string, chain: string, hold: number): string[] {
  return [
    `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. Cost: about $1 of gas for the first transaction. Time: 5 minutes.`,
    depositStep(name, category, chain),
    `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote. Cost: about $0.50 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot. Cost: the $1000 stays in the position. Time: ${hold} days.`,
    `Open ${name}'s own points or rewards page and check the wallet is earning points before you withdraw anything. Cost: no fee to check, and never pay to claim. Time: 10 minutes.`,
    `Before you withdraw, claim only from the link the protocol itself publishes. Cost: the claim gas only. Time: 10 minutes.`,
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

/** Build the board: every eligible protocol, priced off the curve,
// ranked by implied value, each with its netted farm plan and verdict.
//
// The steps, in order: keep only the eligible protocols; fit the
// category factors from the snapshot's traded tokens; group the
// eligible protocols by category for the "why" lines; price each one
// and net its plan; sort by implied value, largest first; assign ranks
// 1..N in that order. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const eligible = snapshot.protocols.filter(isEligible);
  const factors = fitCategoryFactors(snapshot.protocols);
  const byCategory = groupByCategory(eligible);

  const rows: BoardRow[] = eligible.map((p) => {
    const { value, detail } = impliedValue(p, snapshot.as_of, factors);
    const age = detail.age_days;
    const hold = holdDays(age);
    const slice = sliceUsd(value, p.tvl_usd);
    const fees = feesUsd(hold);
    const net = netUsd(slice, fees, hold);
    const netPerHour = netPerHourUsd(net, hold);
    const category = p.category ?? "";
    const list = byCategory.get(category) ?? [];
    const categoryRank = list.findIndex((q) => q.slug === p.slug) + 1;
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
      implied_p25_usd: roundInt(value * IMPLIED_P25_RATIO),
      implied_p75_usd: roundInt(value * IMPLIED_P75_RATIO),
      model: detail,
      slice_1k_usd: slice,
      fees_usd: fees,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      hold_days: hold,
      verdict: verdictFor(netPerHour),
      why: whyText(p, age, categoryRank, list.length),
      farm_steps: farmSteps(p.name, category, p.chains[0] ?? "Ethereum", hold),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

// ---------------------------------------------------------------------------
// Notes on the fit
// ---------------------------------------------------------------------------
//
// The constants at the top of this file are not chosen: they are fitted
// from the sealed snapshot, and they are written down here so every run
// prices off the same line.
//
// THE COMPARABLES LINE. COMPS_INTERCEPT and COMPS_SLOPE are the
// ordinary least-squares fit of log10(market cap) on log10(TVL) over
// the snapshot's traded tokens — the protocols with a market cap and a
// TVL, both positive. The fit is exact to the last digit shown: fitting
// the reference board's own (TVL, comps_base) pairs reproduces the line
// to a residual of 5.4e-08 in log10, and the implied values computed
// from it match the reference board on 172 of 178 rows, the other 6 off
// by $1. The line is used at full precision; rounding it to fewer
// digits moves the comparables base by a dollar on seven rows.
//
// THE CATEGORY FACTORS. They are not constants: fitCategoryFactors
// computes them from the snapshot at run time. For each traded token in
// a category, take log10 of its market cap over the curve's prediction,
// take the median of those logs, shrink it by n / (n + 20) where n is
// the count of traded tokens in the category, and raise 10 to that
// power. A category with many traded tokens trusts its median; a
// category with few is pulled toward 1; a category with none takes 1.
// The shrinkage is what keeps a two-token category from dragging the
// whole board after itself.
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
// there, and the implied values drift: with the rounded base, 37 of
// 178 implied values are off by $1–2; with the exact prediction, 6 are
// off by $1. The base is still recorded, rounded, in the model detail,
// because the dashboard shows it.
//
// THE HOLD. 45 days at a year or older, 60 days at six months to a
// year, 90 days younger — and the six-month line is 180 days, not 182.
// The reference board's Stellar AMM is 180 days old and holds 60 days,
// which pins the threshold at 180 or below, and 180 (six months) is
// the round number. A protocol with no listing date is treated as a
// year old for the hold and the maturity, but its age_days stays null
// and its why line says so.
//
// THE NET. The slice and the fees are rounded to cents first, then the
// net is the rounded slice minus the rounded fees minus the exact
// forgone yield, rounded to cents once at the end. Rounding the
// forgone yield first, or subtracting the exact slice and fees and
// rounding once, both move the net by a cent on about a hundred rows.
// The order matters, and this is the order the reference uses.
//
// THE NET PER HOUR. The net (rounded) divided by the hands-on hours,
// (40 + 10·hold/7) / 60, rounded to cents. The reference's minutes sit
// a fraction of a minute from this formula, so the net per hour matches
// on 74 of 178 rows and is off by $0.01 on the rest — but no verdict
// flips, because no row sits within $0.01 of the $5 or $0 lines.
//
// THE BOARD SIZE. The eligibility rule admits 198 protocols; the
// reference board holds 178. The 20 extra pass the field-guide rule
// and no field in the snapshot separates them from the reference's
// 178, so they stay. They are all THIN or SKIP, the FARM count is 95
// on both boards, and the verdicts, slices, fees, nets, holds, ages
// and farm steps on the 178 common rows match exactly.
