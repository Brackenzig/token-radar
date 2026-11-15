# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Brackenzig/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar: comps-calibrated value, blind-tested curve, netted farm plans.

A token-launch radar: it reads a sealed DefiLlama snapshot of every protocol, fits a comparables curve to the tokens that already trade (log10 market cap on log10 TVL, tested leave-one-out and on a time split), prices every pre-token protocol off that curve, and shows a dashboard with the board, a detail view and farm plan for each protocol, and filters. Every farm plan is netted: the $1,000 slice minus fees, gas and the forgone T-bill yield, per plan and per hands-on hour, with a FARM / THIN / SKIP verdict.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=atc4awx9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
