# Stage 1B — TradingView Compile / Runtime Gate

## Purpose
Verify the revised Stage 1A Pine v6 indicator in TradingView before trusting any statistics or advancing to Stage 1C.

## Required chart
- Symbol: `M6E1!` continuous Micro Euro FX futures
- Timeframe: 5 minutes
- Timezone used by script: `America/New_York`
- Script: `helix-trade-command/pine/ict_premise_validator.pine` from merged Stage 1A

## Compile gate
Record the exact TradingView compiler result. If any compiler error or warning affects correctness, Stage 1B fails until repaired and re-run. Do not infer success from static review.

## Runtime observations
Capture:
- indicator loads without runtime error;
- table renders and remains responsive while historical bars load;
- Raw days, Valid days, Excluded days, Ambiguous count;
- Scenario A observations, successes, percentage, Wilson 95% CI, state;
- Scenario B observations, successes, percentage, Wilson 95% CI, state;
- Q4 mean/median/p25/p75/p90;
- Q5 mean/median/p75/p90;
- Asia-range quartile scenario outputs where sample permits;
- current London classification and NY sequence-bar diagnostics.

## Data-quality checks
- Scroll/load enough history to target at least 120 raw days where the TradingView plan permits.
- Confirm missing/shortened session days are excluded rather than silently scored.
- Note that the indicator has no exchange-holiday calendar; holidays are only indirectly excluded when session completeness fails.
- Check that Scenario B matches the original premise: no qualifying London sweep. Break days may enter B; double-sweep days remain excluded as ambiguous.
- Check that Scenario B success requires ordered sweep → MSS → displacement → opposing final close.

## Evidence to capture
Save at minimum:
1. screenshot of successful compile / no-error state;
2. screenshot of the indicator table with the loaded sample;
3. exact chart symbol/timeframe and date range visible;
4. any compiler/runtime message verbatim;
5. numeric table values transcribed into `stage-1b-results.md`.

## Pass condition
Stage 1B passes only when TradingView compiles the exact merged script and the indicator runs on M6E1! 5-minute data without correctness-affecting runtime errors. Statistical strength is evaluated in Stage 1C, not here.

## Current status
**RUNTIME VERIFIED — statistical sample remains below the Stage 1C minimum.**
