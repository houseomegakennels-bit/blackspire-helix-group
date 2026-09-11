# AGENTS.md — Helix Trade Command

1. Execute stages in order.
2. Never fabricate observed results.
3. Never invent broker field names; verify against official documentation.
4. Never retrieve, log, commit, or expose secrets.
5. Never add a live broker URL to defaults.
6. Never advance through a failed gate.
7. Separate syntax fixes from logic changes.
8. Every change requires tests or a documented reason why no executable test applies.
9. Every stage requires evidence.
10. Production deployments and risk-setting changes require human review.
11. A successful API response is not proof broker state changed; re-read and reconcile broker state.
12. Unknown state means fail closed.
13. Codex/AI is never part of the production safety path.
14. Zola may orchestrate visibility, requests, approvals, and operator workflows, but may never bypass Helix risk controls, halt state, broker protections, environment locks, or readiness gates.
15. Live trading remains disabled until the final eligibility gates are explicitly passed.
