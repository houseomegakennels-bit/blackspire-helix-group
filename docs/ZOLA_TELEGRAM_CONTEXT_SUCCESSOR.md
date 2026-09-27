# Zola Telegram and canonical context successor

## Prepared changes (not active in the sealed API)

- Root-only Telegram setup: scripts/stage-zola-telegram.py verifies the bot with getMe, refuses an existing webhook, and proves a private account using a fresh random pairing message. Credentials stay in root-only /var/lib/blackspire-operator/zola-telegram files. This stages only; it never activates polling, changes a webhook, restarts a service, or sends a message.
- ZOLA_CANONICAL_CONTEXT=true in a reviewed successor enables server-owned context. Unified Input extracts only currentMessage from the legacy client envelope and discards client history/instructions. Mutation envelopes are refused. All policy and dispatch checks see the actual current request.
- The provider receives bounded context from canonical database task records under the same workspace, actor, authority class, and channel, only for read-only tasks. Recent same-conversation records and relevant completed earlier conversations may be retrieved. Denied tasks and future records are excluded. No migration, memory-candidate promotion, or new grant is performed.
- Existing mutation UI requests now send explicit current text, without a conversation envelope.

## Activation requirements

Do not edit /opt/blackspire-command/current or replay the consumed September 24 release. Its artifact, admission, API/worker generation, store manifest and writer attestation are bound.

A new reviewed release must include these modules and the Telegram configuration, with fresh configuration digests, generation bindings, rollback verification and OPEN readiness. The existing password-maintenance operator authorizes verifier-only changes and MUST NOT be repurposed for this feature/configuration release. Before activation, verify both API and worker load the same context flag, prove end-to-end provider context, configure the webhook secret, privately install the paired bot token and allowlist, and verify private-chat inbound/outbound delivery. No credentials belong in git or chat.

Paid voice remains deferred. Harvester, Recon, Sentinel, Social OS and Book Studio are not registered in the current capability registry; typed adapters, authoritative source endpoints and capability grants remain implementation work. Existing business read acceptance must be preserved, not rerun using consumed permits.

## Operator setup

Run the installed root-owned helper in Termius:

    python3 /opt/blackspire-command/shared/stage-zola-telegram.py

Paste the BotFather token into the hidden prompt. Confirm the displayed bot identity. Send the displayed pairing message to that bot from your own private account, then return and press Enter. If interrupted after staging, run the same command with --pair. It refuses replacement of an existing paired identity.

The helper reports STAGED_NOT_ACTIVE. Do not claim Telegram is connected until a later admitted activation and real delivery proof succeed.

## September 27 verification

Private pairing is verified for BlackspireZolaBot, with root-only credential storage and one private owner. The paired status remains STAGED_NOT_ACTIVE. Candidate transport repairs require TELEGRAM_PRIVATE_CHAT_ID to equal both the private chat and sender, with is_bot=false; production refuses unpaired updates. Delivery rejects HTTP/API failures; webhook failures return 503, identical updates reuse a bounded cached reply, and canonical task idempotency remains in force. In-memory reply caching is not a durable exactly-once delivery guarantee; Telegram may deliver a repeated reply after an uncertain network outcome. Failed document sends retain their file. Forty-four targeted tests pass.

Activation configuration must privately install TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_USERS, TELEGRAM_PRIVATE_CHAT_ID, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_MODE=webhook for the API and worker, alongside ZOLA_CANONICAL_CONTEXT=true after provider-packet verification. Do not enable bearer administrator authentication for Telegram convenience. Existing /workspaces, /export, /logs and /task_status HTTP helpers require separate compatibility review with production session-only authentication before advertising them as operational.

Release blocker: historical owned-successor activation/configuration encodes an older retired predecessor, while the present predecessor is a completed OPEN release with later password-maintenance generations. Implement a distinct reviewed successor transition that validates that actual lineage; do not edit historical authority constants to force the old operator through.

## Latest predecessor after outage recovery

September 27 storage exhaustion stopped API and worker independently of Telegram work. Same-artifact recovery completed at /var/lib/blackspire-operator/storage-outage-recovery-20260927 and renewed generation bindings; both local and public readiness return 200 with all nine checks true. Any future feature-release transition must validate that retained recovery result against current admission. Do not directly reuse the now-superseded password-maintenance generation state. Root free space remains approximately 1.1 GB. Telegram remains STAGED_NOT_ACTIVE.
