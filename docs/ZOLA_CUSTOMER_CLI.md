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
The packaging command copies only seventeen approved code/document/package files and emits content digests. It never copies `.env` files, production configuration, provider sessions, project checkpoints, repository history or customer databases. A checksum manifest detects accidental changes; it is not a cryptographic release signature. Preserve the bundle's provenance.

## Not yet production-ready
Live provider acceptance has not been run. Full customer onboarding UI, web authentication, workspace/tool authorization integration, production admission, service/HTTPS installation, post-restore billing reconciliation/re-enablement, signed updates, automatic pricing refresh and customer support recovery remain required. The full system must not be marketed as plug-and-play based on this CLI preview.

API references checked 2026-10-01:
- https://developers.openai.com/api/docs/guides/text
- https://platform.claude.com/docs/en/api/messages/create


## Encrypted backup and held recovery

This backs up only the customer text CLI installation, not the complete Zola OS or remote provider accounts. Pause the installation first. Backup refuses enabled installations, unresolved reservations, in-flight requests and an existing output file. Configuration, requests and backups share an exclusive lock. Pause cannot interrupt a running request; wait for its receipt and retry pause. A crashed process leaves the lock in place: do not remove it until the process is confirmed stopped and its ledger outcome reviewed.

Use absolute paths in a private directory (mode 0700, owned by your account). These commands prompt for a passphrase without echoing it or placing it in shell history or process arguments. Python 3 is used only for the hidden prompt; the backup implementation runs in Node. Choose a unique passphrase of at least 16 characters and keep it separately. There is no password recovery.

```sh
node scripts/customer-ai.mjs pause --directory /your/private/new-zola
python3 -c 'import getpass,json; print(json.dumps({"passphrase":getpass.getpass("Backup passphrase: ")}))' | node scripts/customer-backup.mjs backup /your/private/new-zola /your/private/zola-backup.enc
python3 -c 'import getpass,json; print(json.dumps({"passphrase":getpass.getpass("Backup passphrase: ")}))' | node scripts/customer-backup.mjs restore /your/private/zola-backup.enc /your/private/restored-zola
```

The archive uses scrypt-derived AES-256-GCM encryption and contains the installation identity, both enrolled provider vaults, their master key, paused policy and a consistent SQLite spending/answer snapshot. Treat the archive and passphrase together as full credential access. Files and directories are restored privately. Other files are excluded by a fixed allowlist. Existing destinations are never overwritten; interrupted restorations may leave a held partial destination that must be reviewed, not reused blindly.

**A restore is deliberately not an activation.** It retains the original identity and receipts, disables paid execution, and creates a durable recovery hold. Neither chat nor normal configuration can bypass that hold. Restored history may be older than actual provider charges: retiring the original installation and reconciling later receipts/charges are required before admission can resume. Automated reconciliation and hold release are not implemented in this preview. Do not delete the hold or ledger to enable a restored copy. Archive creation leaves the original installation paused but does not permanently retire it. Store a verified backup off the original host; automatic upload and retention are not included.


## Reviewing status and recovery

```sh
node scripts/customer-ai.mjs status --directory /your/private/restored-zola
```

Status works with a recovery hold or expired pricing. It reports the configured provider/model, effective enabled flag, pricing freshness, hold timestamps, monthly reserved/observed amounts and up to 100 unresolved request IDs. It never decrypts keys, calls providers, returns prompts/answers or creates a missing ledger. The ledger is opened read-only and checked for identity/integrity. Review shares the maintenance lock, so wait for active requests to finish. A missing ledger is labeled `not_created`; amounts are local estimates, not reconciled provider invoices. `admissionVerified` remains false: this inspection is not a connectivity or permission test. Recovery guidance requires original-instance retirement and post-snapshot charge/receipt reconciliation; the report cannot clear the hold.


## Customer-owned account checklist

```sh
node scripts/customer-onboarding.mjs status --directory /your/private/new-zola
printf '%s' '{"module":"social","choice":"skip"}' | node scripts/customer-onboarding.mjs choose --directory /your/private/new-zola
```

Supported modules: `cloudAi`, `voice`, `telegram`, `social`. Choices: `connect`, `create`, `skip`. These are saved preferences only, not account creation, OAuth consent, purchases or runtime controls. Skipping does not revoke or pause an already-configured integration. Optional accounts may all be skipped. AI provider selection remains in the separate provider setup. The checklist never accepts API keys, imports Blackspire accounts or changes spending policy. Preferences persist in encrypted customer backups.

The report separates planned local core requirements from optional module accounts and identifies unfinished customer integrations. Core/selected/full cost totals remain `null` with `quote_required` until actual customer service choices and verified prices are available; unknown is not free. This is a CLI checklist ready for later UI integration, not a finished mobile onboarding wizard.
