# Exact nine-file recovery composition audit — 2026-09-06 UTC

VERDICT: REJECT exact proposed composition as a production rollback target. The118 earlier bounded passing tests prove selected capability closure only. Independent additional tests demonstrate omitted safety regressions and owner disclosure. No accepted target, repository modification, service/configuration/credential mutation, live request or real database write by this reviewer.

Audited proposal SHA256 d5954c65b757db5381551a121e24aaa21ab2512b76762d10abca3df73029ab66. Base53adf74e05c607c0d296923bae05d7ac023ecb57. Isolated source-only security fixture /tmp/zola-nine-file-security-audit-4tejn99q. Existing A/B and wider patch untouched.

## Every-file necessity

CAN REMOVE evaluates removing the entire file's proposed delta while retaining the requirement of six correct authority-dispatched reads with existing reviewed release semantics. None is a rollback mechanism; these are functional compatibility backports onto the approved older source. Some optional subhunks can be narrowed only by explicitly narrowing acceptance inputs, which does not address the security rejection below.

| FILE | WHY REQUIRED / EXACT DEFECT | ROLLBACK-ONLY NECESSITY | BEHAVIORAL CHANGE | CAN REMOVE |
|---|---|---|---|---|
| frontend/src/app/api/internal/capabilities/buyer-profiles/route.ts | Main has no Buyer receiver; both Buyer capabilities terminate in404. | Required only because rollback base predates receiver. | Adds authenticated exact-workspace bounded persisted profile/match receiver, canonical Deal lookup and read-only helper calls. | NO |
| frontend/src/lib/buyer-engine-server.ts | Receiver helper absent; main matching ignores storage errors and registry may seed on a read. | Runtime dependency of backported receiver, not recovery control. | Adds bounded persisted profile helper, exports its row type, opts matching/registry into read-only/error-denying mode while retaining UI defaults. | NO |
| packages/capabilities/http-adapters.js | Main drops Buyer match/filter intent and Nexus dealId; Deal404 collapsed to domain absence even for authorization denial. | VPS/frontend contract compatibility on rollback. | Forwards canonical payloads; Deal non2xx fails closed. | NO |
| frontend/src/app/api/internal/capabilities/deal-analysis/route.ts | Main invokes mutating UI detail path; no explicit absence shape. | Safe read requirement independent of rollback. | Calls persistScaffold:false and responds found:false/true. | NO |
| frontend/src/lib/deal-engine-server.ts | Main top100 lookup misses existing IDs; actual in-range detail invokes two mutation dependencies; failed persisted reads not denied. | Backport needed for read-only recovery acceptance. | Exact ID lookup, no scaffold/match writes in read mode, DB errors propagate, normal UI defaults retained. | NO |
| packages/capabilities/deal-analysis.js | Main output contract rejects new found field/absence shape; summary/count semantics mismatch. | Required dependency of receiver absence change. | Validates explicit found:false and normal found:true; absent Deal summary names requested ID. | NO |
| frontend/src/app/api/internal/capabilities/nexus-enrichment/route.ts | Main rejects dealId and cannot resolve canonical persisted Deal contact; absence may echo input as if stored. | Backport needed for authority Nexus dealId requests. | Bounded Deal-to-contact lookup; no invented persisted identity on miss. | NO |
| packages/capabilities/nexus-enrichment.js | Main capability input contract rejects dealId before adapter. | Required dependency of canonical Nexus dispatch. | Accepts/normalizes Deal ID while retaining bounded output. | NO |
| packages/capabilities/execute.js | Main never extracts Buyer opportunityId/Nexus dealId; Buyer phrasing and Nexus owner/address parsing fail existing behavioral tests; absent Deal counted as1. | Required at actual authority path, otherwise adapter-only tests are misleading. | Correct task routing/extraction/parsing and result count. Shared cancellation modifications deliberately omitted, causing rejection below. | NO |

Parser subhunks for owner/address and Buyer 'for deal' are not essential to a manually restricted dealId-only six-call fixture, but are required to preserve covered release user-request behavior. Removing them to make a smaller patch would need explicit input-scope downgrade. They do not solve public-safety omissions.

## Independently reproduced rejection findings

1. Shared execution cancellation barrier omitted. Actual nine-file execute.js against current tests/buyer-cancellation.test.js and tests/capability-hard-timeout.test.js:5 PASS3 FAIL. Failure1 cancellation in beforeAdapter produces unhandledRejection ABORTED; failure2 already-aborted external signal dispatches adapter once (expected0); failure3 abort queued before adapter microtask dispatches once (expected0). Not merely test-style changes: adapters execute after cancelled authority and a rejected promise becomes unobserved. Existing reviewed correction is within already-modified execute.js, but absent from exact patch.

2. Buyer report owner checks omitted. Actual stripped nine-file buyer-engine-server helpers with synthetic service-role query against current tests/buyer-endpoint-hardening.test.js selected 'Buyer report':1 PASS3 FAIL. Foreign-job read returns1 instead of0; pagination/count lack owner filter; anonymous helper returns2 instead of0. Source listBuyerReports/listAllBuyerReports lacks getAuthenticatedOperator and SearchJob!inner(user_id)/owner equality. Existing reviewed correction is within already-modified buyer-engine-server.ts, but absent from exact patch. RLS browser migrations do not fix server-role queries bypassing RLS.

3. Full-stack HTTP guards outside nine files omitted. Exact main+9 frontend /api/buyer-reports GET and /api/search-jobs GET lack guardSignedInApi; /api/deal-engine/save-analysis POST and /api/deal-engine/send-email POST lack guardAdminApi. Compared current release adds those guards before body/data handling. No frontend middleware/proxy gate found in source. The report helper disclosure therefore has an unguarded HTTP entrypoint in this composition when storage is healthy. No live exploit/production invocation performed; this is direct source plus real helper reproduction. Full security scope includes more routes than these examples; enumerate current tests/frontend-operator-auth.test.js before selecting any future target.

4. VPS Telegram fail-closed changes outside nine files omitted. Main apps/api/server.js accepts /telegram/webhook without checking mode/config and enforces secret only if configured; main config.js defaults allowed user1001 even in production. Current reviewed release guards webhook mode, secret, bot token and nonempty allowlist and defaults production allowlist empty. Configuration may reduce exposure, but exact composition cannot claim the reviewed fail-closed guarantee. No webhook invoked. Reproduce with current tests/hardening.test.js in a sanitized disposable runtime.

## Exact reproductions (no live credentials)

Working directory /tmp/zola-nine-file-security-audit-4tejn99q; all commands prefix env -i PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin:
node --test tests/buyer-cancellation.test.js tests/capability-hard-timeout.test.js
node --test --test-name-pattern='Buyer report' tests/buyer-endpoint-hardening.test.js
Outputs cancellation-review.txt and owner-report-review.txt retained there. Tests copied byte-for-byte from reviewed release, source exactmain+proposal; all databases disposable and adapters synthetic.

Recommendation: reject EXACT nine-file composition. Do not silently widen/replace it, and do not infer functional rollback from118tests or authorization-history compatibility. A revised proposal must include documented missing shared and full-stack safety dependencies or explicitly adopt a separately controlled recovery topology that cannot expose omitted routes; either requires separate concrete review, exact-source validation and real no-cutover rehearsal after external dependencies clear. No revised target selected here.

## Concrete next engineering direction: no approval request for unsafe nine-file target

Exact9 is rejected, not offered as an adoption choice. Continue autonomous evidence preparation on a corrected proposal only if authorized; preserve failed exact9 for audit.

VPS-only recovery with a separately retained, known-safe frontend: frontend files in nine are irrelevant to the VPS artifact; preserve the safe frontend at its exact SHA, then assess an immutable VPS candidate containing compatible authority history, all four relevant capability/dispatcher changes, cancellation barrier and Telegram fail-closed changes. Pin/test cross-version receiver contracts explicitly. This is a different topology and cannot meet the stated final frontend/VPS SAME SHA requirement; it needs an explicitly revised recovery policy, so do not silently label it the requested whole-stack rollback.

Whole-frontend-plus-VPS recovery under current same-version policy: prefer preparing the already fully reviewed release-derived source as a new immutable recovery candidate, with complete security guards, dependencies and cancellation behavior, instead of cherry-picking ever more pieces of main. Determine exact safe base/head and take a full final diff, trusted suite, frontend checks, browser-security migration compatibility and isolated authority/runtime rehearsal. No candidate should become an accepted rollback SHA until functionally proven against actual configuration and healthy external services. If a main-derived rollback remains mandatory, prepare a comprehensive documented backport dependency closure including all exposed route guards, provider/API behavior and relevant dependency security updates; narrow nine-file acceptance is insufficient.

The current request authorizes proving or rejecting this nine-file composition. It is rejected; do not ask the user to approve a known-unsafe target. Any later recovery source must preserve the required security properties and pass real runtime acceptance before adoption is proposed.

## Parent composition verification

On 2026-09-06, the parent created `/tmp/zola-nine-composition-1eqsr3sb/source` from an exact main53ad archive and applied only the recorded proposal. No release branch or application source was changed. Build subprocesses used an explicit environment without production credentials, pinned Node22.23.1 and deterministic frontend npm ci.

| Check | Result |
|---|---|
| Root lint, syntax typecheck and build | PASS |
| Frontend npm ci, ESLint, TypeScript and production build | PASS |
| Current cancellation regressions against exact composition | 5 pass / 3 fail; parent reproduced |
| Current Buyer report ownership regressions | 1 pass / 3 fail; parent reproduced |
| Current frontend authorization source-contract checks | 0 pass / 3 fail; parent reproduced |
| Frontend dependency audit | FAIL: 8 high, 2 moderate, 1 low |
| Current authority snapshot checksum, integrity, schema compatibility | PASS |
| Actual candidate authorization modules with current snapshot | PASS: history versions1/2 accepted, chain valid, principal resolved, all12 permissions allowed |
| API and worker production-mode boots | NOT PROVEN; rejected source and expired provider prohibit functional acceptance |
| Six real reads and live no-mutation proof | NOT RUN; external dependencies unhealthy and recovery source rejected |

Frontend high-severity packages reported by the isolated audit: adm-zip, brace-expansion, browserslist, js-yaml, nanoid, next, postcss and sharp. These are findings in the old-main-derived composition, not new regressions in the validated release branch.

Fresh protected backup: `/var/backups/blackspire-command/zola-nine-composition-20260906/command-20260906T000335Z.sqlite`; SHA256 `674fab68506ccfd8627917314e3ee38a52150103f9086e8446ab1b105238d46c`. The reviewed backup command opened canonical SQLite read-only. Verification used the candidate's actual schema checker and authorization modules with a read-only database adapter. This proves current schema/authority compatibility without applying migrations; it does not prove boot. Parent found nine copied tasks, all terminal; any future rehearsal must separately fence all durable queues and remap persisted workspace paths before worker startup. A DB path override alone is insufficient isolation.

Parent logs: `/tmp/zola-nine-parent-cancellation.log`, `/tmp/zola-nine-parent-ownership.log`, `/tmp/zola-nine-parent-route-guards.log`; compilation and audit evidence are under `/tmp/zola-nine-composition-1eqsr3sb`. No real webhook, outreach, paid Nexus call, enrichment write or canonical runtime activation occurred.

## Disposition

ROLLBACK CANDIDATE: exact nine-file proposal REJECTED.
ROLLBACK SHA: none selected or created.
IMMUTABLE ROLLBACK ARTIFACT: none created, because required tests failed.
FUNCTIONALLY VERIFIED: NO.
ROLLBACK ADOPTION DECISION REQUIRED: NO for this rejected proposal.

Do not remove security assertions or accept narrower fixtures to turn this rejection into a pass. Optional parser subhunks do not by themselves justify a recovery backport; constrain any future proposal to an explicit input contract and required safety dependency closure. A fully reviewed release-derived source is a possible engineering direction, not an adopted rollback version. It still requires isolated runtime and real six-read proof after provider, Supabase and n8n dependencies recover.
