# Changelog

## Unreleased — Stage 1A
- Imported the historical ICT Premise Validator baseline.
- Reworked Scenario A to use sweep direction rather than London candle direction.
- Restricted Scenario B to exact London no-touch/non-break days.
- Added explicit London outcome classifications and conservative ambiguity handling.
- Added operator-approved NY sweep → 3-bar-swing MSS → 1.5× median-body displacement sequence tracking.
- Added raw/valid/excluded-day accounting and session completeness checks.
- Added Q4/Q5 distribution statistics, Asia-range quartile performance, Wilson 95% intervals, and objective pass/provisional/fail rules.
- Corrected Scenario A final direction to reference the NY session open.
- Independent static review completed; remaining validation is TradingView compile/runtime behavior.
- TradingView compilation/runtime remains unverified pending Stage 1B.

## Stage D0
- Bootstrapped Helix Trade Command as an isolated Blackspire subproject branch.
- Added source-of-truth architecture, agent safety rules, security policy, runbook, and decisions log.
- Added Zola integration plan and hard boundary: Zola is an orchestration/visibility layer, not direct broker execution authority.
- Live trading remains disabled.
- No broker integrations, production n8n workflows, Supabase migrations, Pine strategy implementation, live endpoints, or secrets added.

## Stage 1B — TradingView runtime verification
- Verified Pine execution on authenticated M6E1! 5-minute TradingView data.
- Replaced exact session-bar equality with 85% coverage to tolerate zero-volume gaps.
- Restored Scenario B to the original no-London-sweep premise and kept double sweeps excluded.
- Recorded provisional A=10/8 (80%) and B=8/1 (12.5%) results; sample remains below the minimum evidence gate.

## Stage 1C/1D — expanded evidence and stop decision
- Added a dependency-free offline premise validator mirroring the current Pine research rules.
- Recorded public M6E/6E dataset provenance and SHA-256 hashes without committing raw market data.
- Expanded direct M6E evidence across non-overlapping samples to Scenario A = 17/31 (54.84%), Wilson 95% [37.77%, 70.84%].
- Marked Scenario A FAIL under the fixed n>=30 / point>=55% / Wilson-low>50% gate.
- Recorded Scenario B = 3/16 (18.75%) as provisional but weak.
- Completed Stage 1D propagation decision: stop the rejected strategy premise and return to preregistered research/redesign; no broker or execution work authorized.

## Research redesign R1
- Preregistered R1-H1 as a confirmation-based replacement premise after the Stage 1C failure.
- Fixed the event sequence, exclusions, directional outcome, statistical gate, and prospective validation boundary before testing.
- Kept M6E as the primary instrument and 6E as robustness-only.
