# Stage 1A — Static Review of ICT Premise Validator

## Status
Revised validator implemented from the historical baseline. This stage is static-review only; TradingView compilation and runtime remain **UNVERIFIED** until Stage 1B.

## Implemented corrections
- Scenario A now derives expected NY direction from London sweep direction: high sweep → bearish, low sweep → bullish.
- London outcomes are explicitly classified as `A_HIGH_SWEEP`, `A_LOW_SWEEP`, `LONDON_BREAK_HIGH`, `LONDON_BREAK_LOW`, `LONDON_DOUBLE_SWEEP`, `LONDON_NO_TOUCH`, or `AMBIGUOUS`.
- Scenario B only admits `LONDON_NO_TOUCH`; break, double-sweep, and ambiguous London states are excluded.
- NY reversal evidence is sequential: liquidity sweep → approved opposing MSS → approved displacement → final opposing close.
- Approved MSS definition: close through the most recent confirmed 3-bar swing in the reversal direction after the NY sweep.
- Approved displacement definition: reversal-direction real body >= 1.5× the median real body of the prior 20 completed 5-minute bars.
- Session-bar completeness checks, raw/valid/excluded-day counts, and explicit exclusion categories were added.
- Q4 now reports mean, median, p25, p75, and p90 sweep penetration.
- Q5 now reports mean, median, p75, and p90 Asia-range width plus scenario performance by Asia-range quartile when enough observations exist.
- Scenario A/B report count, wins, percentage, Wilson 95% interval, and PASS/PROVISIONAL/FAIL state.

## Conservative treatment
The validator does not claim an exchange-holiday calendar. Holidays/closures are only indirectly reflected when expected session bars are missing or shortened. Ambiguous market behavior is excluded rather than forced into a hypothesis bucket.

## Static observations
- Pine declaration is v6.
- Script remains an `indicator`, not a `strategy`.
- No order-placement functions, broker calls, n8n flows, Supabase mutations, live URLs, credentials, or production secrets were introduced.
- Required London classifications, Wilson calculation, percentile calculation, and NY sequence state are present in source.
- No Stage 1 statistical result is claimed because the script has not yet been compiled/run in TradingView.

## Known Stage 1B verification items
TradingView must confirm Pine syntax/runtime behavior, especially array typing/copy/sort behavior, `ta.median` usage, table rendering, session counting on M6E1! 5-minute data, and historical sample depth.

## Gate decision
**READY FOR STAGE 1B COMPILE/RUNTIME VERIFICATION, subject to code review of this PR.** Stage 1C/1D remain blocked until actual TradingView output is captured and evaluated against the sample-quality gates.
