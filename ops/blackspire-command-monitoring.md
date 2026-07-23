# Durable VPS monitoring template

These are operator-applied templates; this repository change does not install or
alter live services. Run the healthcheck every minute through the existing
approved supervisor, alert after three consecutive failures, and alert when the
database filesystem is below 20% free space. Retain compressed container logs for
14 days or 50 MiB per file using `blackspire-command-logrotate.conf`.

The healthcheck scrapes the same loopback host and explicit port the runtime binds
(`BIND_HOST`/`PORT` from the production environment file, or an explicit
`BLACKSPIRE_HEALTH_URL`). It has no default port and fails closed when the port is
unset, so monitoring can never silently probe the existing 8787 API/worker listener
or restricted staging on 8788. Rollback reuses the same environment file, so a
switched release keeps the identical loopback host and port.

Record only sanitized events: release SHA, activation time, rollback SHA,
migration result, health result, and restart count. Cap restarts at five attempts
in ten minutes, then remain stopped for operator review.

Review these files, install them through the existing host mechanisms, and verify
alerts before any production approval.
