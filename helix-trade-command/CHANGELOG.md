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
