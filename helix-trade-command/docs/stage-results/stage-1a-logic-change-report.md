# Stage 1A — Logic Change Report

## Baseline
Historical validator imported at commit `bf5029a`. It is preserved as the reference implementation for comparison.

## Confirmed changes required before Stage 1B
- Replace London candle-direction scoring with sweep-direction scoring for Scenario A.
- Split London outcomes into explicit high sweep, low sweep, high break, low break, double sweep, no-touch, and ambiguous states.
- Restrict Scenario B to the exact no-touch/non-break class.
- Require an ordered NY reversal sequence rather than merely sweep + directional close.
- Add raw/valid/excluded-day accounting and explicit exclusion reasons.
- Replace mean-only Q4/Q5 reporting with distribution statistics.
- Add per-scenario counts and Wilson 95% confidence intervals with objective pass/provisional/fail rules.

## Human-definition gate
Two concepts are named by the revised architecture but are not operationally defined in the baseline or current source-of-truth:

1. **Opposing market-structure shift (MSS)** — the exact swing/structure rule and lookback that qualifies.
2. **Displacement** — the exact candle/range/body/imbalance threshold that qualifies after MSS.

Implementing either without an agreed rule would manufacture a definition and could materially change Q3 results. Stage 1A therefore stops before encoding those two conditions.

## Recommended defaults for approval
If the operator wants a deterministic starting definition, use these as explicit research parameters rather than claims of ICT canon:
- MSS: close through the most recent confirmed 3-bar swing point in the reversal direction after the NY liquidity sweep.
- Displacement: next qualifying candle closes in the reversal direction with real body >= 1.5x the median real body of the prior 20 completed 5-minute bars.
- Sequence must be strict: sweep bar < MSS bar <= displacement bar < final NY evaluation.
- These parameters remain research inputs and must be sensitivity-tested; they are not silently promoted into live strategy rules.

## Runtime status
TradingView compilation and runtime are **UNVERIFIED**. No Stage 1B/1C evidence is claimed.
