# Changelog

## Unreleased — Stage 1A
- Imported the historical ICT Premise Validator baseline.
- Reworked Scenario A to use sweep direction rather than London candle direction.
- Restricted Scenario B to exact London no-touch/non-break days.
- Added explicit London outcome classifications and conservative ambiguity handling.
- Added approved NY sweep → 3-bar-swing MSS → 1.5× median-body displacement sequence tracking.
- Added raw/valid/excluded-day accounting and session completeness checks.
- Added Q4/Q5 distribution statistics, Asia-range quartile performance, Wilson 95% intervals, and objective pass/provisional/fail rules.
- TradingView compilation/runtime remains unverified pending Stage 1B.

## Stage D0
- Bootstrapped Helix Trade Command as an isolated Blackspire subproject branch.
- Added source-of-truth architecture, agent safety rules, security policy, runbook, and decisions log.
- Added Zola integration plan and hard boundary: Zola is an orchestration/visibility layer, not direct broker execution authority.
- Live trading remains disabled.
- No broker integrations, production n8n workflows, Supabase migrations, Pine strategy implementation, live endpoints, or secrets added.
