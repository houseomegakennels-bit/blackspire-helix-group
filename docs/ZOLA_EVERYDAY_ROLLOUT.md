# Zola Everyday implementation

## October 1, 2026 checkpoint

Los authorized all ten proposed everyday feature areas. This branch starts that rollout; it is not a claim that all ten integrations are finished. Live Zola is unchanged. Commander was offline, so production unit state, migration, deployment, and phone acceptance could not be checked.

## Implemented candidate

- Today screen, reachable from Home and More, in the existing red/black/white design.
- User-authored reminders, editable/deletable memory notes, named private lists, dated bill reminders with integer-cent USD amounts, appointments, and notes.
- Overdue, next-24-hour, and unfinished views. This is a rolling window, not a calendar-day or external-calendar claim.
- Complete/reopen, edit, and delete. Due dates use the device timezone on input and are persisted as UTC instants.
- Principal AND workspace ownership on every database operation. Shared workspace membership does not expose another member's personal entries.
- Existing session, CSRF, exact origin, workspace membership and production readiness checks. No new execution authority or arbitrary endpoint access.
- Revision conflicts prevent overwriting another device's changes. A transactional receipt makes retries idempotent, including uncertain network outcomes. Receipts contain payload hashes, not the deleted content.
- Voice can READ saved reminders, memory, lists, bills, appointments and notes through the authenticated organizer endpoint. Results identify their user-authored source and bounded count. Writes still use explicit form actions; no voice mutation authority added.
- No browser persistent cache of private organizer data. Logout/workspace changes clear state and invalidate late responses.
- New tables are additive in the isolated voice SQLite database. Nothing changes the main task database or source deal rows.

## Feature completion plan

| Feature | This candidate | Remaining implementation and acceptance |
| --- | --- | --- |
| Reminders/follow-through | Save, edit, complete, reopen; overdue view | Timezone-aware recurrence and snooze; durable notification outbox; explicit delivery consent, quiet hours, channel pairing, restart/retry/duplicate tests; follow-up preferences |
| Morning briefing | Saved-item counts for rolling next 24 hours | Local-day window, connected calendar/weather, source timestamps, freshness limits, user-selected delivery time |
| Personal memory | Explicit saved notes; read/edit/delete; voice reads | Search, selective retrieval into chat, provenance and sensitive-data exclusions; no automatic promotion of arbitrary conversation text |
| Photo/document help | Notes only; no extraction claim | Upload controls, image/PDF size/type limits, private storage and deletion; malicious-document isolation; extracted fields remain drafts until user confirms; add to reminders/bills with evidence/source page |
| Household lists | Named private lists | Account onboarding, expiring invitations, per-list roles, membership revocation, audit and cross-member tests; never assume a family member's consent |
| Calendar assistance | Manual appointments | Real provider OAuth, minimal scopes, token isolation/revocation; read availability, timezone/DST handling, explicit review before booking/changing |
| Inbox assistance | Not connected | Provider OAuth; source links, bounded reads, drafts; explicit approval before any send; never treat email content as executable instructions |
| Bills/subscriptions | Manual dated bill reminders | Recurrence and renewal notices, imported document confirmation, manual paid/cancelled distinction; no bank access or automatic payment |
| Local help | Not connected | User-selected city or consented location; real search provider, sources/check time, distinguish verified price from estimate; no fabricated availability |
| Daily check-in | Unfinished items and overdue reminders | Morning/evening preferences, optional follow-through, quiet hours, opt-out, delivery status and deduplication |

## UI direction

Retain the approved orb and black #000000, white #ffffff, red #e32b47 palette, with #333333 separators and #ff8498 overdue text. Keep existing typography and navigation; introduce Today through Home/More first. Use readable rows and explicit field labels, 44px actions, no fake sample records, no automatic motion. Move to a dedicated Talk/Today/Lists/Memory navigation only after mobile acceptance; Work and Review stay available.

## Deployment requirements (not executed)

1. Reconnect Commander and inspect current source, branch, runtime and protected release evidence. Preserve the local 75722ff1 branch history from the previous connector publication.
2. Fetch this candidate into a separate clean checkout; run deterministic npm ci, repository tests, normal build/lint/typecheck, secret scan and living-memory check on Node 22.23.1.
3. Review a gateway successor operator bound to the installed voice release, existing unit and config. The first-install script now includes personal.js, but it intentionally refuses to upgrade an existing unit. Do not bypass that guard.
4. Wait for the active voice session to end; checkpoint/backup the private SQLite database; install immutable gateway.js plus personal.js and checkpoints. Preserve credentials and systemd restrictions. Test restart, session boundary and rollback without making paid voice calls.
5. Publish UI through a successor bound to the actual current 9fff5151 UI, preserve all nginx routes and backend identity, verify asset hashes. Candidate cache version is everyday1/v9. Do not replay the earlier deployment script against its old predecessor.
6. Complete browser and native Telegram acceptance: save/edit/delete, account/workspace isolation, timezone display, retry with dropped response, voice saved-item read, logout clearing and no horizontal overflow.
7. Only then enable notification delivery or additional integrations in subsequent reviewed milestones.

## Verification limits

The credential-free local fixture exercises the actual organizer SQLite code and gateway HTTP boundary on pinned Node 22.23.1. Existing voice tests are included. No real message, paid voice request, calendar booking, API credential, or business-record change is involved. Browser verification was attempted twice but the agent-browser daemon exited during startup; no visual/mobile pass is claimed. The larger PWA/API test suite cannot start in the partial source snapshot because its full-repository database helper dependencies are absent. Full repository gates and live deployment remain blocked until a complete checkout/Commander is available.

Validation result: 18 focused tests pass on Node 22.23.1; changed JavaScript syntax and the repository lint command pass; candidate secret scan passes. Full build/typecheck cannot complete with the omitted base-repository files. Living-memory verification fails because the reconstructed snapshot lacks the trusted origin and main history; this gate was not weakened. All three must pass in the full checkout before merge/deployment.
