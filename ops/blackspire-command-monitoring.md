# Durable VPS monitoring template

These are operator-applied templates; this repository change does not install or
alter live services. Run the healthcheck every minute through the existing
approved supervisor, alert after three consecutive failures, and alert when the
database filesystem is below 20% free space. Retain compressed container logs for
14 days or 50 MiB per file using `blackspire-command-logrotate.conf`.

Record only sanitized events: release SHA, activation time, rollback SHA,
migration result, health result, and restart count. Cap restarts at five attempts
in ten minutes, then remain stopped for operator review.

Review these files, install them through the existing host mechanisms, and verify
alerts before any production approval.
