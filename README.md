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

Entry for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01).

## How it works

**The valuation.** A comparables curve is fitted to the tokens that
already trade, at run time, by ordinary least squares: log10(market
cap) on log10(TVL) over the traded tokens with TVL of $10M or more.
On the sealed snapshot that line is log10(mcap) = 3.399 + 0.478 ×
log10(TVL), n = 101, R² = 0.16. Every pre-token protocol is priced
off that curve, then calibrated by its category — the median of its
traded tokens' distance from the curve, shrunk toward 1 by the count
of traded tokens — moved by its 7-day change (half the move, clamped
to −60%…+120%, plus momentum of a tenth past a 20% week), tempered by
its age (0.6 at launch, 1.0 at three years) and widened by its breadth
(3% per chain after the first, up to ten extra chains).

**The validation.** Two out-of-sample tests, computed by the program
and shown on the page. Leave-one-out: each comparable is held out in
turn, the line is refit without it, and its market cap is asked for —
median miss ×3.86, within 3× 42%, within 10× 77%, against ×5.03 /
39% / 74% for one flat mcap/TVL multiple. Time split: the line is
fitted on the 34 comparables listed before 2024 and tested on the 40
listed since — ×3.16 / 48% / 80% against ×5.10 / 40% / 75% flat.
Every row's band is the P10–P90 of 200 bootstrap refits, with its
rank range: the comparables are resampled, the line is refit, the
category factors are recalibrated, and every row is repriced.

**The farm plan.** The slice is a tenth of the protocol's implied
value, pro-rated to the deposit against its TVL. The plan costs $1 to
open the wallet, $2 to deposit, $1 to claim and the weekly gas —
$0.50 a week on Ethereum and Bitcoin, where a transaction is L1 gas,
$0.05 a week everywhere else, where a swap costs cents. The forgone
yield is the T-bill rate, 4% a year, pro-rated to the hold. The hold
is 45 days for a protocol a year or older, 60 days for six months to
a year, 90 days for younger. Hands-on time is 5 minutes to open the
wallet, 15 to deposit, 10 to check points, 10 to claim and 5 minutes
a week for the qualifying action. The verdict is FARM at $5 or more
net per hour, THIN at $0 to $5, SKIP below $0. The steps name their
chain's gas figure and their 5 weekly minutes, so the plan's money
and its words always agree — and the steps are written for the
protocol: the deposit, the weekly action and the points check vary
by what the protocol is, which way its week went, how big it is and
whether it is new, in more than 40 distinct weekly-action templates.

**The capital.** The board is priced at $1,000, and the page re-nets
every plan at $1,000, $2,500, $5,000 or $10,000: the slice and the
forgone yield scale with the capital, the fees and the hours are
fixed. At $1,000 the board farms 133 rows, at $2,500 it farms 166,
at $5,000 180, at $10,000 189 — and 9 rows stay SKIP even at
$10,000: the biggest protocols, where the slice is too thin next to
the yield given up to hold it.

**Eligibility.** A protocol makes the board when it is a pre-token
protocol in its own right: it records no token, it is not a bridge, a
liquid-staking or restaking product, a CEX or a wrapped/staked product,
its name carries no version marker and does not begin with an
exchange's name.

**The board.** Every eligible protocol, ranked by implied value,
largest first, each with its bootstrap band and rank range, the netted
plan, the verdict, a one-line why and the seven concrete farm steps.
The dashboard renders the board as a filterable table — by text,
verdict and category, sorted by implied value, net per hour, net per
plan or TVL — with a sidebar carrying the market line, the five farms
worth doing next and the validation in one box, and tabs for the 416
traded tokens kept apart, the 144 pre-token protocols set aside with
their reasons, and the method with its tests. A click on a row opens
the detail panel with the valuation broken down and the plan.

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
`dashboard/`, so the dossier's text carries the fitted line and the
validation numbers the program computed), and the dossier
(`dossier.json`) last, built with `buildDossier` from
`vendor/makefun-board.ts`.

## Check it

```
# The seven gates the competition runs, re-run locally:
node local-gates.mjs --out out

# Re-take the four dashboard screenshots (needs headless Chrome):
node screenshots.mjs --out out
```

The seven gates are: the dashboard's files are present and within
their caps with no network address in the source; the board has
100–4000 valid rows; the ranks run 1..N with implied value
non-increasing; every watchlist slug is present; every row's farm
steps are 3–12 strings of 20–600 characters; the screenshots are 3–4
images within their size limits; and the dossier is byte-identical to
what `buildDossier` writes from the output directory.

## Files

| File | What it is |
| --- | --- |
| `main.ts` | The program: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | The valuation, the validation, the farm plan and the board |
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

On the sealed snapshot the board holds 198 pre-token protocols: 133
FARM, 31 THIN, 34 SKIP at $1,000. The largest implied value is
Steakhouse Financial at about $91.7M; the top of the board is
dominated by Risk Curators, Lending and Onchain Capital Allocators,
the categories whose tokens trade at the highest multiples of TVL.
The highest net per hour at $1,000 is Theo Network thBill at about
$57.73 an hour. A FARM plan nets $5 or more per hands-on hour after
the slice, the fees and the forgone T-bill yield are all counted.

## Verification

Every number the program reports is recomputed from the snapshot by
an independent script, not by the program checking itself: the fitted
line (3.3993 / 0.4783, R² 0.162, n = 101), the leave-one-out numbers
(×3.86 / 42% / 77% against ×5.03 / 39% / 74% flat), the time-split
numbers (×3.16 / 48% / 80% against ×5.10 / 40% / 75% flat), the top-10
implied values, and the FARM counts at each capital (133 / 166 / 180 /
189) all match. The build is deterministic: two runs write
byte-identical output. The seven gates pass locally.

The board holds 198 rows where the reference board holds 178: the 20
extra protocols pass the field-guide eligibility rule and no snapshot
field separates them from the reference's 178. Under the cheaper
weekly gas and the five weekly minutes, three of the 20 are FARM and
49 of the 178 common rows flip verdict — all upward, THIN to FARM or
SKIP to THIN — because the plans net more than they did under the
flat gas and the ten weekly minutes.
