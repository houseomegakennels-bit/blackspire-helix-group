# Blackspire Environment Architecture

## Operating model

Blackspire has one planned canonical production-state owner: the durable VPS runtime. Its persistent task, conversation, event, evidence, delivery, and queue records must not be copied into development or preview environments.

| Environment | Purpose | State | Providers and channels | Availability role |
|---|---|---|---|---|
| VPS | durable runtime and future production owner | persistent storage selected explicitly by the operator | production modes only after separate approval | primary, independently supervised |
| Codespace | development, recovery, tests, private previews | disposable SQLite only | manual/mock; no automatically loaded credentials | never required for uptime |
| Quick Tunnel | temporary iPhone acceptance from the VPS | disposable SQLite under `/tmp` | mock Hermes and mock Telegram only | expiring test surface, never production |
| Vercel/public frontend | existing public web architecture | no Command SQLite ownership | independently configured | production surface remains separate |

Canonical state is committed before channel delivery. Delivery attempts live in the outbox, so a temporary mock or future channel failure does not rewrite task state.

## Repository contract

- Runtime baseline: Node.js 22.23.1 from `.node-version`; `package.json` permits verified compatible Node 22–24 releases.
- Dependencies: `npm ci --ignore-scripts` from the committed lockfile.
- Schema: `BLACKSPIRE_RUN_MIGRATIONS=true npm run db:migrate` governs every SQLite environment. API and worker startup never migrate; they require a compatible existing schema and fail closed when migration is required. Missing, false, or malformed migration permission values are denied.
- Development: `npm run bootstrap:development`.
- Disposable acceptance: `npm run start:iphone-test -- local`, `codespace`, or `quick-tunnel`.
- Production: `npm run start:production`, which validates an explicit production profile and starts without migrations. Back up and restore-test first, then run the dedicated migration command during an approved controlled writer outage.
- Gates: `npm test`, `npm run build`, `npm run lint`, `npm run typecheck`, `npm run security:scan`, and `git diff --check`.

There is no paid-provider fallback. Provider mode is explicit and defaults to credential-free `mock`; restricted test mode also requires `mock`. Production provider selection requires separate explicit configuration and authorization. Real Telegram is never started by the production wrapper and is forbidden in test profiles.
