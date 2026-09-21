# Blackspire London Dual-State V4 — preregistered specification

Status: frozen before outcome evaluation.
Instrument for long-history robustness: EUR/USD spot proxy, 5-minute bars derived from HistData M1, 2009-2024. Direct M6E remains the target instrument for prospective validation.
Timezone: America/New_York. Asia range: 20:00-00:00 ET. London decision/entry window: 02:00-05:00 ET. Maximum one trade per research day.

## Common setup
- Require complete Asia/London coverage using the existing >=85% session-coverage rule.
- Define Asia high/low from 20:00-00:00 ET.
- A valid London break trades >=1 tick beyond exactly one Asia extreme; days that break both sides before entry are excluded.
- Rolling displacement benchmark is the median real body of the previous 20 five-minute candles.
- Risk model: $50,000 start, 0.5% current-equity risk, max 6 M6E-equivalent contracts, 1 adverse tick each side, $1.50 round-turn commission/contract.
- Any same-bar stop/target ambiguity is resolved stop-first.
- Time exit: final close before 10:00 ET.

## State A — REJECTION
- A London bar breaks one Asia extreme and closes back inside the Asia range.
- Require reversal-direction 3-bar MSS using the most recent confirmed swing.
- Require reversal displacement body >=1.5x prior-20 median body and a same-direction 3-candle FVG.
- Enter first later retrace to 50% of that FVG before 05:00 ET.
- Stop: 1 tick beyond the London sweep extreme.
- Friction guard: skip if initial stop distance <15 ticks.
- Target: 2.0R fixed.

## State B — ACCEPTANCE
- A London bar breaks one Asia extreme and closes outside it by at least 1 tick.
- Acceptance requires either (a) two consecutive closes outside the broken Asia extreme, or (b) one outside close whose body >=1.5x the prior-20 median body.
- After acceptance, require a continuation-direction displacement body >=1.5x prior-20 median body that creates a continuation FVG.
- Enter the first later retrace to the FVG midpoint before 05:00 ET, but only while the retrace bar still closes on the breakout side of the Asia boundary.
- Stop: 1 tick back inside the Asia range beyond the broken boundary (high-break long: Asia high - 1 tick; low-break short: Asia low + 1 tick).
- Skip if stop is on the wrong side of entry or stop distance <10 ticks.
- Target: 2.0R fixed.

## Evaluation
Report branches separately and combined: trades, wins, win rate, net modeled P&L, expectancy in R, profit factor, max drawdown, losing streak, and yearly stability.
Advancement research gate (not trading authorization): >=100 total long-history trades, combined expectancy >0.10R, PF >=1.25, positive net P&L in >=60% of active years, and no branch with expectancy below -0.25R when n>=30.
No rule changes after this document is committed; any change becomes V5.
