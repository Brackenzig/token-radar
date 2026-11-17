// Token Radar — the valuation and farm-plan model.
//
// A token-launch radar: it reads a sealed DefiLlama snapshot of every
// protocol, fits a comparables curve to the tokens that already trade
// (log10 market cap on log10 TVL), prices every pre-token protocol off
// that curve, and nets a farm plan for each one: the $1,000 slice minus
// fees, gas and the forgone T-bill yield, per plan and per hands-on hour,
// with a FARM / THIN / SKIP verdict.
//
// The snapshot is frozen: every run reads the same bytes. The curve and
// the per-category factors below are the fitted values for that snapshot.

export interface Protocol {
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

export interface ModelDetail {
  comps_base_usd: number;
  category_factor: number;
  growth_pct: number;
  growth_multiplier: number;
  momentum: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: string;
  age_days: number | null;
  implied_value_usd: number;
  implied_p25_usd: number;
  implied_p75_usd: number;
  model: ModelDetail;
  slice_1k_usd: number;
  fees_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  hold_days: number;
  verdict: "FARM" | "THIN" | "SKIP";
  why: string;
  farm_steps: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** One plan capital, in dollars, everywhere: steps, slice, forgone yield. */
export const PLAN_CAPITAL_USD = 1000;

/** The forgone yield is charged at the T-bill rate, per year, on the plan capital. */
export const TBILL_RATE = 0.04;

/** The comparables curve, fitted on the traded tokens of the frozen snapshot:
 *  log10(market cap) = COMPS_A + COMPS_B * log10(TVL). */
export const COMPS_A = 3.3823427607;
export const COMPS_B = 0.4720759573;

/** The 25th / 75th percentile band around an implied value, as fixed multiples. */
export const IMPLIED_P25_RATIO = 0.3177488;
export const IMPLIED_P75_RATIO = 3.7779618;

/** A farm plan's slice is a tenth of the protocol's implied value, pro-rated
 *  to the $1,000 deposit against its TVL. */
export const SLICE_SHARE = 0.1;

/** The verdict line, in net dollars per hands-on hour. */
export const FARM_MIN_NET_PER_HOUR = 5;

/** Gas and fees: $1 to open the wallet, $2 to deposit, $1 to claim, plus
 *  $0.50 of gas a week for the qualifying actions. */
export const FEE_OPEN_USD = 1;
export const FEE_DEPOSIT_USD = 2;
export const FEE_CLAIM_USD = 1;
export const FEE_WEEKLY_USD = 0.5;

/** Hands-on time: 5 minutes to open the wallet, 15 to deposit, 10 to check
 *  points, 10 to claim, 10 minutes a week for the qualifying actions. The
 *  5-minute farm log is written after the position closes and is not counted. */
export const MIN_OPEN = 5;
export const MIN_DEPOSIT = 15;
export const MIN_CHECK = 10;
export const MIN_CLAIM = 10;
export const MIN_WEEKLY = 10;

/** Per-category calibration of the comparables curve, fitted on the frozen
 *  snapshot. A category with no traded token takes 1. */
export const CATEGORY_FACTORS: Record<string, number> = {
  "Anchor BTC": 1,
  "Basis Trading": 1.1586015487975228,
  "CDP": 0.9730820549790361,
  "CeDeFi": 1,
  "Chain": 1.1006076983492148,
  "Collateral Markets": 1,
  "Crypto Card Issuer": 1,
  "Decentralized BTC": 1,
  "Derivatives": 1.126225754898692,
  "Dexs": 1.0686525236635973,
  "Dual-Token Stablecoin": 0.9250288548455025,
  "Farm": 1,
  "Governance Incentives": 1,
  "Indexes": 0.8605016963070292,
  "Insurance": 1,
  "Interest Rate Derivatives": 1,
  "Lending": 0.830608049970477,
  "Leveraged Farming": 1.003522823126395,
  "Liquidity Manager": 0.8485645757050907,
  "Onchain Capital Allocator": 0.8849025494300223,
  "Payments": 0.8948521823831239,
  "Prediction Market": 1.36242656618894,
  "RWA": 1.136449485333176,
  "Restaking": 1.0086821568017705,
  "Risk Curators": 1.0945633617300903,
  "Stablecoin Wrapper": 1,
  "Staking Pool": 0.7745400427912523,
  "Uncollateralized Lending": 1,
  "Yield": 0.9510468501578424,
  "Yield Aggregator": 0.8765048176053202,
};

export function categoryFactor(category: string | null): number {
  if (category === null) return 1;
  return CATEGORY_FACTORS[category] ?? 1;
}

// ---------------------------------------------------------------------------
// Eligibility: the field-guide rule
// ---------------------------------------------------------------------------

const INELIGIBLE_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

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

const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A protocol is eligible for the board when it is a pre-token protocol in
 *  its own right: it records no token, it is not a bridge, a liquid-staking
 *  or restaking product, a CEX or a wrapped/staked product, its name carries
 *  no version marker and does not begin with an exchange's name. */
export function isEligible(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && INELIGIBLE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const ex of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(ex)) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// The valuation
// ---------------------------------------------------------------------------

/** Days from a UTC date string (YYYY-MM-DD) to the snapshot date. A protocol
 *  DefiLlama gives no listed date for has no age on record; the maturity
 *  and hold calculations treat that as a year old. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** A protocol's age tempers its value: 0.6 at launch, rising to 1.0 at three
 *  years, linearly in between. */
export function maturityMultiplier(ageDays: number | null): number {
  const age = ageDays === null ? 365 : ageDays;
  return Math.min(1, 0.6 + (age * 0.4) / 1095);
}

/** Breadth pays: the first chain is free, then 3% for each additional
 *  chain, up to ten extra chains. */
export function breadthMultiplier(chains: string[]): number {
  return 1 + 0.03 * Math.min(Math.max(0, chains.length - 1), 10);
}

/** The 7-day move, clamped so one wild week cannot run the board. A protocol
 *  with no reported move counts as flat. */
export function growthPct(change7d: number | null): number {
  if (change7d === null) return 0;
  return Math.max(-60, Math.min(120, change7d));
}

/** Half the 7-day move, as a multiplier on value. */
export function growthMultiplier(growth: number): number {
  return 1 + growth * 0.005;
}

/** A strong move in either direction is momentum: a tenth either way past
 *  a 20% week, nothing inside it. */
export function momentum(growth: number): number {
  if (growth >= 20) return 0.1;
  if (growth <= -20) return -0.1;
  return 0;
}

/** The comparables base: what the curve says a token would be worth at this
 *  protocol's TVL, before any adjustment. */
export function compsBase(tvlUsd: number): number {
  return Math.round(Math.pow(10, COMPS_A + COMPS_B * Math.log10(tvlUsd)));
}

/** The implied value: the curve's base, calibrated by category, moved by the
 *  week's growth and momentum, tempered by age, widened by breadth. */
export function impliedValue(p: Protocol, asOf: string): { value: number; detail: ModelDetail } {
  const age = ageDays(p.listed_at, asOf);
  const growth = growthPct(p.change_7d);
  const mom = momentum(growth);
  const detail: ModelDetail = {
    comps_base_usd: compsBase(p.tvl_usd),
    category_factor: categoryFactor(p.category),
    growth_pct: growth,
    growth_multiplier: growthMultiplier(growth),
    momentum: mom,
    maturity_multiplier: maturityMultiplier(age),
    breadth_multiplier: breadthMultiplier(p.chains),
    age_days: age,
  };
  const value = Math.round(
    detail.comps_base_usd *
      detail.category_factor *
      detail.growth_multiplier *
      detail.maturity_multiplier *
      detail.breadth_multiplier *
      (1 + mom),
  );
  return { value, detail };
}

// ---------------------------------------------------------------------------
// The farm plan
// ---------------------------------------------------------------------------

/** How long a position is held, in days: the younger the protocol, the
 *  longer the hold, so the activity is counted in more than one snapshot. */
export function holdDays(age: number | null): number {
  const a = age === null ? 365 : age;
  if (a >= 365) return 45;
  if (a >= 180) return 60;
  return 90;
}

/** What the plan costs in gas: the open, the deposit and the claim, plus the
 *  weekly qualifying action for every week of the hold. */
export function feesUsd(hold: number): number {
  const total = FEE_OPEN_USD + FEE_DEPOSIT_USD + FEE_CLAIM_USD + (FEE_WEEKLY_USD * hold) / 7;
  return Math.round(total * 100) / 100;
}

/** The yield forgone by parking the capital: the T-bill rate, pro-rated to
 *  the hold. */
export function forgoneUsd(hold: number): number {
  return (PLAN_CAPITAL_USD * TBILL_RATE * hold) / 365;
}

/** Hands-on hours: the fixed setup and checks, plus the weekly action. */
export function hoursFor(hold: number): number {
  const minutes = MIN_OPEN + MIN_DEPOSIT + MIN_CHECK + MIN_CLAIM + (MIN_WEEKLY * hold) / 7;
  return minutes / 60;
}

export function verdictFor(netPerHour: number): "FARM" | "THIN" | "SKIP" {
  if (netPerHour >= FARM_MIN_NET_PER_HOUR) return "FARM";
  if (netPerHour >= 0) return "THIN";
  return "SKIP";
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function formatTvl(tvl: number): string {
  if (tvl >= 1_000_000_000) return `$${(tvl / 1_000_000_000).toFixed(2)}B`;
  return `$${(tvl / 1_000_000).toFixed(1)}M`;
}

function formatPct(pct: number): string {
  return `${Math.abs(pct).toFixed(1)}%`;
}

/** The one-line reason a row sits where it does: its size, its place among
 *  the pre-token protocols of its own category by TVL, its age, its chains
 *  and its week's move. */
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

/** The deposit step, worded for what the protocol actually is: a vault
 *  takes a deposit, a DEX takes liquidity, a lender takes a supply, a
 *  derivatives venue takes margin, and so on. */
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
 *  deposit on its first chain, a weekly qualifying action, the hold, the
 *  points check, the claim from the protocol's own link, and the farm log. */
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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** Build the board: every eligible protocol, priced off the curve, ranked by
 *  implied value, each with its netted farm plan and verdict. */
export function buildBoard(snapshot: Snapshot): BoardRow[] {
  const eligible = snapshot.protocols.filter(isEligible);

  // Each category's pre-token protocols, by TVL, for the "why" line.
  const byCategory = new Map<string, Protocol[]>();
  for (const p of eligible) {
    const key = p.category ?? "";
    const list = byCategory.get(key) ?? [];
    list.push(p);
    byCategory.set(key, list);
  }
  for (const list of byCategory.values()) {
    list.sort((a, b) => b.tvl_usd - a.tvl_usd);
  }

  const rows: BoardRow[] = eligible.map((p) => {
    const { value, detail } = impliedValue(p, snapshot.as_of);
    const age = detail.age_days;
    const hold = holdDays(age);
    const slice = Math.round(((value * PLAN_CAPITAL_USD) / p.tvl_usd) * SLICE_SHARE * 100) / 100;
    const fees = feesUsd(hold);
    const net = Math.round((slice - fees - forgoneUsd(hold)) * 100) / 100;
    const hours = hoursFor(hold);
    const netPerHour = Math.round((net / hours) * 100) / 100;
    const list = byCategory.get(p.category ?? "") ?? [];
    const categoryRank = list.findIndex((q) => q.slug === p.slug) + 1;
    return {
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category ?? "",
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
      implied_p25_usd: Math.round(value * IMPLIED_P25_RATIO),
      implied_p75_usd: Math.round(value * IMPLIED_P75_RATIO),
      model: detail,
      slice_1k_usd: slice,
      fees_usd: fees,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      hold_days: hold,
      verdict: verdictFor(netPerHour),
      why: whyText(p, age, categoryRank, list.length),
      farm_steps: farmSteps(p.name, p.category ?? "", p.chains[0] ?? "Ethereum", hold),
    };
  });

  rows.sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}
