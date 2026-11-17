# Token Radar

A token-launch radar: it reads a sealed DefiLlama snapshot of every
protocol, prices every protocol with no token yet off the tokens that
already trade, and nets a farm plan for each one — the $1,000 slice minus
fees, gas and the yield you give up by parking the capital, per plan and
per hands-on hour, with a FARM / THIN / SKIP verdict.

## How it works

**The valuation.** A comparables curve is fitted to the tokens that
already trade: log10(market cap) on log10(TVL). Every pre-token protocol
is priced off that curve, then calibrated by its category, moved by its
7-day change (half the move, clamped to −60%…+120%, plus momentum of a
tenth past a 20% week), tempered by its age (0.6 at launch, 1.0 at three
years) and widened by its breadth (3% per chain after the first, up to
ten extra chains). The 25th/75th band around an implied value is a fixed
multiple of it.

**The farm plan.** One plan capital, $1,000, everywhere. The slice is a
tenth of the protocol's implied value, pro-rated to the $1,000 deposit
against its TVL. The plan costs $1 to open the wallet, $2 to deposit, $1
to claim and $0.50 of gas a week for the qualifying actions. The forgone
yield is the T-bill rate, 4% a year, pro-rated to the hold. The hold is
45 days for a protocol a year or older, 60 days for six months to a year,
90 days for younger. Hands-on time is 5 minutes to open the wallet, 15
to deposit, 10 to check points, 10 to claim and 10 minutes a week for the
qualifying actions. The verdict is FARM at $5 or more net per hour, THIN
at $0 to $5, SKIP below $0.

**Eligibility.** A protocol makes the board when it is a pre-token
protocol in its own right: it records no token, it is not a bridge, a
liquid-staking or restaking product, a CEX or a wrapped/staked product,
its name carries no version marker and does not begin with an exchange's
name.

## Run it

```
# Reads MAKEFUN_INPUT_DIR (a file or a directory holding snapshot.json),
# writes to MAKEFUN_OUTPUT_DIR. No arguments needed.
MAKEFUN_INPUT_DIR=<snapshot dir> MAKEFUN_OUTPUT_DIR=out node main.ts

# The same, with flags:
node main.ts --input <snapshot.json>
```

What it writes, in order: the ranked board (`board.json`), the
dashboard's data (`data.js` beside the page), a copy of `dashboard/` and
`screenshots/`, and the dossier (`dossier.json`) last, built with
`buildDossier` from `vendor/makefun-board.ts`.

## Check it

```
# The seven gates the competition runs, re-run locally:
node local-gates.mjs --out out

# Re-take the three dashboard screenshots (needs headless Chrome):
node screenshots.mjs --out out
```

## Files

| File | What it is |
| --- | --- |
| `main.ts` | The program: snapshot in, board + dashboard + dossier out |
| `lib/model.ts` | The valuation, the farm plan and the board |
| `vendor/makefun-board.ts` | The dossier builder, byte-identical to the kit starter |
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
