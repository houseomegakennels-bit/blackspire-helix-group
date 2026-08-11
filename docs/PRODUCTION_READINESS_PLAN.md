# Production readiness plan
## Current boundary

Blackspire is ready for controlled, isolated staging exercises with mock providers and disposable state. Production activation, live providers, real Telegram delivery, Gate 4, memory promotion, and workspace review-queue work remain outside this plan.

Status labels used here: **VERIFIED**, **PARTIALLY VERIFIED**, **REQUIRES CREDENTIALS**, **REQUIRES PAID SERVICE**, **REQUIRES OPERATOR AUTHORIZATION**, **INTENTIONALLY DISABLED**, and **NOT YET IMPLEMENTED**.

## Inventory

| Surface | Repository evidence | State |
|---|---|---|
| Command API | `apps/api/server.js` | VERIFIED locally; production activation unauthorized |
| Worker and durable queue | `apps/worker/worker.js`, `packages/task-engine/` | VERIFIED with SQLite fixtures |
| Hermes orchestration | `packages/hermes/`, `packages/hermes-orchestrator/` | VERIFIED in mock/bounded modes; real providers INTENTIONALLY DISABLED |
| Telegram bridge | `apps/telegram/bot.js` | VERIFIED with mocks; real bot REQUIRES CREDENTIALS and OPERATOR AUTHORIZATION |
| Jarvis PWA | `apps/jarvis-pwa/public/` | VERIFIED in credential-free loopback tests; production service-worker lifecycle PARTIALLY VERIFIED |
| Command data | SQLite through `packages/task-engine/db.js` | VERIFIED with backup/restore fixtures |
| Public frontend | `frontend/` on Vercel | Separate deployment target; REQUIRES CREDENTIALS/OPERATOR AUTHORIZATION |
| Production release | `scripts/release-*.sh` | VERIFIED with disposable fixtures; activation REQUIRES OPERATOR AUTHORIZATION |
| Monitoring | `ops/blackspire-command-monitoring.md` | PARTIALLY VERIFIED; alert routing NOT YET IMPLEMENTED |

## Required gates

Run with Node.js 22.23.1:

```bash
npm ci
npm test
npm run lint
npm run typecheck
npm run build
npm run security:scan
npm audit --audit-level=high
npm run production:preflight
npm run production:preflight:host
bash scripts/check-living-memory.sh
git diff --check
find . -path './node_modules' -prune -o -path './.git' -prune -o -type f -name '*.sh' -print0 | xargs -0 -r -n1 bash -n
```

Before requesting activation, resolve deployment locking, post-switch health automation, production restore design, alert routing, and real credential ownership. Gate 4 and memory promotion remain INTENTIONALLY DISABLED.
