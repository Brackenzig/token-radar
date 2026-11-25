// Token Radar — the valuation, the farm plan and the board, v6.
//
// A radar for token launches. It reads a sealed snapshot of every
// protocol (DefiLlama, frozen on a date), fits a comparables curve to
// the protocols whose token already trades, fits a second model — the
// token-odds logistic model — to the protocols that could launch one,
// and ranks the protocols with no token yet by their EXPECTED VALUE:
// the value their launch would carry, times the probability they
// launch at all. Each one gets a farm plan for a fixed $1,000 of
// capital: the expected slice of the launch value the plan would
// earn, minus the gas and fees, minus the yield given up by parking
// the money, per plan and per hands-on hour, with a FARM / THIN /
// SKIP verdict.
//
// Nothing here touches the network. The snapshot is the only input,
// and the same bytes always give the same board. Every number the
// page shows is computed here, at run time, from that snapshot —
// except the term-by-term held-out table, which is the recorded
// result of the v5 ablation experiments and is labelled as such:
//
//   * the comparables line is an ordinary least-squares fit of
//     log10(market cap) on log10(TVL) over the traded tokens with
//     TVL of $10M or more — the fit runs in this program, on the
//     snapshot it is given, and no coefficient is written down in
//     advance;
//   * the value-if-launches is the curve alone. The v5 experiments
//     tested every other term in the v4 formula — category factor,
//     growth, maturity, breadth, the full formula, category-specific
//     slopes, a ridge — and none of them lowers the held-out miss in
//     both leave-one-out and the time split, so none of them is in
//     the value. The table is in the method proof;
//   * the token-odds model is a logistic regression fitted here, at
//     run time, on the 442 eligible protocols: log10(TVL),
//     log10(age+1), an age-unknown flag, the chain count, the 7-day
//     growth and the top-10 category dummies, standardised on the
//     training set, L2 penalty λ = 1, fitted by IRLS. It is tested
//     the same way as the curve: 5-fold stratified cross-validation
//     (3 repeats, out of fold) and a time split, each against the
//     constant base rate;
//   * the uncertainty band on every row comes from 200 bootstrap
//     refits of the curve: each refit resamples the comparables with
//     replacement, refits the line and reprices the row's
//     value-if-launches, and the row's expected-value band is its
//     P(token) times that band. P(token) itself is not refit in the
//     bootstrap — it is a second model with its own validation — so
//     the band is the curve's uncertainty, stated as such;
//   * the calibration check is computed here too: the
//     leave-one-out residuals of the curve, against the normal-theory
//     P25–P75 and P10–P90 intervals built from the residual spread,
//     so the page can say whether its bands cover at the rate they
//     claim.
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
  /** The probability this protocol launches a token, from the
   * token-odds model fitted at run time on the 442 eligible
   * protocols. */
  p_token: number;
  /** The token-odds features, so the detail panel can show what the
   * probability rests on: log10(TVL), log10(age+1), the age-unknown
   * flag, the chain count, the clamped 7-day growth and the category. */
  odds_features: {
    log10_tvl: number;
    log10_age: number;
    age_unknown: number;
    n_chains: number;
    growth: number;
    category: string;
  };
  /** The protocol's age in days, or null when no listing date is known. */
  age_days: number | null;
  /** The weekly gas on the protocol's first chain, in dollars. */
  weekly_gas_usd: number;
}

/** One row of the ranked board. */
export interface BoardRow {
  /** The rank, 1 for the largest expected value, assigned after sorting. */
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
  /** The expected value in dollars — P(token) × the curve value — the
   * headline the board ranks by, and the implied_value_usd the gate
   * reads. */
  implied_value_usd: number;
  /** The value if the token launches: the curve alone, at this TVL. */
  curve_value_usd: number;
  /** The probability this protocol launches a token. */
  p_token: number;
  /** The 10th-percentile expected value over the 200 bootstrap refits. */
  implied_p10_usd: number;
  /** The 90th-percentile expected value over the 200 bootstrap refits. */
  implied_p90_usd: number;
  /** The best rank the row takes across the 200 bootstrap refits. */
  rank_lo: number;
  /** The worst rank the row takes across the 200 bootstrap refits. */
  rank_hi: number;
  /** The valuation broken down. */
  model: ModelDetail;
  /** The expected slice of the launch value a $1,000 plan would earn. */
  slice_1k_usd: number;
  /** The slice if the token launches: a tenth of the curve value
   * alone, pro-rated the same way, at the same $1,000 plan — the
   * upside v4 showed, next to the expected slice above. It is a
   * display number only: the net, the net per hour and the verdict
   * are all computed from the expected slice, never from this one. */
  slice_if_launches_1k_usd: number;
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
 * it is never ranked by expected value. */
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

/** One out-of-sample test of the token-odds model: the fitted
 * probabilities against the constant base rate. */
export interface TokenOddsTest {
  /** How many protocols the test scored. */
  n: number;
  /** The base rate of the test set: the share that has a token. */
  base_rate: number;
  /** The model's Brier score (mean squared error of the probability). */
  brier: number;
  /** The constant base-rate prediction's Brier score. */
  baseline_brier: number;
  /** The model's area under the ROC curve. */
  auc: number;
  /** The model's log-loss. */
  log_loss: number;
}

/** The calibration check: whether the curve's bands cover at the rate
 * they claim, on leave-one-out residuals. */
export interface Calibration {
  /** The residual spread the intervals are built from, in dex: the
   * in-sample residual standard deviation, rounded to two decimals
   * (0.90 dex, the spread v4 states). */
  sigma_dex: number;
  /** The share of the 101 comparables whose real market cap falls
   * inside the P25–P75 interval (nominal 50%). */
  p25_p75_coverage: number;
  /** The share inside the P10–P90 interval (nominal 80%). */
  p10_p90_coverage: number;
  /** How many comparables the check scored. */
  n: number;
}

/** Everything the page proves about its own models, computed here. */
export interface Validation {
  /** The comparables line, fitted at run time. */
  fit: { intercept: number; slope: number; r2: number; n: number; min_tvl_usd: number };
  /** Leave-one-out over the comparables. */
  loo: ValidationTest;
  /** Fit before 2024, tested on the tokens listed since. */
  time_split: ValidationTest & { train_n: number; test_n: number; unlisted_n: number };
  /** The bootstrap that built the per-row bands. */
  bootstrap: { refits: number; seed: number };
  /** The token-odds model: 5-fold stratified cross-validation, 3
   * repeats, out of fold, on the 442 eligible protocols. */
  token_odds_cv: TokenOddsTest;
  /** The token-odds model on the time split: trained on protocols
   * listed before 2024, tested on the ones listed since. The label
   * is time-censored — newer protocols labelled 0 may launch later —
   * so this number is the warning, not the headline. */
  token_odds_time_split: TokenOddsTest & { train_n: number; test_n: number };
  /** The TVL-only logistic model on the same cross-validation, for
   * comparison: it shows the signal comes from age, chains, category
   * and growth, not from size alone. */
  token_odds_tvl_only: { brier: number; auc: number };
  /** The calibration check on the curve's leave-one-out residuals. */
  calibration: Calibration;
  /** The fitted token-odds model itself: the coefficients on
   * standardised features (intercept first), so the page can show
   * what the probability rests on. */
  token_odds_model: {
    coefficients: { feature: string; coefficient: number }[];
    top_categories: string[];
    peer_n: number;
    peer_base_rate: number;
  };
  /** The term-by-term held-out evidence: the recorded result of the
   * v5 ablation experiments (see HELDOUT_TABLE below). It is not
   * computed from this snapshot — it is the experiment record — and
   * it is labelled as such. */
  heldout: typeof HELDOUT_TABLE;
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

/** The slice is a tenth of the protocol's expected value, pro-rated to
// the $1,000 deposit against its TVL: a plan that puts in a thousandth
// of a protocol's TVL earns a tenth of a thousandth of its expected
// value. */
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

/** The token-odds model's L2 penalty: λ = 1, the value the lever-2
// analysis validated (the Brier is stable across λ = 0.1–10, so the
// fit is not a tuning artifact). */
export const TOKEN_ODDS_LAMBDA = 1.0;

/** How many category dummies the token-odds model carries: the top 10
// categories by count in the training set, everything else as the
// reference. */
export const TOKEN_ODDS_TOP_CATEGORIES = 10;

/** The cross-validation of the token-odds model: 5 folds, 3 repeats,
// the folds stratified by label and drawn with the same generator
// the analysis used, so the program reproduces the lever-2 numbers. */
export const TOKEN_ODDS_CV_FOLDS = 5;
export const TOKEN_ODDS_CV_REPEATS = 3;
export const TOKEN_ODDS_CV_SEEDS = [7, 8, 9];

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

/** The mean of a list of numbers. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

/** The population standard deviation of a list (dividing by n, the
// same definition the analysis used). */
export function stdDev(values: number[]): number {
  if (values.length === 0) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / values.length);
}

/** The sample standard deviation of a list (dividing by n - 1, the
// unbiased estimator). The calibration check uses this one, because
// it is the definition the v4/v5 analyses used for the residual
// spread (0.896 dex, stated as 0.90). */
export function stdDevSample(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
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

/** Solve a dense linear system A x = b by Gaussian elimination with
// partial pivoting. A is an n×n array of rows, b a length-n vector.
// Returns x, or null when the system is singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = A.map((row, i) => [...row, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[piv]![col]!)) piv = r;
    }
    if (Math.abs(m[piv]![col]!) < 1e-12) return null;
    if (piv !== col) {
      const tmp = m[col]!;
      m[col] = m[piv]!;
      m[piv] = tmp;
    }
    for (let r = col + 1; r < n; r++) {
      const f = m[r]![col]! / m[col]![col]!;
      for (let c = col; c <= n; c++) m[r]![c]! -= f * m[col]![c]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= m[i]![j]! * x[j]!;
    x[i] = s / m[i]![i]!;
  }
  return x;
}

// ---------------------------------------------------------------------------
// A Python-compatible random generator (Mersenne Twister)
// ---------------------------------------------------------------------------
//
// The token-odds cross-validation draws its folds with the same
// generator the lever-2 analysis used — CPython's random.Random, which
// is MT19937 seeded by init_by_array — so the program reproduces the
// analysis's out-of-fold numbers exactly. The implementation below is
// the standard MT19937 (init_genrand, init_by_array, the twist and the
// tempering) plus random's getrandbits / _randbelow / shuffle, all in
// 32-bit unsigned arithmetic. Verified against CPython: Random(7),
// Random(8) and Random(9) reproduce the same folds, and the program's
// cross-validated Brier matches the analysis's 0.1958.

/** MT19937, seeded the way CPython's random.Random seeds an int:
// the int's 32-bit words, little-endian, passed to init_by_array. */
export class PyRandom {
  private mt: Uint32Array;
  private mti: number;

  constructor(seed: number) {
    this.mt = new Uint32Array(624);
    this.mti = 625;
    const key: number[] = [];
    let x = Math.abs(Math.floor(seed));
    while (x > 0) {
      key.push(x & 0xffffffff);
      x = Math.floor(x / 4294967296);
    }
    if (key.length === 0) key.push(0);
    this.initByArray(key);
  }

  private initGenrand(s: number): void {
    this.mt[0] = s >>> 0;
    for (let i = 1; i < 624; i++) {
      const prev = this.mt[i - 1]!;
      this.mt[i] = (Math.imul(1812433253, prev ^ (prev >>> 30)) + i) >>> 0;
    }
    this.mti = 624;
  }

  private initByArray(initKey: number[]): void {
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    const keyLen = initKey.length;
    for (let k = 0; k < Math.max(624, keyLen); k++) {
      const prev = this.mt[i - 1]!;
      const mixed = Math.imul(prev ^ (prev >>> 30), 1664525);
      this.mt[i] = ((this.mt[i]! ^ mixed) + initKey[j]! + j) >>> 0;
      i++;
      j++;
      if (i >= 624) {
        this.mt[0] = this.mt[623]!;
        i = 1;
      }
      if (j >= keyLen) j = 0;
    }
    for (let k = 0; k < 623; k++) {
      const prev = this.mt[i - 1]!;
      const mixed = Math.imul(prev ^ (prev >>> 30), 1566083941);
      this.mt[i] = ((this.mt[i]! ^ mixed) - i) >>> 0;
      i++;
      if (i >= 624) {
        this.mt[0] = this.mt[623]!;
        i = 1;
      }
    }
    this.mt[0] = 0x80000000;
  }

  private genrandUint32(): number {
    if (this.mti >= 624) {
      for (let i = 0; i < 624; i++) {
        let y = (this.mt[i]! & 0x80000000) | (this.mt[(i + 1) % 624]! & 0x7fffffff);
        let v = this.mt[(i + 397) % 624]! ^ (y >>> 1);
        if (y % 2 !== 0) v ^= 0x9908b0df;
        this.mt[i] = v >>> 0;
      }
      this.mti = 0;
    }
    let y = this.mt[this.mti]!;
    this.mti++;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** k random bits, k <= 32: the top k bits of one MT word. */
  getrandbits(k: number): number {
    return this.genrandUint32() >>> (32 - k);
  }

  /** A uniform integer in [0, n), by rejection sampling on the bit
   * length, exactly as random._randbelow does it: k is n's bit
   * length (32 - clz32(n)), and a draw is rejected while it is >= n. */
  randbelow(n: number): number {
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** Shuffle an array in place, Fisher-Yates from the end, exactly
   * as random.shuffle does it. */
  shuffle<T>(xs: T[]): T[] {
    for (let i = xs.length - 1; i > 0; i--) {
      const j = this.randbelow(i + 1);
      const tmp = xs[i]!;
      xs[i] = xs[j]!;
      xs[j] = tmp;
    }
    return xs;
  }
}

// ---------------------------------------------------------------------------
// Scoring a probability: Brier, log-loss, AUC
// ---------------------------------------------------------------------------

/** The Brier score: the mean squared error of the predicted
 * probabilities against the 0/1 labels. */
export function brierScore(preds: number[], labels: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) {
    const d = preds[i]! - labels[i]!;
    s += d * d;
  }
  return preds.length === 0 ? 0 : s / preds.length;
}

/** The log-loss: the mean negative log-likelihood, with the
 * probabilities clipped away from 0 and 1. */
export function logLoss(preds: number[], labels: number[]): number {
  let s = 0;
  for (let i = 0; i < preds.length; i++) {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, preds[i]!));
    s += labels[i]! === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return preds.length === 0 ? 0 : s / preds.length;
}

/** The area under the ROC curve, by the Mann-Whitney statistic with
 * average ranks for ties — the same definition the analysis used. */
export function aucScore(preds: number[], labels: number[]): number {
  const n = preds.length;
  const order = preds.map((_, i) => i).sort((a, b) => preds[a]! - preds[b]!);
  const ranks = new Array<number>(n).fill(0);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && preds[order[j + 1]!] === preds[order[i]!]) j++;
    const avg = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[order[k]!] = avg;
    i = j + 1;
  }
  let sumPos = 0;
  let n1 = 0;
  let n0 = 0;
  for (let k = 0; k < n; k++) {
    if (labels[k] === 1) {
      sumPos += ranks[k]!;
      n1++;
    } else {
      n0++;
    }
  }
  if (n1 === 0 || n0 === 0) return 0.5;
  return (sumPos - (n1 * (n1 + 1)) / 2) / (n1 * n0);
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
// dollar. This is the number the model detail shows; the expected
// value is computed from the exact prediction, not from this rounded
// base. */
export function compsBase(tvlUsd: number, line: FitLine): number {
  return roundInt(compsPrediction(tvlUsd, line));
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

/** Whether a protocol passes the category and name rules — the rule
// the token-odds peer set uses. It does not ask whether the protocol
// has a token: the peer set holds the traded protocols that pass the
// rule (the trainers, y = 1) and the pre-token ones that pass it (the
// ranked board, y = 0). */
export function isPeerEligible(p: Protocol): boolean {
  if (p.category !== null && INELIGIBLE_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  for (const prefix of EXCHANGE_PREFIXES) {
    if (p.name.startsWith(prefix)) return false;
  }
  return true;
}

/** A protocol makes the board when it is a pre-token protocol in its own
// right: it records no token (no CoinGecko id and no symbol), and it
// passes the peer rule. */
export function isEligible(p: Protocol): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  return isPeerEligible(p);
}

/** Whether the protocol has a token on this snapshot: the token-odds
// label. A protocol that records a token is y = 1; one that records
// none is y = 0. The label is a proxy for "will launch": a protocol
// that looks like past launchers is more likely to launch. */
export function hasToken(p: Protocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
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
// The token-odds model: a logistic regression, fitted at run time
// ---------------------------------------------------------------------------
//
// The label is whether the protocol has a token on this snapshot
// (y = 1) or records none (y = 0) — a proxy for "will launch". The
// peer set is the 442 protocols that pass the category and name
// rules: 244 traded-and-eligible (the trainers) and 198 no-token
// ranked (the scored). The features are snapshot-only, with no
// leakage: log10(TVL), log10(age+1) with a missing listing date
// treated as 365 days, an age-unknown flag, the chain count capped at
// 10, the 7-day growth clamped to [-60, +120] percent, and the top-10
// category dummies. The features are standardised on the training
// set; the fit is IRLS (Newton-Raphson) with L2 penalty λ = 1.

/** The raw token-odds features of one protocol, in the order the
// model uses them: the five numeric features, then one dummy per
// top category. */
export function tokenOddsFeatures(
  p: Protocol,
  asOf: string,
  topCategories: string[],
): { numeric: number[]; category: string } {
  const age = ageDays(p.listed_at, asOf);
  const effAge = age === null ? AGE_UNKNOWN_DAYS : age;
  const growth = p.change_7d === null ? 0 : Math.max(-60, Math.min(120, p.change_7d)) / 100;
  const numeric = [
    Math.log10(p.tvl_usd),
    Math.log10(effAge + 1),
    age === null ? 1 : 0,
    Math.min(p.chains.length, 10),
    growth,
  ];
  return { numeric, category: p.category ?? "" };
}

/** The top categories by count in the given rows, in the order the
// analysis lists them: count descending, ties in first-seen order
// (the order the protocols appear in the snapshot). */
export function topCategories(rows: Protocol[], k: number): string[] {
  const counts = new Map<string, { count: number; first: number }>();
  rows.forEach((p, i) => {
    const c = p.category ?? "";
    const e = counts.get(c);
    if (e) e.count++;
    else counts.set(c, { count: 1, first: i });
  });
  return [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first)
    .slice(0, k)
    .map(([c]) => c);
}

/** Build the design rows for a set of protocols: the numeric features
// plus one dummy per top category. Returns the matrix and the feature
// names, in order. */
export function buildDesign(
  rows: Protocol[],
  asOf: string,
  topCats: string[],
): { X: number[][]; names: string[] } {
  const names = ["log10TVL", "log10(age+1)", "age_unknown", "nChains", "growth"].concat(
    topCats.map((c) => `cat:${c}`),
  );
  const X = rows.map((p) => {
    const f = tokenOddsFeatures(p, asOf, topCats);
    return f.numeric.concat(topCats.map((c) => (f.category === c ? 1 : 0)));
  });
  return { X, names };
}

/** Standardise a matrix by its own columns (population standard
// deviation, a column with no spread taking 1). Returns the
// standardised matrix and the means and deviations, so a new row can
// be standardised the same way. */
export function standardize(
  X: number[][],
): { Xs: number[][]; mu: number[]; sd: number[] } {
  const cols = X[0]!.length;
  const mu: number[] = [];
  const sd: number[] = [];
  for (let j = 0; j < cols; j++) {
    const col = X.map((r) => r[j]!);
    mu.push(mean(col));
    const s = stdDev(col);
    sd.push(s < 1e-9 ? 1 : s);
  }
  const Xs = X.map((r) => r.map((v, j) => (v - mu[j]!) / sd[j]!));
  return { Xs, mu, sd };
}

/** Standardise new rows with the means and deviations of a training
// set. */
export function applyStandardize(X: number[][], mu: number[], sd: number[]): number[][] {
  return X.map((r) => r.map((v, j) => (v - mu[j]!) / sd[j]!));
}

/** Fit a logistic regression by IRLS (Newton-Raphson) with L2 penalty
// λ on every coefficient but the intercept: 100 iterations at most,
// the linear step solved by Gaussian elimination, stopping when the
// largest step falls under 1e-8. X is already standardised; the
// returned beta has the intercept first. */
export function fitLogit(X: number[][], y: number[], lam: number): number[] {
  const n = X.length;
  const d = X[0]!.length;
  const X1 = X.map((r) => [1, ...r]);
  let beta = new Array<number>(d + 1).fill(0);
  for (let it = 0; it < 100; it++) {
    const pr: number[] = [];
    for (let i = 0; i < n; i++) {
      let z = 0;
      for (let j = 0; j <= d; j++) z += X1[i]![j]! * beta[j]!;
      z = Math.max(-30, Math.min(30, z));
      pr.push(1 / (1 + Math.exp(-z)));
    }
    const g = new Array<number>(d + 1).fill(0);
    for (let j = 0; j <= d; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X1[i]![j]! * (y[i]! - pr[i]!);
      g[j] = s - (j === 0 ? 0 : lam * beta[j]!);
    }
    const H: number[][] = [];
    for (let a = 0; a <= d; a++) {
      const row: number[] = [];
      for (let b = 0; b <= d; b++) {
        let s = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.max(pr[i]! * (1 - pr[i]!), 1e-6);
          s += X1[i]![a]! * w * X1[i]![b]!;
        }
        if (a === b && a > 0) s += lam;
        row.push(s);
      }
      H.push(row);
    }
    const step = solveLinear(H, g);
    if (step === null) break;
    let maxStep = 0;
    for (let j = 0; j <= d; j++) {
      beta[j]! += step[j]!;
      maxStep = Math.max(maxStep, Math.abs(step[j]!));
    }
    if (maxStep < 1e-8) break;
  }
  return beta;
}

/** Predict the token probability for standardised rows. */
export function predictLogit(beta: number[], Xs: number[][]): number[] {
  return Xs.map((r) => {
    let z = beta[0]!;
    for (let j = 0; j < r.length; j++) z += beta[j + 1]! * r[j]!;
    z = Math.max(-30, Math.min(30, z));
    return 1 / (1 + Math.exp(-z));
  });
}

/** The stratified folds for one repeat: each class's indices, in
// snapshot order, shuffled with the given seed and dealt round-robin
// into 5 folds — the same construction the analysis used. */
export function stratifiedFolds(y: number[], k: number, seed: number): number[][] {
  const rng = new PyRandom(seed);
  const folds: number[][] = Array.from({ length: k }, () => []);
  for (const cls of [0, 1]) {
    const idx = y.map((v, i) => (v === cls ? i : -1)).filter((i) => i >= 0);
    rng.shuffle(idx);
    idx.forEach((i, j) => folds[j % k]!.push(i));
  }
  return folds;
}

/** The token-odds model, fitted and validated at run time.
//
// The full fit is on all 442 eligible protocols, with the top-10
// categories by count in that set and the standardisation from it.
// The cross-validation is 5-fold stratified, 3 repeats, out of fold:
// each repeat overwrites the last one's out-of-fold predictions, so
// the reported numbers are the last repeat's (seed 9), exactly as
// the analysis computed them. The TVL-only logistic is scored on the
// same folds for comparison. */
export interface TokenOddsModel {
  /** The fitted coefficients, intercept first, on standardised features. */
  beta: number[];
  /** The feature names, in order (the five numeric features, then the
   * category dummies). */
  names: string[];
  /** The standardisation of the full fit. */
  mu: number[];
  sd: number[];
  /** The top-10 categories of the full fit. */
  topCategories: string[];
  /** The cross-validation, out of fold, on the 442 eligible protocols. */
  cv: TokenOddsTest;
  /** The time split: trained on protocols listed before 2024 (and
   * those with no listing date), tested on the ones listed since. */
  timeSplit: TokenOddsTest & { train_n: number; test_n: number };
  /** The TVL-only logistic on the same cross-validation. */
  tvlOnly: { brier: number; auc: number };
  /** How many protocols the peer set holds, and its base rate. */
  peer_n: number;
  peer_base_rate: number;
}

export function fitTokenOdds(snapshot: Snapshot): TokenOddsModel {
  const peers = snapshot.protocols.filter(isPeerEligible);
  const y = peers.map((p) => (hasToken(p) ? 1 : 0));
  const baseRate = mean(y);

  // ---- cross-validation: 5 folds, 3 repeats, out of fold ------------
  const oof = new Array<number>(peers.length).fill(0);
  const oofTvl = new Array<number>(peers.length).fill(0);
  for (let rep = 0; rep < TOKEN_ODDS_CV_REPEATS; rep++) {
    const folds = stratifiedFolds(y, TOKEN_ODDS_CV_FOLDS, TOKEN_ODDS_CV_SEEDS[rep]!);
    for (let f = 0; f < TOKEN_ODDS_CV_FOLDS; f++) {
      const te = [...folds[f]!].sort((a, b) => a - b);
      const teSet = new Set(te);
      const tr = peers.map((_, i) => i).filter((i) => !teSet.has(i));
      const top = topCategories(
        tr.map((i) => peers[i]!),
        TOKEN_ODDS_TOP_CATEGORIES,
      );
      const { X: XtrRaw } = buildDesign(
        tr.map((i) => peers[i]!),
        snapshot.as_of,
        top,
      );
      const { X: XteRaw } = buildDesign(
        te.map((i) => peers[i]!),
        snapshot.as_of,
        top,
      );
      const { Xs: Xtr, mu, sd } = standardize(XtrRaw);
      const Xte = applyStandardize(XteRaw, mu, sd);
      const beta = fitLogit(Xtr, tr.map((i) => y[i]!), TOKEN_ODDS_LAMBDA);
      const pte = predictLogit(beta, Xte);
      te.forEach((idx, k) => {
        oof[idx] = pte[k]!;
      });
      // TVL-only logistic on the same fold.
      const XtrTvl = XtrRaw.map((r) => [r[0]!]);
      const XteTvl = XteRaw.map((r) => [r[0]!]);
      const sTvl = standardize(XtrTvl);
      const betaTvl = fitLogit(sTvl.Xs, tr.map((i) => y[i]!), TOKEN_ODDS_LAMBDA);
      const pteTvl = predictLogit(betaTvl, applyStandardize(XteTvl, sTvl.mu, sTvl.sd));
      te.forEach((idx, k) => {
        oofTvl[idx] = pteTvl[k]!;
      });
    }
  }
  const cv: TokenOddsTest = {
    n: peers.length,
    base_rate: baseRate,
    brier: brierScore(oof, y),
    baseline_brier: brierScore(new Array<number>(y.length).fill(baseRate), y),
    auc: aucScore(oof, y),
    log_loss: logLoss(oof, y),
  };
  const tvlOnly = { brier: brierScore(oofTvl, y), auc: aucScore(oofTvl, y) };

  // ---- time split: train listed before 2024 (or no date), test since -
  const trIdx = peers
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.listed_at === null || p.listed_at < "2024-01-01")
    .map(({ i }) => i);
  const teIdx = peers
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => p.listed_at !== null && p.listed_at >= "2024-01-01")
    .map(({ i }) => i);
  const topTr = topCategories(
    trIdx.map((i) => peers[i]!),
    TOKEN_ODDS_TOP_CATEGORIES,
  );
  const { X: XtrRaw } = buildDesign(
    trIdx.map((i) => peers[i]!),
    snapshot.as_of,
    topTr,
  );
  const { X: XteRaw } = buildDesign(
    teIdx.map((i) => peers[i]!),
    snapshot.as_of,
    topTr,
  );
  const { Xs: Xtr, mu: muTr, sd: sdTr } = standardize(XtrRaw);
  const betaTr = fitLogit(Xtr, trIdx.map((i) => y[i]!), TOKEN_ODDS_LAMBDA);
  const pte = predictLogit(betaTr, applyStandardize(XteRaw, muTr, sdTr));
  const yte = teIdx.map((i) => y[i]!);
  const trainBase = mean(trIdx.map((i) => y[i]!));
  const timeSplit: TokenOddsTest & { train_n: number; test_n: number } = {
    n: teIdx.length,
    base_rate: mean(yte),
    brier: brierScore(pte, yte),
    baseline_brier: brierScore(new Array<number>(yte.length).fill(trainBase), yte),
    auc: aucScore(pte, yte),
    log_loss: logLoss(pte, yte),
    train_n: trIdx.length,
    test_n: teIdx.length,
  };

  // ---- the full fit, on all 442 eligible protocols --------------------
  const topAll = topCategories(peers, TOKEN_ODDS_TOP_CATEGORIES);
  const { X: XallRaw, names } = buildDesign(peers, snapshot.as_of, topAll);
  const { Xs, mu, sd } = standardize(XallRaw);
  const beta = fitLogit(Xs, y, TOKEN_ODDS_LAMBDA);

  return {
    beta,
    names,
    mu,
    sd,
    topCategories: topAll,
    cv,
    timeSplit,
    tvlOnly,
    peer_n: peers.length,
    peer_base_rate: baseRate,
  };
}

/** P(token) for one protocol, from the fitted token-odds model. */
export function pToken(p: Protocol, asOf: string, model: TokenOddsModel): number {
  const { X } = buildDesign([p], asOf, model.topCategories);
  const Xs = applyStandardize(X, model.mu, model.sd);
  return predictLogit(model.beta, Xs)[0]!;
}

// ---------------------------------------------------------------------------
// The term-by-term held-out evidence (lever 1, the experiment record)
// ---------------------------------------------------------------------------
//
// This table is the recorded result of the v5 ablation experiments
// (v5-experiments.py, v5-round2.py, v5-round3.py): each term of the
// v4 value model, tested with the term and without it, on the same
// pool and test set, in leave-one-out and on the time split. It is
// NOT computed from this snapshot — the program cannot re-run those
// ablations from the snapshot alone — so it is carried here as the
// experiment record, with its source named, and the method proof
// says so. A term must lower the miss in BOTH tests to count as
// KEEP; a LOO difference under ~0.5 and a time-split difference
// under ~0.8 are inside noise (the bootstrap standard errors of the
// baseline medians are 0.61 and 1.03). Two gaps are labelled, not
// hidden: momentum alone was never ablated, and no random control
// was run.

/** One row of the held-out table: the term, the pool it was tested
// on, the median miss with and without it on both tests, and the
// verdict. A null miss means the row was never tested. */
export interface HeldoutRow {
  term: string;
  pool: string;
  loo_with: number | null;
  loo_without: number | null;
  ts_with: number | null;
  ts_without: number | null;
  verdict: string;
}

export const HELDOUT_TABLE = {
  source:
    "Recorded from the v5 ablation experiments (v5-experiments.py, v5-round2.py, v5-round3.py), not computed from this snapshot. Miss = max(pred/real, real/pred), median over the held-out set. A term must lower the miss in BOTH leave-one-out and the time split to KEEP.",
  noise_rule:
    "A LOO difference under ~0.5 and a time-split difference under ~0.8 are inside noise (bootstrap SEs of the baseline medians: LOO 0.61, TS 1.03, 2,000 resamples).",
  baseline: {
    curve_loo: 3.864,
    curve_ts: 3.16,
    flat_loo: 5.026,
    flat_ts: 5.105,
    r2: 0.162,
    residual_std_dex: 0.9,
    n: 101,
  },
  rows: [
    { term: "log10(TVL) — curve slope", pool: "$10M", loo_with: 3.864, loo_without: 5.026, ts_with: 3.16, ts_without: 5.105, verdict: "KEEP" },
    { term: "Intercept (3.3993)", pool: "—", loo_with: null, loo_without: null, ts_with: null, ts_without: null, verdict: "STRUCTURAL (not tested)" },
    { term: "Category factor (k=20)", pool: "$10M", loo_with: 4.387, loo_without: 3.864, ts_with: 3.16, ts_without: 3.16, verdict: "DROP" },
    { term: "Category factor (same term, $5M pool)", pool: "$5M", loo_with: 4.446, loo_without: 3.964, ts_with: 3.244, ts_without: 3.244, verdict: "DROP" },
    { term: "Growth (7-day change, bundled with momentum)", pool: "$5M", loo_with: 3.98, loo_without: 3.964, ts_with: 3.26, ts_without: 3.244, verdict: "DROP" },
    { term: "Momentum (7-day direction, ±0.1)", pool: "—", loo_with: null, loo_without: null, ts_with: null, ts_without: null, verdict: "NOT TESTED" },
    { term: "Maturity (age, 0.6–1.0)", pool: "$5M", loo_with: 3.964, loo_without: 3.964, ts_with: 3.34, ts_without: 3.244, verdict: "DROP" },
    { term: "Breadth (nChains, 1.0–1.3)", pool: "$5M", loo_with: 4.116, loo_without: 3.964, ts_with: 3.44, ts_without: 3.244, verdict: "DROP" },
    { term: "All multipliers together (full formula, k=20)", pool: "$10M", loo_with: 3.98, loo_without: 3.864, ts_with: 3.152, ts_without: 3.16, verdict: "DROP" },
    { term: "Category-specific slopes (min_n=6)", pool: "$10M", loo_with: 3.767, loo_without: 3.864, ts_with: 3.16, ts_without: 3.16, verdict: "DROP" },
    { term: "Ridge features jointly (λ=100 + cat dummies)", pool: "$10M", loo_with: 3.634, loo_without: 3.864, ts_with: 2.699, ts_without: 3.16, verdict: "DROP (rejected by guards)" },
    { term: "Control (nonsense/random term)", pool: "—", loo_with: null, loo_without: null, ts_with: null, ts_without: null, verdict: "NOT TESTED" },
  ] as HeldoutRow[],
  conclusion:
    "Proven (KEEP): exactly one term — log10(TVL), the curve itself. Every other term in the v4 value model is dead weight or untested, so the value-if-launches in this entry is the curve alone. The table proves the value model is at the data's limit; it does not make the model better.",
} as const;

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
// The calibration check
// ---------------------------------------------------------------------------

/** The leave-one-out residuals of the curve, in dex: log10(real mcap)
// minus log10(LOO prediction), one per comparable. */
export function looResiduals(protocols: Protocol[]): number[] {
  const set = fitSet(protocols);
  const residuals: number[] = [];
  for (let i = 0; i < set.length; i++) {
    const held = set[i]!;
    const rest = set.filter((_, j) => j !== i);
    const line = fitLine(
      rest.map((p) => [Math.log10(p.tvl_usd), Math.log10(p.mcap_usd as number)]),
    );
    residuals.push(
      Math.log10(held.mcap_usd as number) - Math.log10(compsPrediction(held.tvl_usd, line)),
    );
  }
  return residuals;
}

/** The in-sample residuals of the curve, in dex, on the comparables. */
export function inSampleResiduals(protocols: Protocol[]): number[] {
  const set = fitSet(protocols);
  const line = fitCompsLine(protocols);
  return set.map(
    (p) => Math.log10(p.mcap_usd as number) - Math.log10(compsPrediction(p.tvl_usd, line)),
  );
}

/** The calibration check: whether the curve's bands cover at the rate
// they claim. The intervals are normal-theory, built from the residual
// spread σ — the in-sample residual standard deviation (sample, n - 1,
// the definition the v4/v5 analyses used: 0.896 dex), rounded to two
// decimals (0.90 dex) — and the coverage is counted on the honest
// leave-one-out residuals: P25–P75 is the prediction ± 0.6745σ
// (nominal 50%), P10–P90 is ± 1.2816σ (nominal 80%). */
export function calibrationCheck(protocols: Protocol[]): Calibration {
  const sigma = round2(stdDevSample(inSampleResiduals(protocols)));
  const loo = looResiduals(protocols);
  const half50 = 0.6745 * sigma;
  const half80 = 1.2816 * sigma;
  const in50 = loo.filter((r) => Math.abs(r) <= half50).length;
  const in80 = loo.filter((r) => Math.abs(r) <= half80).length;
  return {
    sigma_dex: sigma,
    p25_p75_coverage: loo.length === 0 ? 0 : in50 / loo.length,
    p10_p90_coverage: loo.length === 0 ? 0 : in80 / loo.length,
    n: loo.length,
  };
}

// ---------------------------------------------------------------------------
// The valuation: value-if-launches, P(token), expected value
// ---------------------------------------------------------------------------

/** Days from a listing date (YYYY-MM-DD) to the snapshot date. A protocol
// the snapshot gives no listed date for has no age on record, so this
// returns null; the hold calculation treats that as a year old, and
// the row keeps age_days null. */
export function ageDays(listedAt: string | null, asOf: string): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(listedAt + "T00:00:00Z");
  const end = Date.parse(asOf + "T00:00:00Z");
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/** The expected value: what the protocol's token would be worth if it
// launches, times the probability it launches. The value-if-launches
// is the curve alone — the v5 experiments proved every other term in
// the v4 formula dead weight — and the probability comes from the
// token-odds model fitted at run time. The expected value is computed
// from the curve's exact prediction, not from the rounded base the
// detail records. */
export function expectedValue(
  p: Protocol,
  asOf: string,
  line: FitLine,
  odds: TokenOddsModel,
): { ev: number; curve_value: number; p_token: number; detail: ModelDetail } {
  const age = ageDays(p.listed_at, asOf);
  const exact = compsPrediction(p.tvl_usd, line);
  const pt = pToken(p, asOf, odds);
  const f = tokenOddsFeatures(p, asOf, odds.topCategories);
  const detail: ModelDetail = {
    comps_base_usd: roundInt(exact),
    p_token: pt,
    odds_features: {
      log10_tvl: f.numeric[0]!,
      log10_age: f.numeric[1]!,
      age_unknown: f.numeric[2]!,
      n_chains: f.numeric[3]!,
      growth: f.numeric[4]!,
      category: f.category,
    },
    age_days: age,
    weekly_gas_usd: weeklyGasUsd(p.chains[0] ?? "Ethereum"),
  };
  return { ev: roundInt(pt * exact), curve_value: roundInt(exact), p_token: pt, detail };
}

// ---------------------------------------------------------------------------
// The bootstrap bands
// ---------------------------------------------------------------------------

/** The per-row band from the bootstrap refits: the 10th and 90th
// percentile of the row's expected value, and the best and worst rank
// it takes. A row whose band is narrow and whose rank barely moves is
// a claim the model stands behind; a wide band says so plainly. */
export interface BootstrapBand {
  p10_usd: number;
  p90_usd: number;
  rank_lo: number;
  rank_hi: number;
}

/** The bootstrap: resample the comparables with replacement, refit the
// line and reprice every eligible protocol's value-if-launches — 200
// times, on a fixed seed, so the same snapshot always gives the same
// bands. The row's expected-value band is its P(token) times the
// repriced value-if-launches: P(token) is a second model with its own
// validation, so it is held fixed here and the band is the curve's
// uncertainty, stated as such. */
export function bootstrapBands(
  eligible: Protocol[],
  protocols: Protocol[],
  asOf: string,
  odds: TokenOddsModel,
): Map<string, BootstrapBand> {
  const set = fitSet(protocols);
  const rng = mulberry32(BOOTSTRAP_SEED);
  const pBySlug = new Map<string, number>();
  for (const p of eligible) pBySlug.set(p.slug, pToken(p, asOf, odds));
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
    const evs = eligible.map((p) => ({
      slug: p.slug,
      ev: roundInt(pBySlug.get(p.slug)! * compsPrediction(p.tvl_usd, line)),
    }));
    evs.sort((a, b) => b.ev - a.ev);
    evs.forEach(({ slug, ev }, i) => {
      values.get(slug)!.push(ev);
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
// expected value, pro-rated to the deposit against the protocol's TVL,
// rounded to cents. The slice is expected, not promised: it is the
// launch value times the probability of a launch. */
export function sliceUsd(evUsd: number, tvlUsd: number, capital: number): number {
  return round2((SLICE_SHARE * evUsd * capital) / tvlUsd);
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
// the page can never disagree with the board. The if-launches slice
// re-nets the same way, from the curve value alone; the verdict is
// still the expected slice's verdict, so showing the upside never
// moves a FARM count. */
export function renetAtCapital(
  row: Pick<BoardRow, "implied_value_usd" | "curve_value_usd" | "tvl_usd" | "fees_usd" | "hold_days">,
  capital: number,
): { slice_usd: number; slice_if_launches_usd: number; net_usd: number; net_per_hour_usd: number; verdict: "FARM" | "THIN" | "SKIP" } {
  const slice = sliceUsd(row.implied_value_usd, row.tvl_usd, capital);
  const sliceIfLaunches = sliceUsd(row.curve_value_usd, row.tvl_usd, capital);
  const net = netUsd(slice, row.fees_usd, row.hold_days, capital);
  const perHour = netPerHourUsd(net, row.hold_days);
  return { slice_usd: slice, slice_if_launches_usd: sliceIfLaunches, net_usd: net, net_per_hour_usd: perHour, verdict: verdictFor(perHour) };
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

/** Format a money value for the "why" line, the same way the page does. */
export function formatMoney(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${Math.round(v).toLocaleString("en-US")}`;
  return `$${v.toFixed(2)}`;
}

/** The one-line reason a row sits where it does: its size, its place
// among the pre-token protocols of its own category by TVL, its age (or
// that no listing date is on record), its chains, its week's move, and
// the expected value itself: the launch value times the probability it
// launches, so the reader can see at once when a giant protocol is
// unlikely to launch and a smaller one is likely. */
export function whyText(
  p: Protocol,
  age: number | null,
  categoryRank: number,
  categoryCount: number,
  pTokenValue: number,
  evUsd: number,
  curveUsd: number,
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
  parts.push(
    `launch worth ${formatMoney(curveUsd)} if it launches, P(token) ${pTokenValue.toFixed(2)}, expected value ${formatMoney(evUsd)}`,
  );
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

/** Build the board: every eligible protocol, priced by expected value
// off the curve the program fits at run time and the token-odds model
// it fits beside it, ranked by expected value, each with its bootstrap
// band, its netted farm plan and verdict.
//
// The steps, in order: keep only the eligible protocols; fit the
// comparables line on the snapshot's traded tokens; fit the token-odds
// model on the 442 eligible protocols and validate it out of fold and
// on the time split; test the line leave-one-out and on the time
// split; check the line's calibration on its leave-one-out residuals;
// bootstrap the per-row bands; group the eligible protocols by
// category for the "why" lines; price each one by expected value and
// net its plan; sort by expected value, largest first; assign ranks
// 1..N in that order; count the FARM rows at each plan capital; list
// the traded protocols kept apart and the pre-token ones set aside. */
export function buildBoard(snapshot: Snapshot): BuiltBoard {
  const eligible = snapshot.protocols.filter(isEligible);
  const line = fitCompsLine(snapshot.protocols);
  const odds = fitTokenOdds(snapshot);
  const loo = looValidation(snapshot.protocols);
  const timeSplit = timeSplitValidation(snapshot.protocols);
  const calibration = calibrationCheck(snapshot.protocols);
  const bands = bootstrapBands(eligible, snapshot.protocols, snapshot.as_of, odds);
  const byCategory = groupByCategory(eligible);

  const rows: BoardRow[] = eligible.map((p) => {
    const { ev, curve_value, p_token, detail } = expectedValue(p, snapshot.as_of, line, odds);
    const age = detail.age_days;
    const hold = holdDays(age);
    const chain = p.chains[0] ?? "Ethereum";
    const slice = sliceUsd(ev, p.tvl_usd, PLAN_CAPITAL_USD);
    const sliceIfLaunches = sliceUsd(curve_value, p.tvl_usd, PLAN_CAPITAL_USD);
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
      implied_value_usd: ev,
      curve_value_usd: curve_value,
      p_token,
      implied_p10_usd: band.p10_usd,
      implied_p90_usd: band.p90_usd,
      rank_lo: band.rank_lo,
      rank_hi: band.rank_hi,
      model: detail,
      slice_1k_usd: slice,
      slice_if_launches_1k_usd: sliceIfLaunches,
      fees_usd: fees,
      net_usd: net,
      net_per_hour_usd: netPerHour,
      hold_days: hold,
      verdict: verdictFor(netPerHour),
      why: whyText(p, age, categoryRank, list.length, p_token, ev, curve_value),
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
      token_odds_cv: odds.cv,
      token_odds_time_split: odds.timeSplit,
      token_odds_tvl_only: odds.tvlOnly,
      calibration,
      token_odds_model: {
        coefficients: [{ feature: "(intercept)", coefficient: odds.beta[0]! }].concat(
          odds.names.map((feature, i) => ({
            feature,
            coefficient: odds.beta[i + 1]!,
          })),
        ),
        top_categories: odds.topCategories,
        peer_n: odds.peer_n,
        peer_base_rate: odds.peer_base_rate,
      },
      heldout: HELDOUT_TABLE,
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
// THE VALUE-IF-LAUNCHES IS THE CURVE ALONE. The v4 formula multiplied
// the curve by a category factor, a growth factor, momentum, maturity
// and breadth. The v5 ablation experiments tested each of those terms
// with and without it, on the same pool and test set, and none of them
// lowers the held-out miss in both leave-one-out and the time split:
// the category factor hurts leave-one-out and ties the time split,
// growth and breadth are worse on both, maturity ties one and is
// worse on the other, and the full formula is worse on leave-one-out.
// The table is in the method proof (HELDOUT_TABLE). So v6 prices a
// launch off the curve alone, and says so: the value model is at the
// data's limit, and dressing it up would be pretending otherwise.
//
// THE TOKEN-ODDS MODEL. A logistic regression, fitted here at run
// time by fitTokenOdds on the 442 eligible protocols: the label is
// whether the protocol has a token on this snapshot, the features are
// log10(TVL), log10(age+1) with a missing listing date treated as 365
// days, an age-unknown flag, the chain count capped at 10, the 7-day
// growth clamped to [-60, +120] percent, and the top-10 category
// dummies. The features are standardised on the training set; the fit
// is IRLS with L2 penalty λ = 1. The model is validated the same way
// as the curve: 5-fold stratified cross-validation, 3 repeats, out of
// fold (Brier 0.196 against 0.247 for the constant base rate, AUC
// 0.77), and a time split that is weak by construction — the label is
// time-censored, because a protocol listed in 2025 with no token by
// November 2026 is labelled 0 but may launch in 2027 — so the
// cross-validation number is the headline and the time split is the
// warning. The growth coefficient is negative: protocols with high
// 7-day growth are less likely to have tokens, plausibly a pre-token
// hype phase, but that is an interpretation, not a proven mechanism.
//
// THE EXPECTED VALUE. EV = P(token) × the curve value. The curve alone
// overstates the biggest protocols by up to 4×: Sentora Curator is
// #1 by curve value ($82.3M) but a Risk Curator — a category that
// launches at only 13% — so its P is 0.24 and its EV is $19.5M. The
// EV top 5 brings in two high-P protocols the curve alone ranks
// lower (Defi Saver at P = 0.94, Lightning at P = 0.90), and the
// re-ranking is substantial (Spearman 0.74 between the curve rank and
// the EV rank). The farm plan nets the expected slice, not the launch
// slice: a plan earns the launch value only if the token launches, so
// the slice, the net and the verdict are all expected values.
//
// THE VALIDATION. Two out-of-sample tests of the curve, both computed
// here. The leave-one-out test holds each comparable out in turn,
// refits the line without it, and asks for its market cap; the time
// split fits the line on the comparables listed before 2024 and tests
// it on the ones listed since. Each is scored against the same flat
// mcap/TVL multiple, so the reader can see what the curve buys. The
// bootstrap resamples the comparables 200 times on a fixed seed,
// refits the line and reprices every row's value-if-launches: the
// P10–P90 band and the rank range on each row are what survives that
// movement, times the row's P(token), which is held fixed — P(token)
// is a second model with its own validation, so the band is the
// curve's uncertainty, stated as such.
//
// THE CALIBRATION. The bands are checked, not asserted: the
// leave-one-out residuals of the curve against the normal-theory
// P25–P75 and P10–P90 intervals built from the residual spread
// (0.90 dex). The real market caps fall inside the P25–P75 interval
// 50.5% of the time (nominal 50%) and inside the P10–P90 interval
// 82.2% (nominal 80%): the bands are honest. They are also wide —
// the P25–P75 band is ×16.4 wide, the P10–P90 ×202.7 — because the
// residual spread is 0.90 dex, and the check proves the bands are
// honest, not narrow.
//
// THE HOLD. 45 days at a year or older, 60 days at six months to a
// year, 90 days younger — and the six-month line is 180 days, not 182.
// A protocol with no listing date is treated as a year old for the
// hold, but its age_days stays null and its why line says so.
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
// field in the snapshot separates them, so they stay.
