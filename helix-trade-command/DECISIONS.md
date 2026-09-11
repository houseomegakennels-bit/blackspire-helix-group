# Decisions

## ADR-lite D0-001 — Development controller
Use ChatGPT/Codex for development work through branches and pull requests. AI is not part of the live trading runtime.

## ADR-lite D0-002 — Runtime separation
Planned live runtime: n8n + Supabase + selected broker + independent watchdog + Telegram controls + SMS fallback. Development credentials and production credentials remain separate.

## ADR-lite D0-003 — Fail closed
Unknown broker/order/risk state halts execution until reconciled.

## ADR-lite D0-004 — Zola integration
Zola will be the higher-level human interface and orchestration layer, not the execution authority. It may display state, request actions, collect approvals, and route operator commands through authenticated Helix interfaces. It may not write directly to broker execution endpoints or clear risk halts.

## ADR-lite D0-005 — Repository location
The master architecture calls for a dedicated private `helix-trade-command` repository. The currently connected GitHub tooling exposes the Blackspire umbrella repository but no separate Helix repo and no repository-creation action. Stage D0 is therefore bootstrapped in `blackspire-helix-group/helix-trade-command/` on an isolated branch. Migrate this subtree to a dedicated private repo before production credentials or broker integration are introduced.

## 2026-09-11 — Stage 1B TradingView runtime semantics
- Treat sparse zero-volume 5-minute omissions as normal feed behavior; require at least 85% session-bar coverage instead of exact bar-count equality.
- Preserve the original premise buckets: Scenario A = exactly one London sweep; Scenario B = no qualifying London sweep; double London sweeps are excluded.
- Do not advance the strategy evidence gate from the TradingView Basic sample: A=10 and B=8 are below the 30-observation minimum.
