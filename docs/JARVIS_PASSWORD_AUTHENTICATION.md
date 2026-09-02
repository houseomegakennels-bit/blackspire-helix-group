# Jarvis administrator password migration

Jarvis browser login and machine bearer authentication use independent credentials.

On the trusted production host, from the reviewed release checkout, run:

```bash
cd /opt/blackspire-command/current
export PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:$PATH
npm run auth:hash-password
```

Enter the chosen 13–128 character password only at the hidden prompts. Put the single encoded value printed by the command into the API-only `/etc/blackspire/command-api.env` as a single-quoted shell assignment: `COMMAND_ADMIN_PASSWORD_HASH='<encoded-hash>'`. The encoded scrypt value contains `$` characters and must remain quoted so shell-based validation reads it literally. Never put the verifier, bearer token, or session secret in shared `/etc/blackspire/command.env`; the worker loads that shared file. Do not put the plaintext password in either file, a command argument, Git, logs, or chat.

Keep `ALLOW_BEARER_AUTH=false` in the API-only file unless a separately authorized machine client requires bearer access. With bearer disabled, `COMMAND_ADMIN_TOKEN` is not used for browser login and may be removed after all machine clients are confirmed migrated. With bearer enabled, retain a separate high-entropy `COMMAND_ADMIN_TOKEN` of at least 24 characters in that API-only file.

Before restarting, use the existing release preflight. **Credential cutover requires session invalidation:**
before changing the verifier or restarting, POST `/api/auth/revoke-all` from an authenticated operator
session with its CSRF token, confirm `200`, and discard the old browser cookie. This durable fence
invalidates every browser session issued under the token-era model and is safe to repeat. Machine
bearer authentication is independent and is not revoked by this browser-session operation.
Then restart through the established target and bounded readiness path:

```bash
sudo -u blackspire-api /opt/nodejs/node-v22.23.1-linux-x64/bin/node /opt/blackspire-command/current/scripts/production-preflight-check.js --strict
sudo systemctl restart blackspire-command.target
/opt/blackspire-command/current/scripts/wait-production-ready.sh http://127.0.0.1:8789 \
  blackspire-command.service blackspire-command-worker.service 60 1
/opt/blackspire-command/current/scripts/health-check.sh http://127.0.0.1:8789 production
```

Verify `/health` and `/ready`, sign in through the Jarvis password form, confirm the session endpoint reports the configured canonical principal, confirm a state-changing request still requires CSRF, and confirm bearer access remains denied when disabled. If readiness fails, use the existing Gate 4 compensation/rollback procedure; do not weaken validation or restore token-based browser login.

Every interactive browser environment, including development, must configure `COMMAND_ADMIN_PASSWORD_HASH`; the browser never submits or falls back to `COMMAND_ADMIN_TOKEN`. A narrowly scoped compatibility path remains only for legacy automated non-production API fixtures that explicitly send an `adminToken` JSON field while no password hash is configured. It is not a supported browser-login configuration and cannot activate under `NODE_ENV=production`.
