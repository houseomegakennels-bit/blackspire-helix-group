# Runbook

## Current state
Stage 1D propagation decision recorded. The current Scenario A/B premise failed the Stage 1C evidence gate and is frozen. Trading is disabled. No broker integration is authorized. Strategy work has returned to a preregistered research/redesign track.

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

## Current research gate
- Stage 1B TradingView runtime: verified.
- Stage 1C expanded evidence: Scenario A FAIL at 17/31 = 54.84%, Wilson lower bound 37.77%.
- Stage 1D propagation: STOP current strategy track.
- Stage 2 is blocked for the rejected premise.
- Replacement hypotheses must be preregistered and independently gated before any Stage 2 restart.
