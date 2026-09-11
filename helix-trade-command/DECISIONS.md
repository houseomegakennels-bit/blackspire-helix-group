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

## 2026-09-11 — Stage 1C/1D evidence stop
- Added an offline validator and reproducibility record to expand evidence beyond TradingView Basic history.
- Combined non-overlapping direct M6E evidence is Scenario A = 17/31 (54.84%), Wilson 95% approximately [37.77%, 70.84%], which FAILS the preregistered Stage 1 gate.
- Scenario B remains provisional at 3/16 (18.75%) and is independently weak.
- Full-size 6E is retained only as a same-underlying robustness proxy; it does not substitute for direct M6E evidence.
- Stop the current strategy track. Preserve the Helix platform and safety architecture, but require a new preregistered research premise before Stage 2 can restart.

## 2026-09-11 — R1 replacement-premise preregistration
- R1-H1 replaces direct London-to-NY prediction with a confirmation-based event: one London Asia-range sweep, then a same-side NY sweep back into range, 3-bar MSS, and 1.5× displacement in reversal direction.
- Days without the full NY sequence are no-events rather than forced directional losses.
- Keep the original Stage 1 statistical gate: n>=30, point estimate>=55%, lower Wilson 95% bound>50%.
- Data examined through 2026-09-11 is discovery/debug only for R1; preferred primary validation begins 2026-09-12.
- R1 remains research-only until an independent validation sample passes and the operator explicitly approves Stage 2.

## 2026-09-11 — R1 prospective automation
- Use TradingView Data Window telemetry instead of CSV export so the evidence collector works on the Basic plan without subscription changes.
- Reserve the single Basic-plan saved chart layout for the R1 prospective collector while evidence is accumulating; restoring two legacy indicators simultaneously would exceed the two-indicator limit.
- Store runtime observations locally in a SHA-256 chained ledger and expose only read-only status to Zola.
- Schedule capture after the 10:00 ET research window with a 10:15 primary attempt and a 10:45 retry.
- Keep 6E robustness strictly separate from the primary M6E gate.

## 2026-09-11 — London execution backtest V1
- Freeze execution assumptions before running historical results; do not tune V1 after seeing outcomes.
- Keep directional-premise validation separate from executable trade profitability.
- Do not promote either V1 execution variant: original London sweep has too few executable trades and negative normalized R expectancy; R1-H1 has four losing executable trades in the historical debug sample.
- Prospective R1 evidence beginning 2026-09-12 remains the authoritative validation track.

## 2026-09-11 — London V2 execution research
- Treat an Asia-range sweep as context, not an entry trigger.
- Test London-session reclaim + 3-bar MSS + 1.5x displacement + first FVG retrace before 05:00 ET.
- Stop one tick beyond the sweep extreme; target the opposite Asia extreme, requiring >=1.5R and capping credit at 3R.
- Do not optimize V2 after viewing its historical results. Any parameter change requires a separately preregistered V3.
- Historical V2 results are too small for execution authorization; continue research only.
