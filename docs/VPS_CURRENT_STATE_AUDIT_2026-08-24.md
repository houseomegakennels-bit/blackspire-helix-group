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
- `BLACKSPIRE_DB_PATH`, `BLACKSPIRE_WORKSPACE_ROOT`, `BIND_HOST`, and `PORT` are configured. `BLACKSPIRE_OPERATOR_PRINCIPAL_ID`, production execution/provider keys, and `CODEX_HOME` were not present at audit time.
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

## Preliminary safety snapshots and disposable rehearsal

At `2026-08-24T12:40:25Z`, the reviewed `scripts/backup.js` contract created root-only online safety snapshots outside the runtime-owned tree. The sources stayed online and unchanged, so these are **not** the required quiesced cutover backups:

- staging snapshot SHA-256: `a5a247528720bdb0cd045f7d77e482b5e816458d53d77038d9073ed545e8e63a`
- Docker snapshot SHA-256: `f7cd8341a10265872546121a8603bd1a23c0eeb5056f367356672e69c0e6a93d`

Both snapshots and checksum sidecars are `0600 root:root`; checksum verification passed. Read-only comparison found SQLite integrity `ok`, zero foreign-key violations, and no ID overlap except the single workspace. Staging contains newer but sparse July 21 input/conversation history; Docker contains distinct July 17–23 execution, provider, evidence, and approval history. Automatic record merging is unsafe and was not attempted.

The dedicated migration command succeeded independently on disposable copies of both snapshots. Each reopened with integrity `ok`, zero foreign-key violations, and zero missing current schema objects while preserving its original row counts. Migration correctly created no principal or grant.

The existing provisioning CLI then applied an explicit rehearsal admin principal plus a service-role minimum grant on each disposable migrated copy. Exact repeat was idempotent. Authorization allowed only `workspace.read`, `task.read`, `task.create`, `task.execute`, `approval.grant`, and `runtime.read`; it denied another workspace, `provider.use.development`, and `workspace.manage`. No rehearsal identifier or grant was written to a live database or environment.

Initial production will initialize a deliberately clean canonical database at the configured production target through the reviewed migration path after the exact deployment main SHA is finalized. Neither historical database will be promoted or automatically merged. Staging has 21 stale claimed queued tasks that recovery could execute; Docker has old accounting plus a pending approval attached to a cancelled task. Only the workspace ID overlaps, and the configured production target has never existed. Either legacy source is therefore unsafe as implicit production authority.

Both historical databases remain preserved as read-only reconciliation sources. Writer-stopped, checksum-verified backups remain mandatory immediately before retiring either writer or cutting over. Any later import or retention decision requires a separately reviewed record-level migration plan.

## Codex service-home preparation

An empty `/opt/blackspire-command/shared/codex-home` now exists as `0700 blackspire:blackspire`, outside `ProtectHome` and inside the reviewed service writable path. A service-equivalent empty-environment invocation can execute the installed `codex-cli 0.149.0` binary with that `CODEX_HOME`.

No credential file was inspected or copied, no login status or authentication content was printed, and the production environment still does not set `CODEX_HOME`. The directory is therefore **prepared but unauthenticated and unconfigured**. Credential-owner login or a separately reviewed transfer mechanism plus the bounded sanitized capability probe remain deployment blockers.
