# ZOLA project-routing coverage experiment

The canary answers whether Vercel project routing reaches the retained READY immutable deployments, aliases and domains. A successful experiment is **not** application authentication, historical endpoint denial, authority containment, or rollback acceptance.

The only temporary rule matches `^/zola-routing-canary-64f900b8de032db89be7d8a682070094$` and returns HTTP 418 with an exact nonce response marker and `Cache-Control: no-store`. It has no rewrite destination, authentication predicate, credential, or application request payload. Source inspection found no matching application route. Ordinary application paths do not match this expression. Probes use anonymous GET, omit credentials, do not follow redirects, and discard response bodies.

## Guarded execution

The existing protected `ZOLA receiver maintenance` workflow serializes all its runs. One explicitly reviewed push transition from `3473d648b4d3b4184555e4ed8bd790d4f4baafa4` enables the fixed canary. Other pushes run the existing read-only audit. Do not push that transition before independent review of the final script and workflow. Inspect other routing operators before execution: the Vercel API does not expose compare-and-swap, so external concurrent routing changes must remain excluded during the experiment.

The script requires clean tracked source, matching GitHub/release SHA, fixed project/team, completed deployment/domain/alias inventory, and READY candidate and fixed recovery deployments. It uses READY deployment hosts plus every alias/domain, recording non-READY deployments as excluded metadata without claiming they are denied. Missing or partial prerequisites stop before routing mutation. If the new candidate is still building, wait for exact-head READY and rerun the same workflow run.

The sequence is baseline/configuration checks, bounded GET probes, add the single rule, inspect exact staged bytes, publish the verified version, inspect exact live bytes, GET every scoped host, delete only the recorded canary rule ID, inspect empty staging, publish that empty version, then verify empty live rules and absent markers. Existing rules or staging cause refusal. Fresh version history is checked before every mutation. At most eight probes run concurrently; the experiment reserves a separate cleanup window.

Version actions use `POST /v1/projects/{projectId}/routes/versions`. Add uses `POST /routes`; cleanup deletes the exact rule with `DELETE /routes` and `{"routeIds":["<returned canary ID>"]}`. No overwrite-all operation exists in this tool.

## Failure and recovery

Every management mutation has a synchronous fsynced intent written before the request. Mutations are never retried automatically. Lost add or publish responses are reconciled with authenticated GETs; exact staged canaries are discarded and exact live canaries are deleted through a new empty version. Unknown route bytes, changed versions, or foreign staging stop cleanup rather than overwrite other work.

The workflow always uploads `zola-routing-canary-evidence/`, including `plan.json`, `journal.jsonl` and `result.json` when available. These contain no Vercel token or application credentials. Retain them in protected operator storage immediately after the run. A killed job may leave the harmless canary or staging in place; no completed/restore claim may be made until reconciliation succeeds.

The original normal-run recovery recognizes an exact canary returned by the default routing GET. Actual attempt 2 showed that an unpublished stage is not returned there. Do not rely on that path for retained unpublished stages; use the exact-version reconciler below.

For a retained exact canary, the explicit `cleanup-exclusive-reviewed-canary` action uses the same nonce and reviewed SHA, requires exact current canary bytes, and only removes/discards that canary. It never creates or publishes a canary. Normal GitHub dispatch becomes usable once this workflow exists on the default branch; before then, recovery requires a separately reviewed one-time push action using this same cleanup code. Never merge PR125 to make dispatch available.

`CANARY_COVERAGE_PASS` requires all active probes to have both HTTP 418 and the exact marker, plus verified restoration. A 404, an empty route list, missing metadata, an unavailable host, a redirect, or a markerless response cannot establish coverage. `CANARY_RESTORED` attests only explicit cleanup. Every result retains `applicationDenialProven:false`.

## Validation and primary API sources

Run `bash scripts/with-node.sh --test tests/zola-routing-canary.test.js tests/zola-vercel-protection-inventory.test.js`.

Reviewed primary sources:

- https://vercel.com/docs/routing/project-routing-rules
- https://raw.githubusercontent.com/vercel/sdk/main/src/models/addrouteop.ts
- https://raw.githubusercontent.com/vercel/sdk/main/src/models/deleteroutesop.ts
- https://raw.githubusercontent.com/vercel/sdk/main/docs/sdks/projectroutes/README.md

The current API exposes no method matcher in these project rules. Headers, cookies, query and host conditions are not application authorization. Actual canary coverage must be established before designing any separate historical-host containment rule.

## Actual 2026-09-08 stage recovery

Run `34190899875` attempt 1 stopped before management requests because its initial inventory captured the candidate as BUILDING. A fresh read confirmed exact-head READY and the authorized attempt 2 ran 274 anonymous baseline probes (237 HTTP 404, 37 HTTP 410). It sent exactly one add request and received version `2a1d0b0b-e755-4438-899e-0327dd69621e`. No promotion request occurred. The optional `isStaging` field was absent from the add response; the strict original checker stopped. Its immediate default GET returned an empty list during propagation. A later read proved that default GET returns the current staged version, so it must not be labeled a live-routing selector.

The reviewed SDK provides `GET /routes?versionId=<id>` for explicit version retrieval. `scripts/zola-routing-canary-reconcile.mjs` is pinned to that exact version and original nonce. It records sanitized diagnostics, then permits only DISCARD after complete history contains the sole known version with affirmative `isStaging:true`, optional `isLive` absent or false, and both current/default and explicit-version responses contain the identical sole canary. Optional contradictory or malformed flags and counts are rejected. Every observation is repeated before the one possible discard. Ambiguous metadata or any drift stops with GET-only evidence.

The corrected rescue workflow transition is pinned to predecessor `809547e1fbac46fccca49dcbf1e88df953e7444b`; the original add/promote transition does not match that predecessor. Rescue journal writes and both new directory entries are fsynced before mutation. A successful empty 204 response is allowed. Lost acknowledgements trigger read-only reconciliation, never another discard. Complete empty history, empty current/default routing, and explicit version HTTP 404 together prove `KNOWN_STAGE_ABSENT`; 404 alone does not. No actual rescue completion is claimed until its retained production evidence confirms the result.

The first rescue run `34192089393` performed GETs only and preserved exact-byte evidence (route SHA256 `331981f2849410368f5ba1572d90467ecec0f17580c8fde5929754457556dc4a`). It stopped because it had incorrectly required an empty default response. The corrected verifier uses the observed schema and the official meaning of affirmative staging: staged and not yet promoted. It never interprets default GET as proof of live state. Post-discard observations retry read-only at most three times, one second apart, within a twenty-request cap; no mutation is retried. All three absence witnesses must agree before completion.
