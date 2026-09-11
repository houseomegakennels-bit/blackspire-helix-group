# Stage 1A — Static Review of ICT Premise Validator

## Status
Baseline imported from the original saved validator source. No TradingView runtime result is claimed in this stage.

## Static review result
The baseline is suitable as a historical reference, but it does **not** satisfy the revised Stage 1 measurement contract without logic changes.

## Findings
1. **Scenario A direction is underspecified in code.** The baseline defines London direction from `lonClose > lonOpen`; the revised plan requires sweep-direction classification (high sweep → bearish expectation, low sweep → bullish expectation) and separate handling for double sweeps/breaks.
2. **Scenario B is contaminated.** The baseline treats every non-sweep London session as Scenario B, which can include London breaks and other non-matching states. Revised logic must isolate only the intended no-touch/non-break class.
3. **NY reversal sequence is not proven.** The baseline checks whether NY swept and closed in the expected direction, but does not prove the required temporal sequence: sweep → opposing MSS → displacement → distribution/close.
4. **Q4 is mean-only.** Revised measurement requires mean, median, 25th, 75th, and 90th percentile sweep penetration.
5. **Q5 is mean-only.** Revised measurement requires mean, median, 75th, 90th percentile and scenario performance by Asia-range quartile.
6. **No confidence intervals.** Revised Stage 1 requires scenario counts, success counts, point estimate, and Wilson 95% confidence interval.
7. **No data-quality exclusion ledger.** The baseline does not separately exclude/report weekends, holidays, missing/shortened sessions, invalid bars, incomplete history, or session gaps.
8. **No explicit ambiguous-day classification.** Double sweeps, breaks, incomplete sessions, and ambiguous cases are not isolated as required.

## Syntax/static observations
- Pine version is explicitly declared as v6.
- The file is an indicator, not a strategy, and does not place orders.
- No broker credentials, live endpoints, or production secrets are present.
- This review does not claim that TradingView accepts/compiles the script; that belongs to Stage 1B.

## Logic-change policy
No logic corrections were silently applied to the imported baseline. The baseline is preserved so the revised validator can be compared against it. All behavioral corrections should be made in a separately reviewed Stage 1A revision before Stage 1B execution.

## Required next implementation
Create a revised validator that:
- classifies London states explicitly;
- scores Scenario A from sweep direction;
- restricts Scenario B to the intended no-break class;
- tracks NY sweep/MSS/displacement order;
- records exclusions and ambiguous days;
- calculates percentile distributions and Wilson confidence intervals;
- outputs raw days, valid days, exclusions, per-scenario counts and pass/provisional/fail state.

## Gate decision
**BLOCK Stage 1B on this baseline.** The imported script is valuable reference material, but the revised measurement logic must be implemented and reviewed before TradingView runtime validation.
