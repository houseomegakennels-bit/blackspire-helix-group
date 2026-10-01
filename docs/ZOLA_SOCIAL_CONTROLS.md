# Zola social controls
## October 1, 2026
Requested by Carlos while the everyday assistant rollout was in progress.

## First implementation
Private social drafts are part of Today. Select Social draft when adding an item; select Social drafts to view the plan ordered by target date. Each draft stores a title, caption, intended platform, optional brand/account label and optional target date. Edit, archive, reopen and delete are available. The same authenticated principal/workspace isolation, CSRF/origin checks, revision checks and retry receipts apply.
A platform label is planning metadata, not a connected account. Target dates do not schedule publishing. Archive does not mean published. The server sets publication to not-connected and accepts no publish action. Voice may read saved drafts; it cannot approve, schedule or publish them.

## Remaining milestones
1. Dedicated Social screen: calendar/list views, brand filters, media drafts, accessibility and mobile preview. Current first version is under Today.
2. Account connections: user-selected platforms, verified account/page identity, platform-supported OAuth with minimum scopes, server-only credentials, expiry/revocation and per-workspace authorization. ChatGPT plugin connections are not automatically Zola connections.
3. Review queue: immutable preview of exact account, text, media, links and time; approval tied to content revision and account. Editing cancels prior approval.
4. Publishing: provider adapters, durable outbox, duplicate prevention, cancellation, quiet hours and restart recovery. Ambiguous outcomes require reconciliation before retry. Store returned post ID and URL; never infer success from a submitted request.
5. Performance: provider-reported metrics with timestamps, freshness and unavailable-data labels. No estimated numbers presented as observed metrics.
6. Comments/messages: bounded inbox reads and response drafts, explicit send approval, correct recipient/account verification. No automatic mass outreach.
7. Voice controls: authenticated read requests first; any future publish command opens a concrete approval preview.

## Open choices
Which platforms and which brands/accounts should connect first? No account identity, provider capability, paid plan, app-review approval or credential is assumed. Verify current official provider documentation before implementing each adapter. No external post or message has been sent by this feature.
