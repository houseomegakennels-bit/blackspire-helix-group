# Helix Trade Command

Autonomous futures-trading control system under Blackspire Helix Group.

## Status
Stage D0 bootstrap. No live broker integration, no live credentials, no production trading.

## Source of truth
`HELIX_TRADE_COMMAND.md`

## Development rule
Codex/AI may build, test, and propose changes. It is never part of the live safety path. Production-risk changes require human review.

## Planned runtime
TradingView alerts → authenticated n8n workflow → Supabase state/risk checks → broker execution → state reconciliation, with independent watchdog, Telegram operational controls, SMS fallback, and broker-side protection.

## Zola
Zola is planned as the human-facing orchestration and visibility layer. It must not bypass Helix risk controls, broker protections, halt state, or readiness gates. See `docs/architecture/ZOLA_INTEGRATION_PLAN.md`.
