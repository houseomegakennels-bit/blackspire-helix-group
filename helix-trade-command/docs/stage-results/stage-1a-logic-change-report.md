# Stage 1A — Logic Change Report

## Baseline
Historical validator imported at commit `bf5029a`. It remains the immutable comparison point for Stage 1A.

## Approved research definitions
The operator explicitly approved the following deterministic research rules for the validator:
- **Opposing MSS:** after the NY liquidity sweep, price must close through the most recent confirmed 3-bar swing point in the reversal direction.
- **Displacement:** after MSS, a reversal-direction candle must have real body >= 1.5× the median real body of the prior 20 completed 5-minute bars.
- Required order: NY sweep bar < MSS bar <= displacement bar < final NY evaluation.
- These are research parameters to be sensitivity-tested later; they are not automatically promoted to live strategy rules.

## Behavior changes from baseline
1. **London classification:** baseline used one `lonSwept` boolean. Revised code separates high sweep, low sweep, high break, low break, double sweep, no-touch, and ambiguous states.
2. **Scenario A direction:** baseline used London session candle direction. Revised code uses sweep direction: high sweep implies bearish NY continuation; low sweep implies bullish NY continuation.
3. **Scenario B eligibility:** baseline treated every non-sweep London session as B. Revised code admits only exact `LONDON_NO_TOUCH` and excludes break/double/ambiguous states.
4. **NY reversal proof:** baseline credited sweep plus directional close. Revised code tracks `nySweepBar`, `nyMssBar`, and `nyDisplacementBar` and only credits the approved ordered sequence followed by an opposing final close.
5. **MSS:** newly operationalized with the approved most-recent confirmed 3-bar swing rule.
6. **Displacement:** newly operationalized with the approved 1.5× prior-20 median body rule.
7. **Data quality:** baseline had one sampled-day count. Revised code separates raw, valid, excluded, wrong-timeframe, missing-session, shortened-session, ambiguous-London, and ambiguous-NY conditions. Exchange-holiday knowledge is not claimed.
8. **Q4:** baseline reported average sweep only. Revised code reports mean, median, p25, p75, and p90.
9. **Q5:** baseline reported average Asia range only. Revised code reports mean, median, p75, p90 and scenario performance by Asia-range quartile where sample size permits.
10. **Statistical gate:** baseline displayed simple percentages. Revised code adds Wilson 95% confidence intervals and PASS only when n>=30, point estimate>=55%, and lower bound>50%; n<30 is PROVISIONAL, otherwise FAIL.
11. **Execution behavior:** unchanged in one crucial respect: this remains an indicator and places no orders.

## Interpretation cautions
- The approved MSS/displacement definitions are testable research definitions, not assertions about universal ICT terminology.
- A Scenario B candidate that fails the ordered NY sequence is a hypothesis failure, not a data-quality exclusion.
- Session completeness is inferred from observed 5-minute bars; the validator does not contain an exchange holiday calendar.
- Stage 1B must validate the script in TradingView before any resulting statistics are trusted.

## Runtime status
TradingView compilation and runtime are **UNVERIFIED**. No Stage 1B, Stage 1C, or Stage 1D result is claimed.
