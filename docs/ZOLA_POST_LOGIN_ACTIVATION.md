# ZOLA post-login activation continuation — 2026-09-06

## Exact checkout and provider

Recovered clean local/remote/PR #125 head `8d1582073e0c7ccc33e690db9fbde4e96b3ad88f`, branch `release/zola-production-live`; main remains `53adf74e05c607c0d296923bae05d7ac023ecb57`. Fresh GitHub inspection finds PR OPEN/MERGEABLE, all five checks successful, exact-head CI `34000610958` successful. No application change was required.

API PROVIDER ACCESS: HEALTHY. WORKER PROVIDER ACCESS: HEALTHY. The protected login replaced the credentials. Both identities pass the exact contained authenticated provider probe and complete production environment verification under Node 22.23.1. Required credential, provider-reachability and WebSocket checks pass; the broader doctor exit reports unrelated installation/update checks. No generation, refresh loop, failover or credential disclosure was used.

Both reviewed identities and installed units match; the API can read its password/session profile and the worker cannot. Shared configuration contains no API authentication secrets. All eight division caller settings and six minimum permissions remain present. Canonical authority history and SQLite integrity pass. The protected 00:03:35 UTC backup passes checksum, integrity, freshness and schema verification. Canonical services remain inactive/disabled with PID zero and the forbidden retained `608b10` pointer is unchanged.

All four canonical division caller URLs still target public main. Receiver credential/workspace pairing was established, but main lacks the current Buyer receiver and safe complete six-read composition. Any controlled acceptance must explicitly pair the exact candidate frontend; pairing alone is not functional readiness.

## Recovery target reset

RECOMMENDED TARGET / EXACT BASE: `2c0b600c268faa0571f08322e16d7f81f37789be`.
EXACT DELTA: ZERO source changes. Use the existing immutable VPS packaging and complete same-SHA frontend. Current release head differs only in five documentation files. The nine-file proposal is rejected and was not reused.

Concrete artifact: `/opt/blackspire-command/releases/2c0b600c268faa0571f08322e16d7f81f37789be`.
Artifact digest: `0028052a7d08b1e7e73b8ce8cd441f90d10f16b288e10d10416891b5598f58bd`.
All 190 packaged source files independently match the exact Git archive; no unexpected files. Normal immutable preflight passes. Actual candidate authorization modules accept the protected copied history, principal and all twelve permissions without history mutation. No canonical activation record was invented.

Independent security review passes 57 tests covering cancellation, timeout, Buyer ownership, route authorization and adversarial authority. Fresh root and frontend dependency audits report zero vulnerabilities. An additional 99 disposable composition tests pass, covering actual launcher/drain behavior, generation fencing, release identity and simulated recovery. These tests used sanitized environments, no production credentials, and natural process exit. They do not substitute for production-mode boots or six real reads. Existing full release validation remains applicable because application source is unchanged.

This same-implementation recovery target can recover artifact/configuration failures after verification; it cannot reverse a source defect shared with the current release. No known historic independent runtime qualifies. Retained `608b10`/`b71` reject authority history; main and the rejected patch compositions fail required safety/read behavior. This is a prepared candidate, not an accepted functional rollback.

FUNCTIONALLY VERIFIED: NO. SIX REAL READS: NOT RUN. Production security migrations remain an independent gate despite zero dependency advisories.

## Six-read acceptance

Use the authenticated API session resolved to the canonical operator, explicit `executionIntent: read_only`, exact canonical workspace and a unique idempotency key through `POST /api/tasks`, then the real worker and division adapter. Do not supply a principal or substitute direct receiver requests. Inspect persisted task, attempt, selection, dispatch, result and finalization evidence and bound polling/results. Run Deal Records before the ID-dependent reads to obtain a real persisted ID.

| Read | Request | Required permission | Internal receiver |
| --- | --- | --- | --- |
| Seller | Show seller opportunities | seller.opportunities.read | seller-opportunities |
| Buyer Profiles | Show buyer profiles | buyer.profiles.read | buyer-profiles |
| Buyer Matches | Buyer matches for an actual DE-NNNN | buyer.matches.read | buyer-profiles, matchesOnly and exact opportunityId |
| Deal Records | List active deals | deal.records.read | deal-records |
| Deal Analysis | Deal analysis for the actual DE-NNNN | deal.analysis.read | deal-analysis, exact dealId |
| Nexus Status | Nexus contact status for the actual DE-NNNN | nexus.enrichment.read | nexus-enrichment, exact dealId |

Collection dispatch bounds are five; transport response bound is 32 KiB. Analysis/status target one persisted entity. Missing-ID Buyer Matches may return an immediate empty result without a real database read, so that is not acceptance. Verify exact frontend/runtime identity, workspace, server-resolved principal, current permission, transport and bounded response for every row. Negative owner/workspace tests need an actually unauthorized witness: the canonical principal has a separate disposable-workspace grant, so that workspace is not automatically a valid denial case.

Expected task/evidence writes are distinct from unintended division mutations. Establish authoritative before/after data or correlated query/audit evidence for relevant Seller, Buyer, Deal and Nexus tables. Empty changedFiles alone cannot establish database nonmutation. Nexus requires correlated evidence of zero paid provider calls and zero enrichment mutations; zero activity because no read ran is not acceptance. Do not invoke n8n, outreach or enrichment. Live cross-owner proof remains UNVERIFIED until suitable authenticated witnesses and data are available.

## External gates

At 00:34:38 UTC authenticated canonical Supabase Auth still returns HTTP 402 `exceed_storage_size_quota`; public `/api/auth/status` returns HTTP 500/upstream 402. Control-plane ACTIVE_HEALTHY does not establish Auth health. Project recovery is still unverified; SQLite backups do not cover Supabase. No workaround or migration was applied.

The historical n8n management endpoint still returns HTTP 404, “No workspace here”. Actual active Buyer workflow, writer credentials, executions, protected rollback version and authorized server-identity replacement remain unverified. No management connector or newly supplied access was found. No webhook was invoked.

Required owner actions:

1. Resolve the canonical Supabase organization storage quota and securely supply a verifiable recovery point or database access for dump/checksum/disposable restore proof.
2. Identify the current Buyer n8n management workspace/workflow or authoritative successor and grant access to inspect the active writer, executions and protected version, and authorize server identity replacement where needed.

After access recovery: recheck authenticated Auth and public auth status, prove database recovery, reconcile the current n8n writer, then resume only the reviewed Buyer/Nexus security migration gate. Application rollback must retain tightened browser policies. PR #125 remains unmerged until provider, canonical API/worker, six reads, Supabase, n8n, security migrations, functional recovery and final validation all pass.

## Controlled production-mode boot rehearsal

Actual isolated production-mode API/worker boot: PASS. This was not a mock fixture and used the unchanged exact candidate runtime under the reviewed non-root API/worker identities, with protected credentials confined to a persistent production-mode rehearsal root at `/var/lib/blackspire-zola-rehearsal`. Separate profiles, private provider home, credential-free workspace clone, copied database, immutable artifact and truthful separate deployment record were prepared. Canonical state/configuration/backups were inaccessible to the service sandboxes; only rehearsal shared state was writable. Port 8790 was loopback-only and absent from nginx configuration. No task or capability endpoint was invoked; division URLs therefore remain an explicit future acceptance gate.

All nine copied tasks were terminal. The 42 queued subtasks were fenced to cancelled, copied browser sessions revoked, all persisted workspace roots remapped to isolated paths and outcome_unknown preserved without replay. The configured execution checkout was an exact clone; other remapped workspace directories were containment placeholders, not proof of executable workspace acceptance. Emergency stop remained active throughout, preventing claims and delivery. The API profile used an independent session secret; worker access to API credentials remained denied. Canonical provider credentials were unchanged.

Parent executed API -> health -> worker -> reviewed generation-fenced readiness -> worker stop -> readiness rejection -> API stop. Before worker startup, API health correctly reported a missing worker instead of false overall health. After worker startup, all six readiness checks passed and deployment identity verified production, exact SHA and artifact digest. Readiness matched the real worker systemd InvocationID. The gate rejected the stopped worker afterward; no unobserved stale-heartbeat timing race is claimed.

Protected result: `/var/lib/blackspire-zola-rehearsal/operator/boot-result.json`. Both rehearsal services are inactive with PID zero and empty cgroups. The listener is absent and a reusable bind succeeds. Canonical service state, retained pointer, database and protected configuration/provider-file fingerprints remained unchanged. Copied task/subtask/provider-attempt/delivery/authority/session rows were unchanged during the boot. Only expected isolated runtime observability writes occurred. No generation, enrichment, outreach, migration or public activation was performed.

This closes isolated production-mode startup and generation-gate evidence only. Canonical API and worker remain BLOCKED/inactive. Six real reads remain NOT RUN; functional rollback remains NO. The protected rehearsal and operational helper evidence are retained without enabling services. All currently accessible autonomous checks/preparation are complete; remaining work depends on the external quota/recovery and current n8n access actions above.


## 2026-09-06 — Final gate continuation; exact acceptance pairing prepared

Recovered clean expected release/PR head `464f05fde73f7a213d6d833b581ef89071a098b2`; remote main remains `53adf74e05c607c0d296923bae05d7ac023ecb57`. Parent and independent review confirm PR #125 OPEN with all five checks successful and exact-head CI `34002197446` successful. No application source changes, new PR, merge or canonical activation occurred.

The isolated production recovery profile now explicitly pairs all four division transports to the existing frontend deployment at exact `2c0b600c268faa0571f08322e16d7f81f37789be`. The prior profile is privately preserved; parent verified only the four URL keys changed and canonical protected fingerprints remain unchanged. Inherited boot/generation proof remains PASS; this newly paired profile has not executed the six reads. Functional rollback remains NO. Canonical API/worker remain inactive/disabled/PID0 with the forbidden retained pointer unchanged.

Fresh authenticated Supabase at 08:10:07 UTC still returns 402 `exceed_storage_size_quota`; public Auth returns 500/upstream 402, independently confirmed by parent. Current n8n management remains unavailable, with historical endpoint 404 and no successor/access found. Current writer, execution history, protected version and replacement identity remain UNVERIFIED. Owner quota/recovery and actual n8n management access remain required. Six reads remain NOT RUN; security migrations and merge stay held. Detailed continuation and local evidence paths are recorded in `/tmp/zola-astra-activation-current.md`.
