# Isolated Staging Launch Plan

Status: repository plan only. No host, DNS, secret, certificate, database, service, provider,
Telegram connection, deployment, routing, or production state was created or changed.

## Current evidence and launch blockers

The repository understands `BLACKSPIRE_STATE_OWNER=vps-staging` and reserves the existing restricted
staging listener on loopback port 8788. It does **not** contain the deployed staging launcher,
systemd unit, environment template, immutable staging release switch, or staging-specific preflight.
The existing host staging service is therefore not reproducible from reviewed repository artifacts.
Do not copy its unreviewed host files into this repository or treat its health as evidence for a new
isolated environment.

An independently isolated staging launch requires four operator decisions before infrastructure can
be provisioned: approved hostname, separate-host versus same-host topology, retention/backup policy,
and the human/admin principal set. Recommended topology is a separate least-privileged VM/account and
separate DNS name. Same-host staging is possible only after an explicit risk acceptance and distinct
state root, account, unit, port, database, workspace, logs, backups, and proxy upstream are reviewed.

## Infrastructure checklist

- [ ] Record the approved staging hostname and accountable operator; never infer either from production.
- [ ] Provision or identify the approved isolated host/VM; record provider, region, owner, and patch baseline.
- [ ] Create a non-root staging runtime account distinct from production and interactive operator accounts.
- [ ] Allocate an absolute staging root with separate `releases/`, `shared/`, `backups/`, `workspace/`, and logs.
- [ ] Select an explicit loopback application port that conflicts with neither 8787/8788 nor the reviewed production candidates 8789–8799; verify it read-only immediately before activation.
- [ ] Enforce host firewall policy: public 443 only through the proxy, SSH by approved policy, no public app port.
- [ ] Install the pinned Node 22.23.1 interpreter and verify `node:sqlite`; do not use the host PATH Node.
- [ ] Prepare a staging-specific systemd unit and supervisor in the repository, independently reviewed before installation.
- [ ] Configure resource limits, restart-storm cap, log rotation, disk alerts, and database free-space alert.
- [ ] Record infrastructure ownership and teardown authority.

## DNS and TLS checklist

- [ ] Operator supplies the exact staging FQDN; placeholders and production names are forbidden.
- [ ] Create the A/AAAA record only after the destination address and firewall are approved.
- [ ] Use a staging-specific certificate and renewal mechanism; never copy production private keys.
- [ ] Proxy HTTPS to the explicit staging loopback upstream and overwrite trusted forwarding headers.
- [ ] Confirm HTTP redirects to HTTPS, TLS validation succeeds, HSTS/CSP/security headers survive, and the app port is unreachable externally.
- [ ] Record TTL and a rollback plan: remove/restore the record and proxy route without touching production DNS.

## Secrets checklist

- [ ] Generate staging-only `COMMAND_ADMIN_TOKEN` and `SESSION_SECRET`; never reuse development or production values.
- [ ] Store secrets outside Git in a root-owned, staging-group-readable file with reviewed mode; do not print or pass them in argv.
- [ ] Keep provider keys, provider endpoints, Telegram bot token, and Telegram webhook secret absent for the initial no-provider launch.
- [ ] Keep GitHub write credentials absent unless a later separately approved staging workflow requires them.
- [ ] Record secret owner, rotation date, revocation path, and evidence location without recording values.
- [ ] Run the repository secret scan over the release and confirm logs/probe responses contain no secret values.

## Environment checklist

- [ ] `NODE_ENV=production` for hardened cookie/CSP behavior.
- [ ] `BLACKSPIRE_STATE_OWNER=vps-staging` and a future reviewed staging runtime marker; never `vps-production`.
- [ ] Explicit `BIND_HOST=127.0.0.1` and approved staging-only port.
- [ ] Staging-only absolute `BLACKSPIRE_DB_PATH`, data, attachments, backup, and workspace paths; none may resolve into production, existing restricted staging, a release tree, or `/tmp` for durable staging.
- [ ] `BLACKSPIRE_PROVIDER_MODE=manual`, real Hermes disabled/restricted, and Telegram dry-run/disconnected.
- [ ] `UNIFIED_IPHONE_TEST_MODE` and migration-on-start flags absent/false.
- [ ] Staging HTTPS `PUBLIC_BASE_URL`, secure cookies, explicit proxy trust, rate limiting enabled, debug disabled.
- [ ] Fixed startup/health timeouts and worker identity; no implicit ports or state-owner defaults.
- [ ] Add and validate a repository-owned `vps-staging` environment-preflight mode before launch. The current verifier has no such mode and is a blocker.

## Database and migration checklist

- [ ] Create a new empty staging database path owned only by the staging runtime; never clone production data by default.
- [ ] If production-like data is later required, obtain explicit data authorization, minimize/anonymize it, and document deletion; this plan does not authorize copying it.
- [ ] Stop staging writers before migration, take a WAL-safe staging backup, verify checksum/integrity/table inventory, and restore only to a disposable target first.
- [ ] Run `BLACKSPIRE_RUN_MIGRATIONS=true node scripts/migrate.js` as a separate bounded command, never API/worker startup.
- [ ] Run startup schema compatibility after migration and preserve the pre-migration backup plus prior release.
- [ ] Define staging retention and encrypted off-host backup policy; current repository tooling does not provide encryption or off-host transfer.

## Deployment checklist

- [ ] Select an exact full reviewed commit SHA whose required PRs are merged; record its CI and review evidence.
- [ ] Build an immutable staging release with dependency lockfile integrity and verify manifest, ownership, modes, symlink containment, and completion marker.
- [ ] Create a separate writable staging workspace checkout at the same approved SHA, outside the release tree.
- [ ] Install the reviewed staging unit/environment/proxy configuration without replacing an active production artifact.
- [ ] Run staging preflight as the staging user inside the unit sandbox; it must validate isolation, port, paths, credentials absence, schema, workspace, and pinned interpreter.
- [ ] Keep the prior staging release and backup. Switch the staging symlink atomically only after all preconditions pass.
- [ ] Start staging only under explicit staging deployment approval. This plan is not that approval.

## Validation checklist

- [ ] `/health` returns sanitized liveness; `/ready` returns ready only with compatible schema/config and drops during drain.
- [ ] Verify listener is loopback-only and the public hostname reaches only the proxy.
- [ ] Verify effective runtime user, unit sandbox, read-only release, writable staging-only shared paths, restart cap, and resource limits.
- [ ] Verify database `integrity_check`, WAL mode, schema compatibility, backup checksum, and disposable restore.
- [ ] Verify session login/logout/rotation/revoke, CSRF, cookie flags, CSP, rate limiting, authorization isolation, emergency stop/reset, and audit sanitization.
- [ ] Verify provider/Telegram credentials are absent and no outbound provider or Telegram request occurs.
- [ ] Verify monitoring catches a readiness failure and recovers after restoration; test alerts without touching production.
- [ ] Compare production listeners, processes, paths, database hashes/metadata, proxy config, and DNS before/after; expected production change is none.

## Smoke-test checklist

- [ ] Anonymous `/health`, `/ready`, and static shell return expected status/security headers; protected APIs refuse unauthenticated access.
- [ ] Staging-only admin session authenticates; forged/cross-workspace access refuses without object disclosure.
- [ ] Create and read a disposable low-risk task in the staging database; confirm no provider dispatch.
- [ ] Exercise approval-required and policy-denied requests; confirm no authority escalation.
- [ ] Activate/reset emergency stop with the required fresh confirmation and verify new work is blocked while active.
- [ ] Send SIGTERM in a controlled window; readiness drops, API drains, worker stops claims, and in-flight recovery semantics are visible.
- [ ] Restart staging and confirm schema, session invalidation expectations, stale-task recovery, and health/readiness.
- [ ] Run no paid/live smoke. Any live provider or Telegram test requires separate scoped authorization.

## Rollback checklist

- [ ] Define rollback trigger and decision owner before cutover.
- [ ] Stop staging writers; preserve sanitized logs/evidence and identify code versus config versus schema failure.
- [ ] Atomically switch only the staging symlink to the recorded prior completed release.
- [ ] Restore configuration from the staging-only prior version; never substitute production configuration.
- [ ] If schema rollback is required, restore the verified staging backup to a new explicit target while stopped; never overwrite an uncertain database.
- [ ] Re-run schema, integrity, health, readiness, policy, auth, and no-provider smoke checks.
- [ ] If rollback cannot validate cleanly, leave staging stopped and remove public staging routing; production remains untouched.

## Operator launch checklist

- [ ] Approve hostname, topology, retention policy, principals, exact release SHA, maintenance window, and rollback owner.
- [ ] Confirm independent code/config/security review is complete and all required PRs are merged base-first.
- [ ] Confirm infrastructure, DNS/TLS, secret, environment, database, deployment, validation, smoke, monitoring, backup, and rollback checklists are signed off with sanitized evidence.
- [ ] Confirm production remains out of scope, Gate 4 remains unauthorized, and no live provider/Telegram credential is present.
- [ ] Grant a separate bounded staging deployment authorization naming host, SHA, paths, unit, port, hostname, start/stop actions, and rollback target.
- [ ] After launch, record exact SHA, unit state, listener, health/readiness, smoke results, alert test, backup/restore evidence, and production-before/after comparison.

## Repository work still required before launch

1. Add a fail-closed `vps-staging` mode to `scripts/verify-environment.sh` and matching tests.
2. Add reviewed staging environment and systemd templates with a repository-owned supervisor/launcher.
3. Add a staging preflight that validates isolation and produces sanitized machine-readable findings.
4. Add staging immutable release/switch/rollback tooling or parameterize existing tooling without allowing cross-environment targets.
5. Add encrypted off-host backup/retention tooling or record the approved external mechanism.
6. Add monitoring alert-test evidence capture and a staging teardown/rebuild runbook.

Items 1–4 are dependency-safe repository work. Provisioning, DNS, secrets, certificate issuance,
installation, deployment, and start/route actions require explicit operator authorization.
