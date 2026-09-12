# API-only scoped writer configuration

`scripts/zola-config-install.js` prepares and installs the explicit reviewed writer configuration. It never provisions SQL roles, restarts services, reloads systemd or grants activation authority. Run it within the release commander's exclusive administration window after provider ACL and scoped-role provisioning pass.

```sh
bash scripts/with-node.sh scripts/zola-config-install.js --plan <release-sha> <protected-configuration-file>
bash scripts/with-node.sh scripts/zola-config-install.js --install <release-sha> <protected-configuration-file> <new-protected-journal-file>
```

Both modes require root, stopped canonical API and worker units with the expected distinct users, verified NSS group separation, a sealed production artifact already installed under the exact release SHA, and the explicit protected configuration. The configuration is pinned to the production Supabase host, database, port, reviewed CA, workspace and authority-binding path. Plan mode makes no connections or changes. Install mode opens only the existing scoped PostgreSQL clients and their fixed read-only allow/deny checks, then closes them before publishing files. Failed role checks cannot install configuration.

The secret file is immutable and content-addressed under `/etc/blackspire`, owned by root with mode 0640 and the API's private group. Only the API unit receives `40-zola-writer.conf`. Publication uses a fully written, fsynced temporary inode and atomic no-replace link; foreign or changed files are never overwritten. A journal failure before intent prevents publication. A partial run may leave the valid secret file without the drop-in; identical reruns reconcile that state. A conflicting drop-in, symlink, hard link, ACL or partial final file is refused and preserved for review. Temporary files left by a crash are not automatically deleted by another run.

`INSTALLED_RELOAD_REQUIRED` means file installation only. The commander must independently verify the complete effective unit settings, reload systemd, activate the exact release, verify health/readiness and generation fencing, and execute the separately guarded writer activation. This command never claims those gates passed.
