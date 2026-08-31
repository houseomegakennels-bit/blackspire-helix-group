# Jarvis administrator password migration

Jarvis browser login and machine bearer authentication use independent credentials.

On the trusted production host, from the reviewed release checkout, run:

```bash
cd /opt/blackspire-command/current
export PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:$PATH
npm run auth:hash-password
```

Enter the chosen 13–128 character password only at the hidden prompts. Put the single encoded value printed by the command into `/etc/blackspire/command.env` as `COMMAND_ADMIN_PASSWORD_HASH`. Do not put the plaintext password in that file, a command argument, Git, logs, or chat.

Keep `ALLOW_BEARER_AUTH=false` unless a separately authorized machine client requires bearer access. With bearer disabled, `COMMAND_ADMIN_TOKEN` is not used for browser login and may be removed after all machine clients are confirmed migrated. With bearer enabled, retain a separate high-entropy `COMMAND_ADMIN_TOKEN` of at least 24 characters.

Before restarting, use the existing release preflight. Then restart through the established target and bounded readiness path:

```bash
sudo -u blackspire /opt/nodejs/node-v22.23.1-linux-x64/bin/node /opt/blackspire-command/current/scripts/production-preflight-check.js --strict
sudo systemctl restart blackspire-command.target
/opt/blackspire-command/current/scripts/wait-production-ready.sh http://127.0.0.1:8789 \
  blackspire-command.service blackspire-command-worker.service 60 1
/opt/blackspire-command/current/scripts/health-check.sh http://127.0.0.1:8789 production
```

Verify `/health` and `/ready`, sign in through the Jarvis password form, confirm the session endpoint reports the configured canonical principal, confirm a state-changing request still requires CSRF, and confirm bearer access remains denied when disabled. If readiness fails, use the existing Gate 4 compensation/rollback procedure; do not weaken validation or restore token-based browser login.

There is a development/test-only compatibility path for legacy `adminToken` request fixtures when no password hash is configured. It cannot activate under `NODE_ENV=production`.
