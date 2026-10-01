# Customer-owned Zola distribution — foundation
2026-10-01. This is a setup preparation tool, not a runnable installer.

Run with Node 22.23.1:
```sh
node scripts/init-zola-customer.mjs --directory /customer-owned-parent/new-installation --origin https://customer.example --provider openai
```

The parent must already exist and be private/customer-owned. The destination must not exist. Initialization creates a unique installation ID, mode-0700 data/secrets/backups directories and mode-0600 configuration files. It neither reads environment credentials nor copies production files. All external integrations start disabled. There are no API calls, purchases, service changes or production writes.

The manifest is explicitly prepared_not_runnable. It records no-fallback and no-auto-refill requirements; these flags are not yet runtime enforcement. The empty providers file is protected by filesystem permissions, not application encryption. Do not place live keys in it until the runtime secret-storage adapter is reviewed.

## Code dependency inventory
- scripts/install-zola-voice.mjs hard-codes existing Blackspire service, paths and Node location.
- apps/voice/gateway.js reads OPENAI_API_KEY and defaults to /var/lib/blackspire-voice.
- apps/worker/worker.js uses process environment for worker identity and Telegram delivery.
- Existing task execution/provider, release admission, workspace permissions, database/store and deployment-generation controls must be preserved, not bypassed.
- Current voice project-checkpoints contain owner-specific project context and must not enter customer distributions.
- Existing installer/source tree is not a distributable customer bundle: use an explicit artifact allowlist and secret/data scan before shipping.

## Remaining implementation
1. Bind runtime adapters to validated installation identity and customer-only scoped credentials; no ambient/personal Codex auth fallback.
2. Replace owner-specific context, paths, IDs, domains and bot configuration with explicit setup values.
3. Provide API-backed customer execution with existing permission/approval/emergency boundaries.
4. Add secure credential enrollment/encryption, Connect/Create/Skip UI and dependency status.
5. Add HTTPS/service installation, database migrations, rollback, consistent backup/restore and budget enforcement.
6. Prove two fresh installations cannot access each other's data/accounts and do not call Carlos-funded services.
7. Package and benchmark clean-host installation; only then advertise plug-and-play.

Validation: focused initializer tests cover separation, disabled integrations, environment non-import, permissions, collision/symlink refusal and unsafe-origin rejection. This does not certify complete runtime isolation. Production deployment is unchanged.

## Provider choice
Setup accepts openai (ChatGPT model family), anthropic (Claude) or none (skip). Selection is saved with needs_credentials/skipped status and never enables cloud AI automatically. No cross-provider fallback is permitted by the setup manifest. These are API integrations, not a connector to consumer chat subscriptions. Actual provider execution adapters, model selection, switching, per-provider metering and connection tests remain required. Voice is a separate capability: selecting Claude for text must not silently activate OpenAI-paid voice. A customer must separately connect and enable a compatible voice provider.

## Configuration reader
Run `node scripts/customer-status.mjs --directory /customer-installation` to inspect safe setup status. The reader rejects mismatched installation IDs, unsafe permissions/ownership, and symlink or hardlink credential files. It never searches environment variables. Configured credentials are unverified and runtimeReady stays false. Provider selection is currently a pure configuration operation; a persisted settings UI and runtime adapter remain pending. Sixteen focused tests pass; no paid provider calls were made.
