# ZOLA executable release preparation

These commands operate from the clean reviewed release checkout with Node 22.23.1. They do not authorize merge or production activation. Every protected input/output lives under root-owned ancestors and excludes credentials from console output. Retain partial files and journals after failure; do not overwrite them to retry an uncertain operation.

## Exact-head offline bundle

`bash scripts/with-node.sh scripts/zola-prepare-release.js INPUT_JSON OUTPUT_DIRECTORY` verifies the local/remote release SHA and regenerates n8n and application migration artifacts from reviewed source. The input has exactly `releaseSha`, `n8nConfigurationFile`, `migrationConfigurationFile`, and `backupFile`. Both configuration files must name that same release SHA; the n8n configuration must bind the exact protected backup digest and published revision.

The root-only output contains workflow, PUT and deactivation payloads, migration SQL/body, their individual manifests, and a manifest written last after fsync. The legacy backup itself is not copied into the bundle. Rerunning verifies every existing byte and protection requirement; altered, partial, linked or foreign output is refused. No SQL is executed and no workflow is changed. `OFFLINE_PREPARED` is not live credential or provider acceptance.

## Protected canonical database backup

`bash scripts/with-node.sh scripts/zola-release-backup.js --capture RELEASE_SHA` captures the fixed canonical `/opt/blackspire-command/shared/database/command.sqlite` into `/var/lib/blackspire-operator/preparation/zola-backups`. A read-only SQLite connection produces a consistent snapshot, including committed WAL data. The copy runs in a bounded child with measured source/WAL/SHM and disk headroom checks, a file-size limit, a 30-second deadline and a protected SQLite temporary directory. The canonical source is not modified. Failed captures remain protected for inspection.

The output identifies a protected manifest binding release SHA, source device/inode, capture interval, size, schema integrity and snapshot digest. `bash scripts/with-node.sh scripts/zola-release-backup.js --verify RELEASE_SHA MANIFEST_FILE` verifies that proof, current canonical source identity and one-hour freshness. This proves a restorable schema-compatible backup; it does not establish full functional rollback or preservation of writes occurring after capture.

## Executable preflight

`bash scripts/with-node.sh scripts/zola-release-command.js --preflight INPUT_JSON` takes exactly:

- `releaseSha`: exact reviewed local and remote release head.
- `packageConfigurationFile`: the bundle's `n8n-configuration.json`.
- `backupFile`: the protected n8n baseline bound by that configuration.
- `diskConfigurationFile`: the existing measured deployment-envelope configuration for the same sealed production artifact.
- `backupManifestFile`: the protected canonical database snapshot manifest.

Under the host-wide lock it verifies source, authenticated CI artifact and mandatory steps, the sealed production artifact and measured disk envelope, protected backup, n8n package and actual GET-only workflow observations. It rechecks identities and input stability, preserving ordered evidence in the `release` stream and workflow observations in `n8n`. `--inspect` validates and reports retained history. Unknown mutation events or pending workflow intents never authorize automatic retry.

Even when this prefix passes, the command exits nonzero with `RELEASE_GATES_UNWIRED`. Provider ACL, historical routing containment, full rollback, production six-read acceptance, intake-held activation, writer identity, migrations, n8n continuity, protected merge, production SHA pairing and smoke are not yet an executable complete release sequence. Do not replace these missing gates with supplied PASS flags.

The live writer verifier requires actual API and worker generations. A future activation sequence must establish those under held public intake before writer-dependent workflow publication; it cannot publish first by weakening readiness. After a reviewed merge, `scripts/zola-verify-merged.js` verifies the protected premerge CI tree/parents against the confirmed new main SHA, but does not substitute for observed Vercel/VPS deployment pairing.

For connected collection and root-delegated second-principal sessions, see `ZOLA_SIX_READ_COLLECTOR.md`. The delegated authentication method is explicitly operator-issued, not a second person's password login. No production delegation or collector acceptance is established by disposable tests.
