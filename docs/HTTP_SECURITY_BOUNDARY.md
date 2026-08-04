# HTTP security and timeout boundary

Status: repository implementation only. This change does not alter nginx, routing, firewall rules,
DNS, TLS, a live listener, or production state.

## Fixed server limits

`packages/shared/http-boundary.js` is the single source for the API listener contract. Limits are
compiled constants rather than environment overrides so a missing, malformed, or operator-supplied
value cannot silently disable them:

| Boundary | Limit |
| --- | ---: |
| Complete request | 30 seconds |
| Complete headers | 10 seconds |
| Inactive socket | 30 seconds |
| Keep-alive idle | 5 seconds |
| Connection-expiry scan | 1 second |
| Header bytes | 16 KiB |
| Header count | 100 |
| Requests per socket | 100 |
| JSON body | 1,000,000 bytes |

The inactivity handler destroys the timed-out socket. The request listener contains every promise
returned by the asynchronous router; a rejection is converted once into a sanitized response, or
destroys an already-started response rather than producing a second header block. Oversized JSON is
typed as HTTP 413, malformed JSON as 400, and neither is logged with body content.

The JSON reader counts bytes, not JavaScript characters. After the bound is crossed it stops
appending data and drains the request, preventing a rejected request from continuing to grow an
in-memory string. Request aborts and stream errors also settle the reader once.

## Relationship to other controls

These limits complement rather than replace nginx timeouts, endpoint/IP rate limits, authentication,
CSRF, maximum field lengths, task/provider deadlines, circuit breakers, and emergency stop. The
current SQLite-backed rate limiter is atomic and durable across processes sharing the one production
database, but it is suitable only for the documented single-host topology. A future multi-host
topology requires a genuinely shared limiter and is an architectural decision.

Rate-limit overrides are optional and fail closed in production. `LOGIN_RATE_LIMIT` accepts 1–100
(default 5); `TASK_RATE_LIMIT` accepts 1–1000 (default 20); and `TELEGRAM_RATE_LIMIT` accepts 1–1000
(default 30). Each is a per-minute integer. Zero, fractions, non-numeric values, and values above the
reviewed ceiling stop production startup instead of disabling or weakening the control. The limiter
primitive independently rejects empty/oversized bucket keys, non-positive limits, and windows above
24 hours so a future caller cannot silently bypass the startup contract.

Before production authorization, exercise slow headers, slow/oversized bodies, keep-alive expiry,
socket reuse exhaustion, malformed JSON, and graceful draining through the approved reverse proxy.
Confirm the proxy timeout envelope does not outlive the application boundary in a way that retains
orphaned upstream work.
