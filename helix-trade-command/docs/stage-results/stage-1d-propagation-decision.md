# Stage 1D — Propagation Decision

## Decision
**STOP CURRENT STRATEGY TRACK; PRESERVE PLATFORM; OPEN A NEW RESEARCH TRACK.**

Stage 1C produced a formal failure for Scenario A after 31 non-overlapping direct-M6E observations. Therefore the existing premise is not authorized to propagate into a human-correct strategy specification, Pine strategy backtest, mock execution, demo broker work, or any live path.

## What remains valid
- Helix repository and safety architecture.
- Deterministic evidence gates and fail-closed rules.
- TradingView/offline research tooling.
- Zola/Telegram control-plane boundaries.
- Future mock/demo/live architecture only after a replacement premise passes research gates.

## What is frozen
- The current Scenario A/B premise as a strategy candidate.
- Any attempt to tune the pass threshold after seeing these results.
- Broker or execution implementation justified by this premise.

## Authorized next work
Research may continue in a separate, explicitly experimental track. The first task is to generate replacement hypotheses from market structure and session behavior, then preregister each hypothesis, outcome definition, sample requirements, and rejection rule before testing it. No candidate may inherit a pass from the rejected premise.

## Research-redesign requirements
1. Keep M6E as the target instrument; use 6E only for robustness unless separately approved.
2. Prefer hypotheses with unambiguous event definitions that can be computed identically in Pine and offline code.
3. Preregister success criteria before evaluating outcomes.
4. Use disjoint development and validation samples where enough history exists.
5. Report all exclusions and sensitivity checks; do not weaken data-quality gates to increase `n`.
6. Require a fresh operator approval before any replacement premise advances into Stage 2.
