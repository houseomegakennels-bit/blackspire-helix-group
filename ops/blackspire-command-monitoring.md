# Durable VPS monitoring template

These are operator-applied templates; this repository change does not install or
alter live services. Run the healthcheck every minute through the existing
approved supervisor, alert after three consecutive failures, and alert when the
database filesystem is below 20% free space. Retain the production unit's isolated combined JSON
log for 14 rotations, rotating daily or at 50 MiB, using `blackspire-command-logrotate.conf`. The policy names
only `/var/log/blackspire-command/command.log`; it must never rotate a Docker-wide glob.

The healthcheck scrapes both `/health` (process liveness and safe Telegram mode) and `/ready`
(lifecycle, schema compatibility, and startup configuration) on the same loopback host and explicit port the runtime binds
(`BIND_HOST`/`PORT` from the production environment file, or an explicit
`BLACKSPIRE_HEALTH_URL`). It has no default port and fails closed when the port is
unset, so monitoring can never silently probe the existing 8787 API/worker listener
or restricted staging on 8788. Rollback reuses the same environment file, so a
switched release keeps the identical loopback host and port.

Treat either endpoint failing as an availability failure; do not restart merely because liveness is
up while readiness is down without retaining the sanitized readiness state for diagnosis. Record
only sanitized events: release SHA, activation time, rollback SHA,
migration result, health result, and restart count. Cap restarts at five attempts
in ten minutes, then remain stopped for operator review.

After the operator records an RPO, run the read-only latest-backup verifier on the approved schedule
and alert on any nonzero exit. The age ceiling must be the approved RPO, never a repository default:

```sh
npm run db:verify-backup -- /opt/blackspire-command/shared/backups --max-age-hours <approved-hours>
```

The command prints no absolute path or digest and changes nothing. It does not replace an off-host,
encrypted backup policy or a disposable restore rehearsal.

Review these files, install them through the existing host mechanisms, and verify
alerts before any production approval.
