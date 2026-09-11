# Runbook

## Current state
Stage D0 bootstrap only. Trading is disabled. No broker integration is authorized.

## Build order
1. D0 — development controller/repository setup.
2. 1A — extract and statically review premise validator.
3. 1B — compile/run validator in TradingView.
4. 1C — validate sample quality and scenario counts.
5. 1D — record results and propagation decision.
6. 2 — human-correct strategy specification.
7. 3 — build and honestly backtest Pine strategy.
8. 4A — Supabase trading-state schemas and halt model.
9. 4B — Telegram operational controller.
10. 4C — pass control-plane gate.
11. 4D — mock execution pipeline.
12. 4E — watchdog and external dead-man monitor.
13. 4F — failure-injection matrix.
14. 5 — broker demo token manager and bracket verification.
15. 6 — shadow mode, demo automation, long simulation.
16. 7 — legal, capital, prop-policy, and live eligibility gates.

## Immediate exit criteria for D0
- Project structure exists.
- Source-of-truth architecture is recorded.
- Safety rules are recorded.
- Zola integration boundary is documented.
- No secrets or live endpoints have been added.
- Changes are presented through a pull request for operator review.
