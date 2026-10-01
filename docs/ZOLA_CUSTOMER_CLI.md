# Zola customer-owned text runtime — developer preview

This bundle runs a local, text-only Zola assistant against the customer's OpenAI or Anthropic API account. It is not the complete Zola OS installer. It does not connect the existing web/Telegram UI, voice, organizer, social accounts, workplace tools or production worker. The existing Blackspire production gates are unchanged.

## Requirements
Linux, Node.js 22.23.1 and a private directory owned by the account running the commands. No npm packages are required. Run each customer's installation under its own OS account/host. Same-user code and root can access local files; this is not isolation against a compromised host.

## Prepare and connect
Run from the bundle directory:

```sh
node scripts/init-zola-customer.mjs --directory /your/private/new-zola --origin https://your-domain.example --provider openai
node scripts/configure-customer-ai.mjs --directory /your/private/new-zola
node scripts/customer-ai.mjs status --directory /your/private/new-zola
```

Choose `anthropic` for Claude, or `none` in the initializer to skip cloud AI. The private terminal wizard collects the customer-owned key without echoing it or putting it in command arguments. It also asks for exact model, current input/output prices, request limit and monthly application budget. It makes no paid connection test. The configured CLI becomes enabled only after explicit billing consent. A chat subscription is not imported by this tool.

For scripted setup, `customer-ai.mjs configure --directory ...` reads `{ "apiKey": ..., "policy": ... }` from standard input. Use a private secret manager or protected input stream; never put a key on the command line or in committed files. Interactive setup is preferred.

Send text as JSON through stdin (the key never appears here):

```sh
printf '%s' '{"requestId":"customer-request-0001","prompt":"Help me plan tomorrow"}' | node scripts/customer-ai.mjs chat --directory /your/private/new-zola
node scripts/customer-ai.mjs pause --directory /your/private/new-zola
```

Use a fresh request ID for a new question. Reusing a completed request ID with unchanged request/configuration returns the saved answer without another API request. An uncertain request cannot be retried automatically. Changing provider/model/configuration requires a new request ID and preserves the installation's cumulative monthly reservations. Setup changes must be made while no requests are running; pause prevents new dispatch, but does not cancel already-dispatched remote work.

## Credential boundary
Keys are encrypted using AES-256-GCM with installation/provider binding. The master key is stored separately in the same private installation directory. This protects against accidental plaintext inclusion/disclosure, not a host or owner-account compromise. Runtime keys are read only from this vault; no environment keys, personal CLI sessions, alternate provider or Carlos account fallback is used. No custom API endpoint is accepted; redirects are rejected. Response errors are generic, and an exact key echoed in a response is redacted before storage.

The earlier `customer-status.mjs` checks the prepared base manifest and remains conservative; `customer-ai.mjs status` reports this separate CLI policy and spending ledger. Neither status command claims successful live authentication.

## Spending controls and limits
Amounts are integer micro-US dollars (1 USD = 1,000,000 units). SQLite reserves a conservative request allowance before network dispatch using configured text prices, UTF-8 input bytes plus 4,096 overhead tokens and maximum output tokens. Concurrency uses a transactional reservation. The entire allowance remains charged to the application budget after success; reported token costs are shown separately. There is no automatic refill or budget refund. The month is UTC.

Pricing must be checked for the exact model and expires after at most seven days. These application controls use customer-supplied rates and conservative token assumptions; they are not a guarantee of the provider's final invoice. Provider billing changes, unsupported billable dimensions and actual usage can differ. Usage over the reserved allowance halts future calls for review. Set provider-side controls too, where available.

Timeouts, invalid/incomplete responses, redirects, errors and missing usage retain the reservation and block further calls pending review. Prior-month pending work blocks month rollover. There is intentionally no automatic ledger reset or reconciliation override. Paid-request review, recovery tooling and invoice reconciliation remain to implement. Do not delete the ledger to unblock a request.

## Packaging
The packaging command copies only twelve approved code/document/package files and emits content digests. It never copies `.env` files, production configuration, provider sessions, project checkpoints, repository history or customer databases. A checksum manifest detects accidental changes; it is not a cryptographic release signature. Preserve the bundle's provenance.

## Not yet production-ready
Live provider acceptance has not been run. Full customer onboarding UI, web authentication, workspace/tool authorization integration, production admission, service/HTTPS installation, backup/restore, signed updates, automatic pricing refresh and customer support recovery remain required. The full system must not be marketed as plug-and-play based on this CLI preview.

API references checked 2026-10-01:
- https://developers.openai.com/api/docs/guides/text
- https://platform.claude.com/docs/en/api/messages/create
