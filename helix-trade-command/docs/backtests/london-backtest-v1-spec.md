# London Pattern Backtest V1 — Frozen Research Specification

Date frozen: 2026-09-11. Research only; no live-trading authorization.

## Market and data
- Primary instrument: M6E, 5-minute bars.
- Time zone: America/New_York.
- Asia: 20:00–00:00 ET; London: 03:00–05:00 ET; NY research window: 07:00–10:00 ET.
- Session-quality threshold: at least 85% of theoretical bars in each session.
- Tick size: 0.0001; tick value: $1.25 per M6E contract.

## Portfolio assumptions
- Starting equity: $50,000.
- Risk budget: 0.50% of current equity per trade.
- Maximum position: 6 M6E contracts.
- Commission/fees assumption: $1.50 round turn per contract.
- Slippage: 1 tick adverse on entry and 1 tick adverse on exit.
- Maximum one trade per research day per variant.

## Variant A — original London single-sweep strategy
1. London must sweep exactly one Asia extreme; double sweeps are excluded.
2. Direction is reversal: high sweep => short; low sweep => long.
3. Entry reference: 07:00 ET NY-session open.
4. Stop: 1 tick beyond the most extreme London sweep price on the swept side.
5. Target: 2.0R from the reference entry.
6. Exit any remaining position at the final bar before 10:00 ET.

## Variant R1-H1 — confirmation strategy
1. London must sweep exactly one Asia extreme.
2. NY must sweep that same Asia extreme and close back inside the Asia range.
3. Price must then close through the latest confirmed 3-bar swing in the reversal direction (MSS).
4. A reversal candle body must be at least 1.5x the median real body of the prior 20 five-minute bars.
5. Entry reference: next bar open after the displacement candle. If no next bar exists before 10:00 ET, no trade.
6. Stop: 1 tick beyond the NY same-side sweep extreme.
7. Target: 2.0R from the reference entry.
8. Exit any remaining position at the final bar before 10:00 ET.

## Fill and ambiguity policy
- Entry fill is one tick worse than reference price.
- Stop, target, and time-exit fills are one tick worse than the observed trigger/reference for the position.
- If stop and target are both touched in the same 5-minute bar and ordering is unknowable, count the stop first (conservative).
- Position size is floor(risk budget / reference stop risk per contract), capped at 6; zero-size trades are skipped.
- Commission is charged on every completed contract round trip.

## Required outputs
Trades, win/loss rate, net P&L, return on starting equity, average trade, average R, expectancy R, gross profit/loss, profit factor, max drawdown dollars/percent, longest losing streak, average contracts, stop/target/time-exit counts, and full trade ledger.

Historical results from this V1 run are descriptive research only and cannot authorize live or broker execution.
