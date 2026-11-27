# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar: it reads a sealed DefiLlama snapshot of every
protocol, prices every protocol with no token yet off the tokens that
already trade, and nets a farm plan for each one — the slice minus
fees, gas and the yield you give up by parking the capital, per plan
and per hands-on hour, with a FARM / THIN / SKIP verdict. The model is
fitted at run time, tested out of sample, and the numbers are shown on
the page — no name is ever hardcoded.

The headline is **expected value**: the value a launch would carry,
times the probability it launches at all. The curve alone overstates
the biggest protocols by up to 4× — Sentora Curator is $82.3M if it
launches, but its P(token) is 0.24, so its expected value is $19.5M.
The board ranks by expected value, largest first.

Entry for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01).

## How it works

**The valuation.** A comparables curve is fitted to the tokens that
already trade, at run time, by ordinary least squares: log10(market
cap) on log10(TVL) over the traded tokens with TVL of $10M or more.
On the sealed snapshot that line is log10(mcap) = 3.399 + 0.478 ×
log10(TVL), n = 101, R² = 0.16. The value-if-launches is the curve
alone. Every other term the old formula carried — the category
factor, the growth multiplier, momentum, maturity, breadth — was
tested with and without it, on two held-out tests, and none of them
lowers the held-out miss in both tests (the table is in the method
tab, and below). The curve is maxed out: the value model is one term.

**The token odds.** A second model gives P(token): a logistic
regression on the 442 eligible protocols, fitted at run time by
iteratively reweighted least squares with an L2 penalty of λ = 1.
Features, standardised: log10(TVL), log10(age + 1), an age-unknown
flag, the chain count, the 7-day growth (clamped to −100%…+100%),
and dummies for the ten largest categories. The largest coefficients
(log-odds per standard deviation): age-unknown +0.63, log10(age+1)
+0.50, log10(TVL) +0.37, Dexs +0.28, Lending +0.28, chains +0.22,
Risk Curators −0.53, growth −0.57. Growth is negative: high 7-day
growth goes with no token yet — plausibly a pre-token hype phase,
stated as an interpretation, not a proven mechanism. The headline
numbers are 5-fold stratified cross-validation, 3 repeats, out of
fold: Brier 0.1958 against 0.2473 for the constant base rate (20.8%
better), AUC 0.766, log-loss 0.578. A TVL-only logistic scores
Brier 0.2439 (AUC 0.556) — the signal comes from age, chains,
category and growth, not from size alone. The time split (fit the
141 listed before 2024, test the 301 listed since) is weak — Brier
0.4049 against 0.4526, AUC 0.574 — because the label is
time-censored: a protocol listed in 2025 with no token by now is
labelled 0 but may launch later. The cross-validation number is the
headline; the time split is the warning, and it is shown on the
page as such.

**The expected value.** EV = P(token) × the curve value. The
re-ranking is real but not a reshuffle: Spearman between the curve
rank and the EV rank is 0.738. The top 5 by EV: Veda $40.5M
(P 0.646), Steakhouse Financial $32.8M (P 0.399), USDD $28.0M
(P 0.539), Defi Saver Asset Management $25.8M (P 0.941), Lightning
Network $21.9M (P 0.895). P(token) runs 0.063 at the 10th
percentile, 0.399 at the median, 0.729 at the 90th; 37% of rows are
above 0.5, 32% below 0.3. The smallest EV on the board is $8,679,
and EV is non-increasing down the board.

**The calibration.** The bands are checked, not asserted. The
leave-one-out residuals of the curve, against the normal-theory
intervals built from the residual spread (0.90 dex): the real
market caps fall inside the P25–P75 interval 50.5% of the time
(nominal 50%, n = 101) and inside the P10–P90 interval 82.2%
(nominal 80%). The residuals are near-normal (Shapiro–Wilk p ≈
0.5–0.6). The bands are honest — but wide: the P25–P75 band is
×16.4 wide and the P10–P90 ×202.7, because the residual spread is
0.90 dex. The check proves the bands are honest, not narrow.
Every row's band is the P10–P90 of 200 bootstrap refits, times the
row's P(token), which is held fixed — P(token) is a second model
with its own validation, so the band is the curve's uncertainty,
stated as such.

**The held-out table.** Each term of the old value formula, tested
with and without it, on both held-out tests (median miss). A term
is kept only if it lowers the miss in both tests, by more than the
noise — about ×0.5 on leave-one-out and about ×0.8 on the time
split (round 3; the bootstrap SEs of the baseline medians are LOO
0.61 and TS 1.03, 2,000 resamples). The "without" baseline matches
each row's pool: the $10M-pool curve (3.864 / 3.160) for the $10M
rows, the $5M-pool curve (3.964 / 3.244) for the $5M rows. The
numbers are the recorded v5 experiment results, also in
`method.json`.

| Term | Pool | LOO with | LOO without | Time split with | Time split without | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| log10(TVL) | $10M | ×3.864 | ×5.026 (flat) | ×3.160 | ×5.105 (flat) | KEEP |
| Intercept (3.3993) | — | — | — | — | — | STRUCTURAL (not tested) |
| Category factor (k=20) | $10M | ×4.387 | ×3.864 | ×3.160 | ×3.160 | DROP |
| Category factor (same term, $5M pool) | $5M | ×4.446 | ×3.964 | ×3.244 | ×3.244 | DROP |
| Growth (7-day change, bundled with momentum) | $5M | ×3.980 | ×3.964 | ×3.260 | ×3.244 | DROP |
| Momentum (7-day direction, ±0.1) | — | — | — | — | — | NOT TESTED |
| Maturity (age, 0.6–1.0) | $5M | ×3.964 | ×3.964 | ×3.340 | ×3.244 | DROP |
| Breadth (nChains, 1.0–1.3) | $5M | ×4.116 | ×3.964 | ×3.440 | ×3.244 | DROP |
| All multipliers together (full formula, k=20) | $10M | ×3.980 | ×3.864 | ×3.152 | ×3.160 | DROP |
| Category-specific slopes (min_n=6) | $10M | ×3.767 | ×3.864 | ×3.160 | ×3.160 | DROP |
| Ridge features jointly (λ=100 + cat dummies) | $10M | ×3.634 | ×3.864 | ×2.699 | ×3.160 | DROP (rejected by guards) |
| Control (nonsense/random term) | — | — | — | — | — | NOT TESTED |

The growth row bundles growth AND momentum together — the v5
"growth" number is growth+momentum, not growth alone. Momentum
alone was never ablated, and no random control was run; those two
gaps are labelled, not hidden. The ridge variant is the only one
that beats the curve on both medians (3.634 / 2.699), but it fails
every guard: the paired sign test is 49 wins / 52 losses (it loses
on more tokens than it wins), the 5-fold CV is inconsistent, and it
does not replicate on the $5M pool (LOO 4.368, much worse than the
$5M curve's 3.964) — a median artifact of one λ on one fit set,
not a real improvement. The conclusion
is the value model: exactly one term, log10(TVL). The lever-1 gain
is presentation only — the table is the evidence that the curve is
not under-fitted, it is finished.

**The validation.** Two out-of-sample tests of the curve, computed
by the program and shown on the page. Leave-one-out: each
comparable is held out in turn, the line is refit without it, and
its market cap is asked for — median miss ×3.86, within 3× 42%,
within 10× 77%, against ×5.03 / 39% / 74% for one flat mcap/TVL
multiple. Time split: the line is fitted on the 34 comparables
listed before 2024 and tested on the 40 listed since — ×3.16 /
48% / 80% against ×5.10 / 40% / 75% flat.

**The farm plan.** The slice is a tenth of the protocol's launch
value alone, pro-rated to the deposit against its TVL — what the
slice would be if the token launches, and the slice the net, the net
per hour and the verdict are all computed from: you farm the
allocation only if the token launches. Beside it the board shows a
second slice, a tenth of the expected value — P(token) × the launch
value — pro-rated the same way: the probability-weighted
expectation, shown alongside, never entering the net. The plan costs $1 to open the wallet, $2 to deposit, $1 to claim and the weekly gas — $0.50 a week on Ethereum and Bitcoin,
where a transaction is L1 gas, $0.05 a week everywhere else, where
a swap costs cents. The forgone yield is the T-bill rate, 4% a
year, pro-rated to the hold. The hold is 45 days for a protocol a
year or older, 60 days for six months to a year, 90 days for
younger. Hands-on time is 5 minutes to open the wallet, 15 to
deposit, 10 to check points, 10 to claim and 5 minutes a week for
the qualifying action. The verdict is FARM at $5 or more net per
hour, THIN at $0 to $5, SKIP below $0. The steps name their chain's
gas figure and their 5 weekly minutes, so the plan's money and its
words always agree — and the steps are written for the protocol:
the deposit, the weekly action and the points check vary by what
the protocol is, which way its week went, how big it is and
whether it is new, in more than 40 distinct weekly-action templates.

**The capital.** The board is priced at $1,000, and the page re-nets
every plan at $1,000, $2,500, $5,000 or $10,000: the slice and the
forgone yield scale with the capital, the fees and the hours are
fixed. At $1,000 the board farms 153 rows, at $2,500 it farms 183,
at $5,000 190, at $10,000 191 — and 7 rows stay SKIP even at
$10,000: the biggest protocols, where the launch slice is too thin
next to the yield given up to hold it. The top of the board by
expected value is almost all SKIP at $1,000 — the first FARM row is
rank 19, and none of the top 10 is FARM (one is THIN). Size is not
farmability.

**Eligibility.** A protocol makes the board when it is a pre-token
protocol in its own right: it records no token, it is not a bridge, a
liquid-staking or restaking product, a CEX or a wrapped/staked product,
its name carries no version marker and does not begin with an
exchange's name.

**The board.** Every eligible protocol, ranked by expected value,
largest first, each with its P(token), its value-if-launches, its
bootstrap band and rank range, the netted plan, the verdict, a
one-line why and the seven concrete farm steps. The dashboard
renders the board as a filterable table — by text, verdict and
category, sorted by expected value, P(token), value-if-launches,
net per hour, net per plan or TVL — with a sidebar carrying the
market line, the five farms worth doing next and the validation in
one box, and tabs for the 416 traded tokens kept apart, the 144
pre-token protocols set aside with their reasons, and the method
with its tests. A click on a row opens the detail panel with the
expected value broken down — P(token) and its features, the curve
value — and the plan.

## Run it

```
# Reads MAKEFUN_INPUT_DIR (a file or a directory holding snapshot.json),
# writes to MAKEFUN_OUTPUT_DIR. No arguments needed.
MAKEFUN_INPUT_DIR=<snapshot dir> MAKEFUN_OUTPUT_DIR=out node main.ts

# The same, with flags:
node main.ts --input <snapshot.json> --out out
```

What it writes, in order: the ranked board (`board.json`), the
dashboard's data (`data.js` beside the page), a copy of `dashboard/`
and `screenshots/`, the method proof (`method.json` inside
`dashboard/`, so the dossier's text carries the fitted line, the
token-odds validation, the calibration and the held-out table the
program computed), and the dossier (`dossier.json`) last, built with
`buildDossier` from `vendor/makefun-board.ts`.

## Check it

```
# The seven gates the competition runs, re-run locally:
node local-gates.mjs --out out

# Re-take the four dashboard screenshots (needs headless Chrome):
node screenshots.mjs --out out
```

The seven gates are: the dashboard's files are present and within
their caps with no network address in the source; the board has
100–4000 valid rows; the ranks run 1..N with expected value
non-increasing; every watchlist slug is present; every row's farm
steps are 3–12 strings of 20–600 characters; the screenshots are 3–4
images within their size limits; and the dossier is byte-identical to
what `buildDossier` writes from the output directory.

## Files

| File | What it is |
| --- | --- |
| `main.ts` | The program: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | The valuation, the token-odds model, the validation, the farm plan and the board |
| `vendor/makefun-board.ts` | The dossier builder |
| `dashboard/index.html` | The page |
| `dashboard/app.js` | Renders the board, the tabs, the sidebar, the detail panel |
| `dashboard/app.css` | The styling |
| `screenshots.mjs` | Re-takes the four screenshots with headless Chrome |
| `local-gates.mjs` | The seven-gate replica |
| `screenshots/` | The four dashboard screenshots |

## The snapshot

The snapshot is frozen: every run reads the same bytes — 758 protocols
and a 40-protocol watchlist, as of 2026-11-14, sourced from DefiLlama,
with a $50,000,000 TVL floor. The program runs with no network, in a
fresh container, with a read-only repository and a writable output
directory, on 1 CPU and 1024 MB, in 120 seconds. It runs in under a
second on this snapshot.

## The numbers

On the sealed snapshot the board holds 198 pre-token protocols: 153
FARM, 24 THIN, 21 SKIP at $1,000. The largest expected value is Veda
at about $40.5M (P 0.646, $62.7M if it launches); the top of the
board is dominated by Onchain Capital Allocators, Risk Curators and
CDPs, the categories whose tokens trade at the highest multiples of
TVL — and by the protocols whose P(token) is high enough to keep
them there. The highest net per hour at $1,000 is Nucleus at about
$59.05 an hour. A FARM plan nets $5 or more per hands-on hour after
the if-launches slice, the fees and the forgone T-bill yield are all
counted.

## Verification

Every number the program reports is recomputed from the snapshot by
an independent script, not by the program checking itself: the fitted
line (3.3993 / 0.4783, R² 0.162, n = 101), the leave-one-out numbers
(×3.86 / 42% / 77% against ×5.03 / 39% / 74% flat), the time-split
numbers (×3.16 / 48% / 80% against ×5.10 / 40% / 75% flat), the
token-odds cross-validation (Brier 0.1958 vs 0.2473, AUC 0.766,
log-loss 0.578, n = 442), the calibration coverage (P25–P75 50.5%,
P10–P90 82.2%), the top-5 expected values, and the FARM counts at
each capital (153 / 183 / 190 / 191) all match. The build is
deterministic: two runs write byte-identical output. The seven gates
pass locally.

The board holds 198 rows where the reference board holds 178: the 20
extra protocols pass the field-guide eligibility rule and no snapshot
field separates them from the reference's 178. Under the cheaper
weekly gas and the five weekly minutes, three of the 20 are FARM and
49 of the 178 common rows flip verdict — all upward, THIN to FARM or
SKIP to THIN — because the plans net more than they did under the
flat gas and the ten weekly minutes.
