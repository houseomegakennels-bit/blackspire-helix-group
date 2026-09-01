# BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE

## Production authentication migration

This guide supersedes its former token-as-human-login instructions. Jarvis browser login now uses an operator-chosen password whose scrypt hash is stored server-side as `COMMAND_ADMIN_PASSWORD_HASH`. `COMMAND_ADMIN_TOKEN` is a separate machine credential and must never be entered in the browser. Do not send or record the plaintext password in chat, shell arguments, Git, logs, or deployment dashboards.

On the trusted VPS, generate the hash interactively from the reviewed active release as documented in `docs/JARVIS_PASSWORD_AUTHENTICATION.md`. Put the encoded hash only in the API-only `/etc/blackspire/command-api.env`, using the single-quoted assignment documented there. The API-only file contains exactly `COMMAND_ADMIN_PASSWORD_HASH`, `SESSION_SECRET`, `ALLOW_BEARER_AUTH`, and the optional `COMMAND_ADMIN_TOKEN`; create it from `scripts/production-api.env.example` as directed by `docs/GATE4_ACTIVATION_CHECKLIST.md`. Never put any of those authentication values in shared `/etc/blackspire/command.env`: the worker loads that shared file, which must contain only the worker-safe settings from `scripts/production-profile.env.example`. Production activation remains a Gate 4 operator procedure; do not use the obsolete Docker startup path in older copies of this guide.

## Exact iPhone setup steps

1. In API-only `/etc/blackspire/command-api.env`, configure `COMMAND_ADMIN_PASSWORD_HASH` from the interactive trusted-host procedure. Keep the plaintext password only in the operator's password manager.
2. In API-only `/etc/blackspire/command-api.env`, set `SESSION_SECRET` to a separate 32+ character random value and keep `ALLOW_BEARER_AUTH=false` by default.
3. In shared, worker-safe `/etc/blackspire/command.env`, set `PUBLIC_BASE_URL` to your HTTPS domain (e.g. `https://command.example.com`) — production startup
   refuses HTTP.
4. In shared, worker-safe `/etc/blackspire/command.env`, set `SECURE_COOKIES=true`, `DEBUG=false`, and
   `RATE_LIMIT_DISABLED=false`, matching `scripts/production-profile.env.example`.
5. In shared, worker-safe `/etc/blackspire/command.env`, set `TRUST_PROXY` explicitly to `true` (if the deployment sits behind a reverse proxy/load balancer that
   sets `X-Forwarded-For`) or `false` (if the API receives connections directly). Production startup now
   refuses to boot if this is left unset.
6. If an independently authorized machine client requires bearer access, set `ALLOW_BEARER_AUTH=true` and configure a separate high-entropy `COMMAND_ADMIN_TOKEN` (24+ characters), both in API-only `/etc/blackspire/command-api.env`. Bearer authentication is off by default and the machine token is never a browser-login credential.
7. Leave Telegram non-production/dry-run unless its separate identity, authorization, context, and deduplication acceptance gates have been completed.
8. Activate the reviewed immutable release through `docs/GATE4_ACTIVATION_CHECKLIST.md`; do not copy files into the active release or start an alternate Docker topology.
9. On iPhone Safari, open `https://your-domain.example/jarvis`.
10. Enter the operator password and tap **Unlock Jarvis**. The browser sends it only for this login request and does not persist it.
11. Tap **Install PWA support**, then Safari Share > **Add to Home Screen**.
12. Open Jarvis from the Home Screen, select a workspace, submit a safe task, and confirm it appears in Task
    History. Check the new status badge row for **Emergency stop: inactive** and **Telegram: <mode>**.
13. Tap a task in Task History, then tap **Approval history** to see past approve/reject decisions, and
    **Download JSON** / **Download Markdown** to pull the full evidence bundle to your phone.
14. Do not use this setup procedure to activate Telegram, voice input, provider mutations, or any capability that has not passed its own reviewed production gate.
15. Sign out of Jarvis (**Sign out**) and back in to confirm session rotation/expiry works: a signed-out
    session must not be reusable, and re-entering the operator password must produce a fresh session.

## Mobile Operations
- Jarvis is the production browser control surface covered by this guide. Telegram remains outside this activation procedure.
- Emergency stop is available through the authorized Jarvis control and is reflected in the Jarvis status badge and sanitized health state.
- Backup and restore remain scriptable for operators or hosted scheduled jobs (`npm run db:backup` / `npm run db:restore`).
- Evidence bundles can be pulled from Jarvis using its authorized download controls.
- If a session expires while using Jarvis, sign in again with the operator password. Never substitute the machine bearer token.
