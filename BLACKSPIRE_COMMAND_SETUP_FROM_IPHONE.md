# BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE

## Phone-Only Setup Sequence
1. In your hosting provider dashboard, set a strong `COMMAND_ADMIN_TOKEN` and `SESSION_SECRET`.
2. Set `PUBLIC_URL` to your HTTPS URL and keep `SECURE_COOKIES=true` in production.
3. Set `TELEGRAM_ALLOWED_USERS` to your numeric Telegram user ID.
4. Create a Telegram bot in BotFather and set `TELEGRAM_BOT_TOKEN` when live Telegram polling is desired.
5. Start or redeploy the container/service.
6. On iPhone Safari, open `https://your-domain.example/jarvis`.
7. Enter the admin token on the Jarvis sign-in screen; Jarvis stores a session cookie and CSRF token, not the admin token.
8. Use Jarvis to submit a low-risk task: `Create docs/mobile-verification.md with a one-paragraph mobile smoke-test note.`
9. Confirm the task appears in history, reaches completed locally, and exposes an evidence download.

## Still Required Before Public Internet Exposure
- HTTPS, trusted proxy configuration, strong secrets, live credential validation, and external security review.
