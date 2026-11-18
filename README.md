# Token Radar — radar-3

[![Token Radar 01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/c/token-radar-01)
[![Rank](https://make.fun/badge/token-radar-01/zaldie/token-radar-01-v3/rank.svg)](https://make.fun/c/token-radar-01)
[![Reward](https://make.fun/badge/token-radar-01/zaldie/token-radar-01-v3/reward.svg)](https://make.fun/c/token-radar-01)

The best token launch radar: a program that reads a sealed DefiLlama snapshot
and writes a web dashboard ranking the pre-token protocols by what their launch
would be worth, each with the steps to farm it.

## The model (radar-3)

The implied value is **fitted from the snapshot's own live tokens**, not from a
hand-picked constant:

- **Size curve** — `log(mcap) = a + b x log(TVL)`, OLS on the 128 live-token
  protocols in the snapshot (a = 6.965, b = 0.522). The market's own scaling
  law: a token is worth proportionally less per TVL dollar as the protocol
  grows.
- **Category tilt** — each category's median market-cap-to-TVL ratio
  (winsorized to 0.01–3.00, shrunk toward the global median when the category
  has fewer than 4 live tokens). Dexs price 1.60x the market, liquid staking
  0.19x.
- **Growth** — 7-day change clamped to -60%…+60%; down weeks weigh 0.50, up
  weeks 0.40.
- **Maturity** — `0.6 + 0.4 x (1 - e^(-age/365))`; unknown age counts as 180 days.
- **Reach** — `1 + 0.02` per extra chain, up to 5 extra chains (max 1.10).

`implied = round(size(TVL) x tilt x growth x maturity x reach)`

## Validation (computed, shown on the dashboard)

- **Leave-one-out** over the 128 live-token comparables: median error 90.9%,
  24.2% predicted within 2x (the flat 0.25x rule: 88.7% / 30.5% — the fit
  does not win this check, and the dashboard says so).
- **Walk-forward**: fit on tokens listed before 2025-01-01, tested on those
  listed after (n = 31): median error 79.0%, 32.3% within 2x — the flat rule
  scores 84.7% / 25.8% on the same split. This is the closest analogue to
  pricing a future launch, and the check the fit is kept for.
- **Rank ranges**: every row carries the rank range it takes across 200
  bootstrap refits of the comparables (seeded, deterministic; top-10 rows move
  a median of 15.5 ranks). No point predictor is precise — one token's market
  cap varies roughly 200x around its category's median — so the dashboard
  shows the uncertainty instead of hiding it.

## The board

226 rows: all 40 watchlist protocols plus every rankable pre-token protocol
below the $50M floor. Live-token protocols are kept apart (top 24 by market
cap) and are the comparables the curve and tilts are fitted from. Each row
carries a 9-step farm plan with a cost and a time per step, and the whole
plan's total cost.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only. Two runs write the same bytes. The dashboard
renders with no network (`out/dashboard/index.html`).

## Layout

- `main.ts` — reads the snapshot, writes `board.json`, `data.js`, copies
  `dashboard/` and `screenshots/`, writes `dossier.json`
- `lib/model.ts` — the radar-3 fit, validation, bootstrap and farm plans
- `vendor/makefun-board.ts` — the kit's dossier library, byte for byte
- `dashboard/` — `index.html`, `app.css`, `app.js` (40,372 bytes total)
- `screenshots/` — the board, a protocol's detail view, a filtered view
- `check-gate.mjs` — the gate self-check (226 rows, 40/40 watchlist, ranks,
  implied order, farm steps 3–12 x 20–600 chars)

## License

MIT. See `LICENSE`.
