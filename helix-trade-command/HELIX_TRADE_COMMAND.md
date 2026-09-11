# HELIX TRADE COMMAND — Source of Truth

**Division:** Blackspire Helix Group  
**Development controller:** ChatGPT/Codex through GitHub branches and pull requests  
**Operational control:** Telegram → n8n → Supabase / broker  
**Current stage:** Stage 1D propagation decision — current strategy premise stopped after Stage 1C evidence failure
**Live trading:** Disabled

## Core architectural rule
AI may build, test, review, and propose the trading system. AI is never the live brake, never holds live trading authority, and never substitutes for broker-side protection or deterministic runtime safety controls.

## Planned planes

### Development plane
ChatGPT/Codex → isolated branch → tests → diff → pull request → human review → merge.

No live broker credentials, production Supabase service-role key, production webhook secrets, prop-firm credentials, or direct production trading access are allowed here.

### Control plane
Telegram and later Zola → authenticated control API/workflow → authorization/policy checks → halt/status/positions/flat/resume → Supabase state → sanitized broker state.

### Execution plane
TradingView alert → authenticated n8n webhook → schema/freshness validation → halt-state check → idempotency reservation → contract validation → broker-state pre-check → position sizing → broker order request → broker-state reconciliation → immutable event log.

### Safety plane
Independent watchdog + external dead-man heartbeat + broker-side protective orders + Telegram alerts + SMS fallback.

## Environment isolation
Keep separate state and credentials for:
- local/test
- mock
- broker demo
- prop evaluation
- live

Live order submission must remain impossible unless all explicit live-environment gates are satisfied.

## Execution safety requirements
- Unknown state fails closed.
- Every order action must be reconciled against broker state.
- Protective quantity must cover absolute open position quantity.
- Partial fills and orphaned child orders must be handled explicitly.
- Prices must normalize to valid tick increments.
- Duplicate signals must be blocked with idempotency/concurrency controls.
- `/resume` must run readiness checks.
- `/flat` must halt first, cancel entries, flatten, reconcile to zero positions/orders, and remain halted.

## Stage 1 evidence gate
The premise must be validated before strategy automation proceeds. Scenario advancement requires at minimum 30 observations, point estimate at least 55%, and lower Wilson 95% confidence bound above 50%. Weak or ambiguous evidence stops the strategy track rather than being rationalized away.

## Build order
D0 → 1A → 1B → 1C → 1D → 2 → 3 → 4A → 4B → 4C → 4D → 4E → 4F → 5 → 6 → 7.

See `RUNBOOK.md` for stage names and `docs/architecture/ZOLA_INTEGRATION_PLAN.md` for the Zola integration contract.
