# Durable VPS monitoring template

These are operator-applied templates; this repository change does not install or
alter live services. Run the healthcheck every minute through the existing
approved `blackspire-command-monitor.timer`. The provider-neutral runner persists the consecutive
failure count, exits nonzero on the third failure, and invokes the reviewed `OnFailure` unit. That
unit records a local `daemon.alert` journal event only; the operator must connect and test off-host
delivery. No external alert provider or credential is selected by this repository. Alert when the
database filesystem is below 20% free space. Retain the production unit's isolated combined JSON
log for 14 rotations, rotating daily or at 50 MiB, using `blackspire-command-logrotate.conf`. The
policy names only `/var/log/blackspire-command/command.log`; it must never rotate a Docker-wide glob.

The timer is the single writer of `/var/lib/blackspire-command-monitor/consecutive-health-failures`;
do not schedule a second concurrent runner. Continued failures at or above the threshold emit a
local alert each minute, so the off-host destination must deduplicate or group an incident. A
successful health check atomically resets the counter to zero. Missing, symlinked, malformed, or
unreadable state fails closed with a sanitized structured error and is never silently reset.
Native utility diagnostics are suppressed at the runner boundary and collapsed into fixed
structured error codes, so private host paths cannot escape through stderr. The filesystem probe
is killed after five seconds, and the `Type=oneshot` service has a 20-second `TimeoutStartSec` bound;
a hung invocation therefore cannot occupy the next minute's timer slot indefinitely.

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

Review these files, install them through the existing host mechanisms, and verify
alerts before any production approval.
