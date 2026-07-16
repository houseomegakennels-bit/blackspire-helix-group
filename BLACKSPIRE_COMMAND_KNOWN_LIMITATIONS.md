# BLACKSPIRE_COMMAND_KNOWN_LIMITATIONS

- The foundation is credential-free and locally proven, but not production-ready for internet exposure.
- Live Telegram polling/sending requires `TELEGRAM_BOT_TOKEN`; webhook mode is still missing.
- Telegram attachment, document, and voice-note workflows are tested with mocked Telegram HTTP responses only.
- Live GitHub draft PR creation requires `GITHUB_TOKEN` and authenticated `gh`; otherwise Hermes produces a manual PR packet.
- OpenAI, Anthropic, Codex, and Claude Code adapters contain callable code paths, but live execution requires credentials or installed/authenticated CLIs.
- Jarvis uses session-cookie login and CSRF locally, but still needs full browser E2E and external security review before public deployment.
- Rate limits and sessions are SQLite-backed for single-host deployment; multi-host production would need a shared store or database upgrade.
