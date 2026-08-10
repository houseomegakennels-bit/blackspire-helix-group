# Production deployment runbook

## Authorization boundary

Everything through planning and preflight is read-only. Creating/switching releases, migrating data, restarting services, changing nginx/TLS/DNS, or enabling credentials REQUIRES OPERATOR AUTHORIZATION. Do not infer approval from this document.

## Read-only preflight

```bash
npm run production:preflight
npm run production:preflight:host
BLACKSPIRE_GATE4_APPROVED_SHA=<40-character-sha> bash scripts/gate4-prepare.sh --validate-only
BLACKSPIRE_GATE4_APPROVED_SHA=<40-character-sha> bash scripts/gate4-prepare.sh --plan
```

## Authorized release sequence

The following commands are VERIFIED interfaces but must not be run without explicit authorization:

```bash
npm run release:create -- <40-character-sha>
bash scripts/release-preflight.sh <40-character-sha>
BLACKSPIRE_RUN_MIGRATIONS=true npm run db:migrate
npm run release:switch -- <40-character-sha>
BLACKSPIRE_HEALTH_URL=http://127.0.0.1:<production-port> npm run health:check
```

Service restart and proxy cutover are host-specific and REQUIRES OPERATOR AUTHORIZATION; use `docs/GATE4_ACTIVATION_CHECKLIST.md` and `docs/VPS_RUNTIME_RUNBOOK.md`. Deployment locking, GitHub-check enforcement, and automatic post-switch rollback are NOT YET IMPLEMENTED.
