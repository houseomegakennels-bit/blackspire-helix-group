# BLACKSPIRE_COMMAND_NEXT_STEPS

1. Configure the operator-chosen password hash using `docs/JARVIS_PASSWORD_AUTHENTICATION.md`; configure a separate `COMMAND_ADMIN_TOKEN` only for an independently authorized bearer client.
2. Wire Telegram webhook transport to `handleTelegramUpdate`.
3. Add real GitHub App installation flow and draft PR creation using least privilege.
4. Add provider-specific API calls behind existing interfaces.
5. Add push notifications and richer streaming responses for Jarvis.
6. Add scheduled encrypted backups and incident bundle export download.
