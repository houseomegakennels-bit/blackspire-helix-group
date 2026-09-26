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
