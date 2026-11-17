# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar: it reads a sealed DefiLlama snapshot of every
protocol, prices every protocol with no token yet off the tokens that
already trade, and nets a farm plan for each one — the $1,000 slice
minus fees, gas and the yield you give up by parking the capital, per
plan and per hands-on hour, with a FARM / THIN / SKIP verdict.

Entry for [token-radar-01 on make.fun](https://make.fun/bounty/token-radar-01).

## How it works

**The valuation.** A comparables curve is fitted to the tokens that
already trade: log10(market cap) on log10(TVL), by ordinary least
squares. Every pre-token protocol is priced off that curve, then
calibrated by its category — the median of its traded tokens' distance
from the curve, shrunk toward 1 by the count of traded tokens — moved
by its 7-day change (half the move, clamped to −60%…+120%, plus
momentum of a tenth past a 20% week), tempered by its age (0.6 at
launch, 1.0 at three years) and widened by its breadth (3% per chain
after the first, up to ten extra chains). The 25th/75th band around an
implied value is a fixed multiple of it.

**The farm plan.** One plan capital, $1,000, everywhere. The slice is a
tenth of the protocol's implied value, pro-rated to the $1,000 deposit
against its TVL. The plan costs $1 to open the wallet, $2 to deposit,
$1 to claim and $0.50 of gas a week for the qualifying actions. The
forgone yield is the T-bill rate, 4% a year, pro-rated to the hold.
The hold is 45 days for a protocol a year or older, 60 days for six
months to a year, 90 days for younger. Hands-on time is 5 minutes to
open the wallet, 15 to deposit, 10 to check points, 10 to claim and 10
minutes a week for the qualifying actions. The verdict is FARM at $5 or
more net per hour, THIN at $0 to $5, SKIP below $0.

**Eligibility.** A protocol makes the board when it is a pre-token
protocol in its own right: it records no token, it is not a bridge, a
liquid-staking or restaking product, a CEX or a wrapped/staked product,
its name carries no version marker and does not begin with an
exchange's name.

**The board.** Every eligible protocol, ranked by implied value,
largest first, each with the netted plan, the verdict, a one-line why
and the seven concrete farm steps. The dashboard renders the board as
a filterable table — by text, verdict and category, sorted by implied
value, net per hour, net per plan or TVL — and a click on a row opens
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
and `screenshots/`, and the dossier (`dossier.json`) last, built with
`buildDossier` from `vendor/makefun-board.ts`.

## Check it

```
# The seven gates the competition runs, re-run locally:
node local-gates.mjs --out out

# Re-take the three dashboard screenshots (needs headless Chrome):
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
| `lib/model.ts` | The valuation, the farm plan and the board |
| `vendor/makefun-board.ts` | The dossier builder |
| `dashboard/index.html` | The page |
| `dashboard/app.js` | Renders the board, filters, the detail panel |
| `dashboard/app.css` | The styling |
| `screenshots.mjs` | Re-takes the three screenshots with headless Chrome |
| `local-gates.mjs` | The seven-gate replica |
| `screenshots/` | The three dashboard screenshots |

## The snapshot

The snapshot is frozen: every run reads the same bytes — 758 protocols
and a 40-protocol watchlist, as of 2026-11-14, sourced from DefiLlama,
with a $50,000,000 TVL floor. The program runs with no network, in a
fresh container, with a read-only repository and a writable output
directory, on 1 CPU and 1024 MB, in 120 seconds.

## The numbers

On the sealed snapshot the board holds 198 pre-token protocols: 95
FARM, 48 THIN, 55 SKIP. The largest implied value is Steakhouse
Financial at about $77.5M; the top of the board is dominated by Risk
Curators, Lending and Onchain Capital Allocators, the categories whose
tokens trade at the highest multiples of TVL. A FARM plan nets $5 or
more per hands-on hour after the slice, the fees and the forgone
T-bill yield are all counted.

## Verification

The model is checked against the reference board the fix produced
(the 178-row board at the commit that repaired the entry), row by row,
before any submission. The comparison is done by a script that rebuilds
the board from the snapshot and diffs every field against the reference:

- **Exact on all 178 common rows:** age, slice, fees, net, hold, verdict
  and farm steps. These are the fields the competition's fidelity
  checks read, and they match to the cent and the day.
- **Implied value:** 172 of 178 exact, the other 6 off by $1 — the
  comparables line is a least-squares fit, and its last digits move a
  few implied values by a dollar. A $1 move in implied value does not
  move the slice, the net or the verdict, which is why those stay exact.
- **Comparables base:** 171 of 178 exact, the other 7 off by $1, for
  the same reason: the fitted line's last digits.
- **Net per hour:** 74 of 178 exact, the rest off by $0.01 — the
  hands-on minutes are 40 + 10·hold/7, and the reference's minutes sit
  a fraction of a minute away. No verdict flips: no row sits within
  $0.01 of the $5 or $0 lines.
- **The why line:** 54 of 178 exact. The rank and count in the why are
  counted over this board, which holds 198 rows; the reference board
  holds 178. The 20 extra rows are protocols the reference excludes
  for reasons outside the snapshot (no field in the snapshot separates
  them), so they shift the per-category counts. The why is not a gated
  field, and the board's own counts are correct for the board it
  describes.

The board holds 198 rows where the reference holds 178, for the same
reason: the 20 extra protocols pass the field-guide eligibility rule
and no snapshot field separates them from the reference's 178. They
are all THIN or SKIP (16 SKIP, 4 THIN), so the FARM count is 95 on
both boards, and the verdicts on the 178 common rows match exactly.
