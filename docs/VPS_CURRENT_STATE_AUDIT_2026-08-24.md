# VPS Current-State Audit — 2026-08-24 UTC

Read-only observation time: `2026-08-24T11:52:42+00:00`.

This is an observation, not deployment evidence. No service, container, database, proxy, unit, release link, environment file, or credential was changed.

## Runtime topology

- `blackspire-command.service` is installed but disabled and inactive.
- `blackspire-command-worker.service` and `blackspire-command.target` are not installed.
- The installed API unit is the historical single-supervisor definition, not the reviewed three-unit topology from PR #105.
- Legacy Docker containers `blackspire-api-1` and `blackspire-worker-1` have been running since July. Docker proxy owns wildcard host port `8787`; the API and worker containers share the `blackspire_command-data` volume.
- A separate staging API process runs as `blackspire` from release `f0a7b66853b4c983d6930c1b70d1d94cb5f26f36` on loopback port `8788`.
- nginx routes `jarvis.blackspirehelix.com` to the staging upstream at `127.0.0.1:8788`, not to port `8787` or canonical production systemd.

## Release and state layout

- `/opt/blackspire-command/current` is absent; no active immutable production release link exists.
- Historical release directories are preserved.
- The canonical shared staging database path exists under `/opt/blackspire-command/shared/database/staging/` with its WAL/SHM files.
- The legacy Docker runtime uses its own named volume at `/var/lib/docker/volumes/blackspire_command-data/_data`.
- `/etc/blackspire/command.env` exists with restrictive `0640 root:blackspire` metadata. Only key presence was inspected; no value was recorded.
- `BLACKSPIRE_DB_PATH`, `BLACKSPIRE_WORKSPACE_ROOT`, `BIND_HOST`, and `PORT` are configured. `BLACKSPIRE_OPERATOR_PRINCIPAL_ID`, production execution/provider keys, and `CODEX_HOME` were not present.
- The configured production database target does not exist. The staging database has one workspace and 28 tasks; the legacy Docker database has one workspace and 15 tasks. Both predate the merged authorization/accounting schema and lack `auth_principals`, `auth_workspace_grants`, and `usage_ledger`. Counts were read through SQLite read-only mode; no row contents were recorded.

## Public truthfulness gap

- `https://jarvis.blackspirehelix.com/health` and `/ready` respond successfully from staging.
- Those historical responses do not include deployment identity, lifecycle, dependency health, worker heartbeat, or systemd generation evidence now required by current reviewed source.
- The public readiness response reports all production providers disabled by profile.
- Therefore public availability is not evidence that reviewed main, the independent worker topology, workspace authorization provisioning, or real Codex execution is live.

## Deployment blockers confirmed by observation

1. PR #105 must merge before installing its reviewed API/worker/target topology.
2. The persisted production operator principal and intended workspace grants must be provisioned and verified.
3. A private service-accessible `CODEX_HOME` outside protected home must be prepared without exposing credential contents.
4. The authoritative production database path and legacy Docker-volume disposition must be selected without destroying either state source. The configured target is absent, and both existing databases require the reviewed migration path before principal/grant provisioning.
5. A database backup, candidate/rollback SHA record, exact reviewed release, and Gate 4 preparation evidence are required before cutover.
6. nginx must be switched only after activation-specific API/worker generation readiness succeeds.

Until those conditions and the real Jarvis-to-Codex smoke pass, production remains **NOT LIVE** under the current definition.
