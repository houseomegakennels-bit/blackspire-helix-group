# Go-Live Readiness Checklist

Production promotion is blocked until every item is evidenced and separately approved.

- [ ] The VPS is named as the only canonical production database owner.
- [ ] Task, conversation, event, evidence, delivery, and queue storage is persistent.
- [ ] Encrypted backups exist and a restore test has passed against an isolated target.
- [ ] Process supervision, automatic restart, and boot recovery are verified.
- [ ] A stable authenticated HTTPS endpoint exists; no Quick Tunnel is used.
- [ ] Production authentication and session controls are verified.
- [ ] Secrets are injected externally with least privilege and never enter Git/Codespaces.
- [ ] Health monitoring, alert routing, and dependency checks are active.
- [ ] Logs, errors, evidence, and browser output are redacted.
- [ ] Emergency stop and safe mode are tested before provider execution.
- [ ] Provider budgets and no-fallback behavior are tested.
- [ ] Cancellation, outbox retry, and cleanup are tested.
- [ ] Telegram cannot approve deployment, merge, repository creation, credentials, secrets, host security, budget increases, emergency controls, constitutional changes, trading, or funds actions.
- [ ] A reviewed rollback and database recovery exercise has passed.
- [ ] Mock providers are disabled.
- [ ] Test authentication is disabled.
- [ ] Disposable SQLite is not selected.
- [ ] Quick Tunnel is not used as production.
- [ ] Codespace availability is not required for uptime.
- [ ] Real provider and Telegram activation, if desired, have their own explicit approvals.
