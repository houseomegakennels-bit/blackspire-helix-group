# BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE

## Exact Phone-Only Setup Steps (final merge-readiness pass)

1. Set `COMMAND_ADMIN_TOKEN` to a long (24+ character) random value in the deployment environment — not the
   `dev-admin-token-change-me` default, which production startup now refuses to boot with.
2. Set `SESSION_SECRET` to a separate 32+ character random value.
3. Set `PUBLIC_BASE_URL` to your HTTPS domain (e.g. `https://command.example.com`) — production startup
   refuses HTTP.
4. Set `SECURE_COOKIES=true`, `DEBUG=false`, `CORS_ORIGIN` to your real origin (not `*`), and
   `RATE_LIMIT_DISABLED=false`.
5. Set `TRUST_PROXY` explicitly to `true` (if the deployment sits behind a reverse proxy/load balancer that
   sets `X-Forwarded-For`) or `false` (if the API receives connections directly). Production startup now
   refuses to boot if this is left unset.
6. If you want the Telegram bridge or any script to call the API with a bearer token instead of a browser
   session, set `ALLOW_BEARER_AUTH=true` explicitly — it is off by default in production.
7. Set `TELEGRAM_ALLOWED_USERS` to your numeric Telegram user ID, create a bot with BotFather, set
   `TELEGRAM_BOT_TOKEN`, and if using webhook mode set `TELEGRAM_WEBHOOK_SECRET` (required — production
   startup refuses webhook mode without it).
8. Start the service with `docker compose up -d` or the hosted equivalent.
9. On iPhone Safari, open `https://your-domain.example/jarvis`.
10. Enter the admin token and tap **Unlock**.
11. Tap **Install PWA support**, then Safari Share > **Add to Home Screen**.
12. Open Jarvis from the Home Screen, select a workspace, submit a safe task, and confirm it appears in Task
    History. Check the new status badge row for **Emergency stop: inactive** and **Telegram: <mode>**.
13. Tap a task in Task History, then tap **Approval history** to see past approve/reject decisions, and
    **Download JSON** / **Download Markdown** to pull the full evidence bundle to your phone.
14. In Telegram, send `/start`, then `/task write a status note` from the allowlisted account. Send a photo
    or text file as a Telegram document to confirm attachment intake, and a voice note to confirm the
    transcription adapter path (configure `TRANSCRIPTION_ADAPTER=mock` or `http` first, or expect an explicit
    "transcription is unavailable" reply — the voice note is never silently dropped either way).
15. Sign out of Jarvis (**Logout**) and back in to confirm session rotation/expiry works: a signed-out
    session must not be reusable, and re-entering the admin token must produce a fresh session.

## Mobile Operations
- Normal control surfaces are Telegram and Jarvis; no desktop-only step is required for any of the above.
- Emergency stop is available as Telegram `/stop` and the Jarvis **GLOBAL STOP** button; both are reflected
  in the Jarvis status badge and in `GET /health`'s `emergencyStop` field.
- Backup and restore remain scriptable for operators or hosted scheduled jobs (`npm run db:backup` / `npm run db:restore`).
- Evidence bundles can be pulled from Jarvis (download buttons) or Telegram (`/export <taskId>` — delivered
  as a document automatically once the bundle is too large for a single message).
- If a session expires while using Jarvis, the UI now shows "Session expired. Please sign in again." instead
  of failing silently — just re-enter the admin token.
