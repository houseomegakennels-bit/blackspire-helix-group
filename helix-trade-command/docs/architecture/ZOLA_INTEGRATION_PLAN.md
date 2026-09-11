# Zola Integration Plan — Helix Trade Command

## Goal
Integrate Helix Trade Command into Zola without making Zola a direct broker-execution dependency or a single point of failure.

## Position in the architecture
Zola is the operator-facing orchestration, monitoring, and approval layer.

```text
Zola UI / assistant
  → authenticated Helix control API
    → policy + authorization layer
      → Supabase trading state
      → n8n control workflows
      → sanitized broker state

Trading execution remains independent:
TradingView → n8n execution workflow → risk gates → broker → reconciliation
```

Zola must never bypass the Helix control plane.

## Phase Z0 — contract definition
Create typed, versioned interfaces for:
- system status
- halt state
- positions
- working orders
- watchdog health
- strategy state
- daily P/L and risk-budget status
- execution/rejection events
- environment identity

Control requests:
- request halt
- request resume
- request flatten
- acknowledge safety event
- approve/reject configuration change
- request shadow/demo activation

No direct `place_order` endpoint is exposed to Zola in the initial design.

## Phase Z1 — read-only Zola dashboard
Zola may show:
- environment banner: MOCK / DEMO / PROP / LIVE
- system health
- active halt reasons
- open positions and protected quantity
- working orders
- watchdog heartbeat
- recent signals and disposition
- strategy/backtest version
- risk budget and daily loss state
- recent rejections/fail-safe events

This phase ships before any Zola control actions.

## Phase Z2 — guarded operator controls
Add authenticated Zola actions for:
- HALT
- FLAT
- STATUS refresh
- position/order inspection

HALT should be one-step and fail-safe. FLAT must execute Helix's flatten state machine and remain halted afterward.

## Phase Z3 — guarded resume and approvals
`RESUME` requires server-side Helix readiness checks. Zola can request resume but cannot override failures.

Configuration/deployment/risk changes require structured approval records with:
- operator identity
- request timestamp
- requested diff
- risk class
- approval timestamp
- resulting version/build identifier

## Phase Z4 — strategy operations
Zola can initiate safe development/analysis workflows such as:
- request validator run
- view Stage 1 evidence
- compare backtests
- inspect strategy version
- request shadow-mode session
- review demo results

These actions do not grant live trading authority.

## Phase Z5 — production visibility
Only after Helix reaches production eligibility, Zola may expose LIVE monitoring and approved operator controls. The live runtime must continue functioning safely if Zola is unavailable.

## Security boundaries
Zola must not store or receive:
- broker password
- broker API secret/token where avoidable
- Supabase service-role key
- n8n production API key
- webhook signing secret
- Telegram bot token

Use short-lived service identity/session credentials, least privilege, scoped endpoints, audit logs, replay protection, and rate limits.

## Failure behavior
- Zola unavailable → trading safety/runtime continues independently.
- Helix API unavailable → Zola shows UNKNOWN and blocks consequential controls.
- Broker state unknown → Helix fails closed; Zola may not override.
- stale state → clearly marked stale and consequential actions blocked until refreshed.
- authentication uncertainty → deny action.

## UX requirements
Every Zola trading screen must prominently show:
1. environment
2. HALTED/RUNNING state
3. active halt reason(s)
4. watchdog health
5. data freshness timestamp
6. Emergency Halt

Any LIVE surface must be visually unmistakable from MOCK/DEMO.

## Implementation order
1. Freeze API/event contracts during Helix Stage 4A design.
2. Build read-only adapter against mock Supabase data.
3. Build Zola read-only dashboard.
4. Add authenticated HALT and STATUS.
5. Add FLAT against mock broker only.
6. Pass failure-injection tests.
7. Add guarded RESUME.
8. Connect broker demo state.
9. Run shadow/demo soak period.
10. Consider LIVE visibility/control only after Stage 7 gates pass.

## Acceptance criteria
Zola integration is acceptable only when:
- Zola cannot directly place a broker order.
- Zola cannot clear an unsafe halt.
- Helix continues safe operation if Zola disappears.
- every consequential Zola request is authenticated and audited.
- stale/unknown data is distinguishable from healthy data.
- emergency halt works through the Helix control plane.
