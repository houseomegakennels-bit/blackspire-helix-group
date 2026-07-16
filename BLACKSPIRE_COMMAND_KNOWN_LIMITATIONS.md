# BLACKSPIRE_COMMAND_KNOWN_LIMITATIONS

- Live Telegram network polling/webhook transport needs `TELEGRAM_BOT_TOKEN`; command handler is implemented and tested locally.
- Live GitHub branch/PR operations require credentials and are represented by safe mocks in the foundation test suite.
- OpenAI, Anthropic, Codex, and Claude Code run in detected modes only when credentials or CLIs are configured.
- SQLite is appropriate for version one; PostgreSQL should be added before multi-admin or high-concurrency production use.
- Jarvis speech-to-text depends on browser support and falls back with a clear adapter-unavailable message.
