# Incident response runbook

## First response

1. Do not enable providers, Telegram, Gate 4, or memory promotion while diagnosing.
2. Preserve logs, release SHA, timestamps, task/job IDs, workspace IDs, and the operator action trail without copying secrets.
3. Run read-only checks:

```bash
npm run production:preflight:host
BLACKSPIRE_GATE4_APPROVED_SHA=<40-character-sha> bash scripts/gate4-prepare.sh --json
BLACKSPIRE_HEALTH_URL=http://127.0.0.1:<port> npm run health:check
```

4. If rollback is authorized, follow `docs/ROLLBACK_AND_RECOVERY_RUNBOOK.md`.

## Incident classes

- **Authentication/authorization:** revoke sessions through the authenticated API; rotate affected credentials through their owner. REQUIRES OPERATOR AUTHORIZATION.
- **Provider failure:** keep real providers disabled, record retry/circuit state, and use mock-only verification. Paid failover is INTENTIONALLY DISABLED.
- **Database/migration:** stop mutation, take a verified backup, and rehearse only a disposable restore. Production restore is NOT YET IMPLEMENTED.
- **Worker/job:** stop new claims using the durable emergency control; graceful drain is PARTIALLY VERIFIED. Host activation/recovery REQUIRES OPERATOR AUTHORIZATION.
- **Telegram:** disable transport without deleting durable task/outbox evidence; rotate bot/webhook credentials through the owner.

Alert routing remains NOT YET IMPLEMENTED. The provider-neutral monitoring design in `ops/blackspire-command-monitoring.md` is PARTIALLY VERIFIED and must not be connected to a paging service without authorization.
