# BLACKSPIRE_COMMAND_SECURITY_REPORT

## Verified Local Controls
- SQLite-backed sessions persist across API restarts and support creation, lookup, rotation, logout, revoke-all, expiration, revoked-before enforcement, and bounded cleanup.
- Persistent SQLite-backed rate limits exist for API/login/Telegram-style scopes and survive process restart because counters are stored in `rate_limits`.
- Session cookies are HttpOnly, SameSite=Strict, path-scoped, expiring cookies; CSRF cookies are readable by the PWA and state-changing requests require `x-csrf-token` for session-authenticated calls.
- API bearer fallback remains development-only (`NODE_ENV !== production`) and is documented as an operator fallback, not production browser auth.
- Trusted proxy handling ignores `x-forwarded-for` unless `TRUST_PROXY=true`.
- Workspace command execution is allowlist-based and path-confined.
- Evidence exports and command/provider errors pass through redaction helpers.
- Secret scan and `npm audit --audit-level=high` pass in the final validation run.

## Not Internet-Ready Yet
- Live Telegram webhook mode is not implemented.
- Live Telegram attachment and voice workflows are mocked/local only.
- Production deployment still needs HTTPS, trusted proxy configuration, strong `SESSION_SECRET`, strong `COMMAND_ADMIN_TOKEN`, external security review, and browser E2E coverage.
