# Production logging and retention

Status: reviewed repository contract only. Nothing in this document installs a unit, creates a
host directory, changes logrotate, or activates production.

## Data path and ownership

The production systemd unit sends both stdout and stderr to the single exact path
`/var/log/blackspire-command/command.log`. The API, worker, and supervisor emit line-delimited JSON,
so this preserves one chronological service stream. `LogsDirectory=blackspire-command` makes
systemd create the parent as `blackspire:blackspire` mode `0750`; `UMask=0027` and logrotate's
`create 0640 blackspire blackspire` keep new files group-readable but never world-readable.

The service must not write into Docker's log tree, rotate a wildcard, or claim another service's
logs. The preflight and contract tests reject those broader targets. Gate 4 reports an already
installed policy as ready only when it is byte-identical to the reviewed repository template.

## Rotation and capacity

`ops/blackspire-command-logrotate.conf` rotates daily and also at `maxsize 50M`, retains 14 rotated
files, compresses after one rotation, ignores an absent or empty log, and uses `copytruncate`
because the long-running supervisor does not reopen its output descriptor. `copytruncate` has a
small copy/truncate race in which a few log lines can be lost; this is an accepted local-retention
limitation, not a durable audit-log guarantee.

The 14-rotation policy is not a strict 14-day guarantee when the file crosses 50 MiB early. Local
disk retention is also not an off-host archive or disaster-recovery copy. Before production
authorization, the operator must validate the policy with `logrotate --debug`, force one rotation
against a disposable log, confirm ownership/mode after rotation, and exercise alert delivery.

## Failure and recovery

- A missing directory or unwritable file makes systemd startup fail rather than silently redirect
  output elsewhere; inspect `systemctl status blackspire-command` and the system journal.
- A divergent installed rotation file is a failed Gate 4 finding. Reconcile it through the reviewed
  installation procedure; automation must not overwrite it.
- Low disk space and failed rotation require an operator alert. The application has no authority to
  delete logs or loosen permissions.
- Rollback restores the prior service release and unit together. It does not restore already rotated
  or deleted logs.

Secrets must not be intentionally logged, but local retention is not a redaction boundary. The
repository secret scan catches committed credentials, not sensitive runtime values. Provider and
Telegram integrations remain disabled until their separately reviewed logging and redaction paths
are authorized and tested.
