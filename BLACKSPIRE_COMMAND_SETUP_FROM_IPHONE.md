# BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE

## First Mobile Login Procedure
1. Set `COMMAND_ADMIN_TOKEN` to a long random value in the deployment environment.
2. Set `TELEGRAM_ALLOWED_USERS` to your numeric Telegram ID and add `TELEGRAM_BOT_TOKEN` when ready.
3. Start the service with `docker compose up -d` or the hosted equivalent.
4. On iPhone Safari, open `https://your-domain.example/jarvis`.
5. Enter the admin token and tap **Unlock**.
6. Tap **Install PWA support**, then Safari Share > **Add to Home Screen**.
7. Open Jarvis from the Home Screen, select a workspace, submit a safe task, and confirm it appears in Task History.
8. In Telegram, send `/start`, then `/task write a status note` from the allowlisted account.

## Mobile Operations
- Normal control surfaces are Telegram and Jarvis.
- Emergency stop is available as Telegram `/stop` and the Jarvis **GLOBAL STOP** button.
- Backup and restore remain scriptable for operators or hosted scheduled jobs.
