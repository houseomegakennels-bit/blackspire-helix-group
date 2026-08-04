# Runtime numeric configuration

Blackspire parses production operational integers through one fail-closed contract. An unset value
uses the reviewed default; an explicitly empty or non-canonical decimal, negative, below-production-
minimum, or above-ceiling value stops production startup before the API listens. Whitespace, signs,
leading zeroes, fractions, exponents, and alternate numeric bases are not accepted.

| Variable | Default | Production range | Unit |
| --- | ---: | ---: | --- |
| `EVIDENCE_BUNDLE_MAX_BYTES` | 500000 | 10000–10000000 | UTF-8 bytes |
| `CLEANUP_INTERVAL_MS` | 900000 | 60000–3600000 | milliseconds |
| `TELEGRAM_FILE_MAX_BYTES` | 2000000 | 1024–20000000 | bytes |
| `TELEGRAM_INLINE_MAX_CHARS` | 3500 | 1–3900 | characters |
| `WORKER_POLL_MS` | 750 | 100–60000 | milliseconds |
| `APPROVAL_TTL_MS` | 1800000 | 60000–604800000 | milliseconds |
| `HERMES_TIMEOUT_MS` | 30000 | 1000–600000 | milliseconds |
| `TELEGRAM_OUTBOX_MAX_ATTEMPTS` | 3 | 1–20 | attempts |
| `TELEGRAM_OUTBOX_RETRY_SECONDS` | 30 | 1–3600 | seconds |
| `UNIFIED_TEST_TTL_MS` | 7200000 | 60000–14400000 | milliseconds (disposable test only) |

Credential-free tests may use smaller positive fixture sizes and intervals, and may use a zero-second
outbox retry to avoid wall-clock waits. Maxima are enforced in every environment. The evidence export
limit counts encoded UTF-8 bytes rather than JavaScript characters.

The iPhone launcher independently validates its port as an unreserved integer from 1024 through
65535 and refuses durable-runtime port 8787 before creating runtime state.

These controls tune bounded local behavior only. They do not enable live Telegram, external providers,
production routing, automatic memory promotion, database provisioning, or Gate 4.
