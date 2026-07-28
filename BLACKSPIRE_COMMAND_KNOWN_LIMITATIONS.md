# BLACKSPIRE_COMMAND_KNOWN_LIMITATIONS

## From the original foundation
- Live Telegram network polling/webhook transport needs `TELEGRAM_BOT_TOKEN`; command handler is implemented and tested locally, and now also covers file/voice attachments against a mocked Telegram HTTP API (see below) — the real network path is still unverified.
- Live GitHub branch/PR operations require credentials and are represented by safe mocks in the foundation test suite.
- OpenAI, Anthropic, Codex, and Claude Code run in detected modes only when credentials or CLIs are configured.
- Jarvis speech-to-text depends on browser support (`SpeechRecognition`) and falls back with a clear adapter-unavailable message; voice notes sent through Telegram instead go through the server-side transcription adapter described below.

## Added or discovered during the final merge-readiness pass

- **`packages/task-engine/db.js` now uses Node's built-in `node:sqlite` instead of shelling out to the
  `sqlite3` CLI.** The CLI binary was not installed in this environment and could not be installed (no apt
  package access), so the project could not run at all before this change. `node:sqlite` is flagged
  experimental by Node itself (a warning prints on every process start); it requires Node 22.5+ (this
  project now requires Node 20+ generally, but the SQLite backend specifically needs 22.5+ — pin your
  runtime accordingly). If a future Node upgrade changes `node:sqlite`'s behavior, `packages/task-engine/db.js`
  is the single place that would need to change.
- **SQLite is a single-host store.** Sessions, rate limits, tasks, and approvals are now all durable and
  restart-proof (a real improvement over the previous in-memory session/rate-limit state), but a
  multi-host/horizontally-scaled deployment still needs either a shared network volume for the SQLite file
  or a future migration to a networked database. This was true before this pass too; it is called out
  explicitly now because sessions and rate limits are new SQLite consumers.
- **Live Telegram file/voice transport is unverified.** `getFile`, file download, and `sendDocument` are
  implemented for real and exercised thoroughly against a mocked Telegram HTTP API
  (`tests/telegram-files.test.js`), but no request has ever reached the real `api.telegram.org` in this
  environment (no bot token was available). Treat it as **unverified, not broken** — the code path is real,
  only the live network round-trip is unconfirmed.
- **The transcription adapter's `http` mode is a generic contract, not a wired-up real service.** It posts
  audio bytes to `TRANSCRIPTION_HTTP_ENDPOINT` and expects `{ "text": "..." }` back; no specific speech-to-
  text vendor is integrated. `mock` mode is what the test suite and local dry-runs use.
- **Bearer-token auth is now off by default in production** (`ALLOW_BEARER_AUTH` must be explicitly set to
  `true`). This is a deliberate hardening change, but it means the Telegram bridge (which authenticates to
  the API via bearer token, not a browser session) will get `401` in production until an operator sets
  `ALLOW_BEARER_AUTH=true` — this is documented in `BLACKSPIRE_COMMAND_SETUP_FROM_IPHONE.md` and must not be
  missed during a production rollout.
- **Distributed rate limiting/session storage** still assumes one SQLite file on one host; there is no
  Redis/Postgres-backed alternative in this codebase yet.
- **TLS termination and reverse-proxy configuration are out of scope** for this repository; `TRUST_PROXY`
  only controls whether `X-Forwarded-For` is honored, it does not configure a proxy itself.

## Hermes Intelligence Layer (Milestone 1)

- **The Hermes orchestration + learning layer is at Milestone 1: foundation only, mock-only.** A new
  additive module `packages/hermes-orchestrator/` implements the vertical slice *task → normalize →
  classify → policy → mock route → mock execute → deterministic verify → event recording → memory
  candidate*. It is entirely separate from, and does not modify, the existing
  `packages/hermes/hermes.js` task pipeline. It performs no real provider execution, no shell, no
  network, and no Telegram/voice.
- **Only the credential-free mock provider can execute under Hermes M1.** Real providers (Codex,
  Claude Code, OpenAI-compatible) are declared-but-disabled in the registry and are refused by the
  executor; they arrive behind a development-only, allowlisted, budgeted profile in Milestone 2 —
  never in production and never with real keys at this stage.
- **Hermes "learning" is candidate extraction only — nothing is promoted.** Verified runs may
  produce a `hermes_memory_candidates` row with `status='pending'`; there is no promotion code path
  yet. Promotion is approval-gated and lands in Milestone 3. Candidates are never extracted from
  unverified or failed runs (anti–memory-poisoning), and raw audit history is kept separate from any
  future promoted long-term memory.
- **High-risk tasks are blocked, not queued.** Hermes M1 blocks a high-risk task pending approval but
  does not yet persist a live approval request through the `approvals` table; that wiring is
  Milestone 3.
