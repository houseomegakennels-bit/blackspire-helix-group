# Post-ACL acceptance sequence

Status: preparation only. No production mutation, workflow update, service activation, real read, merge or cutover has been performed. The provider ACL is a proven external boundary, but it is not the sole remaining rollback/acceptance requirement.

## Verified anchors

- Release implementation: `db9b82594e0aa67e6cfec42258078a7dec327594`; PR125 remains canonical. Refresh exact HEAD and CI before execution.
- Supabase project: `kchtrvfcixnimvxxctkj`. The reviewed guarded ACL package is `/tmp/zola-provider-acl-reviewed-KDmBB8`; file hashes and fresh authority proof are in `ZOLA_PROVIDER_ACL_REQUEST.md`.
- Live n8n workflow: `VvMHSIbycYCx4CZN`, `blackspire-buyer-engine`, published version `cdd141ba-8d20-4981-b598-6af8e35aff86`. Fresh nodes/connections match the protected pre-change backup. Seven nodes contain the nine legacy writes.
- Only rollback: `2c0b600c268faa0571f08322e16d7f81f37789be`. Its freshly recomputed artifact digest remains `0028052a7d08b1e7e73b8ce8cd441f90d10f16b288e10d10416891b5598f58bd`.
- Saved rollback boot evidence proves API-before-worker behavior, readiness wait success, stopped-generation denial and owned-unit shutdown with stop held. It explicitly says six reads were not run. Reuse this evidence for that limited claim; it is not complete functional rollback acceptance.

## Execution order and stopping conditions

1. Verify provider-approved SQL hashes, scheduled administration window, recovery/backup evidence and fresh catalog match. Execute only through the authorized identity. The transaction must verify all preserved consumers, exact post-state, and present writer denials before COMMIT. Recheck committed state independently. Abort on drift; retain the exact rollback manifest.
2. Provision the existing reviewed scoped writer SQL and separate issuer/runtime identities. Recheck least privilege after provisioning, including no unrelated table, sequence, function or inherited PUBLIC authority. Do not infer future-role denial from an ACL run where those identities were absent.
3. Complete the bounded isolated supervised API/worker proof before canonical activation. Use fresh synthetic authority, generated role-separated environments and disposable TLS PostgreSQL; never copy production credentials into the fixture. Verify actual paths, immutable artifact, both identities and shared-state permissions before starting either supervisor. Preserve systemd's trusted `INVOCATION_ID`. Use the real root activation entrypoint and committed binding; do not substitute approval callbacks.
4. Complete secure Buyer intake continuity for immutable rollback `2c0b600`, plus the contained paired read harness. The legacy public webhook must never acquire privileged writer authority. Existing unsafe `/tmp/zola-final-six-read-runner.mjs` and `/tmp/zola-resume-supervise-reads.py` are not executable acceptance evidence.
5. Prepare n8n with `buildBuyerWorkflow()` from `packages/buyer-writer/n8n-workflow.js`. Required actual inputs are a verified HTTPS gateway origin, distinct secure `httpHeaderAuth` credential IDs for `x-buyer-ingress-key` and `x-buyer-writer-key`, and the preserved existing webhook ID. Never supply the issuer credential to n8n. Do not fabricate credential IDs or redirect the published workflow to an unavailable gateway.
6. Use an isolated candidate workflow/gateway context for Cloud validation while preserving the published Buyer workflow. Validate the candidate's exact payloads, credential references, connections, source-byte checks, receipt matching, sequential operation loop, timeout reconciliation, disabled execution saving, and empty pin data. Current offline tests pass; actual Cloud credential resolution/item pairing remains required. Verify all five Buyer tables in bounded isolated acceptance, with replay/expiry/malformed/cross-owner/failure/uncertain-response denials and no provider calls, outreach or fan-out.
7. When the original writer, n8n, rollback, disk, recovery, authority, grant and harness gates all pass, perform controlled canonical API health, worker readiness and generation-fence acceptance. Coordinate live workflow publication with a functioning authenticated gateway and caller continuity. Verify the published version matches the reviewed new definition; `active=true` alone is insufficient. Export the new protected snapshot and digest.
8. Run all six real paired candidate reads. Apply only the reviewed Buyer/Nexus migrations after the required runtime/writer/rollback gates pass; verify row preservation, browser denial, own-job isolation, scoped writer success and n8n continuity immediately. An unexpected write attempt fails read-only acceptance even if the application catches the error.
9. Refresh backups and exact-head CI/diff/secret/audit evidence. Merge PR125 only after every original gate is green, using expected-head protection. Deploy the same resulting main SHA to frontend and VPS, then rerun six live reads and production smoke. Preserve rollback artifacts.

## Six-read inputs still requiring real witnesses

The current GitHub frontend check points to deployment `dpl_9MJxAy71KymQGBqToWVUhJpCXCXq`, hostname `frontend-68ul4oqmm-houseomegakennels-4825s-projects.vercel.app`, at `db9b825`. Direct Vercel API inspection reports **CANCELED**, despite the green GitHub status. It is not a ready paired candidate. A READY deployment with the exact accepted release SHA is mandatory. Do not reuse an older URL merely because its application code appears equivalent.

The runtime workspace is `blackspire-command`. Resolve the actual authenticated principal and all six current persisted grants from protected authority evidence. Existing primary Command authentication is available; do not request it again. An actual unauthorized principal and actual owner-A/owner-B Buyer job/report witnesses remain unresolved; anonymous denial is additional coverage, not their replacement.

| Capability | Bounded input/result requirement | Required observation |
| --- | --- | --- |
| Seller | limit 5; successful actual Seller query | Exact receiver/transport, no private contact disclosure |
| Buyer Profiles | limit 5 shared catalog rows | Workspace capability grant; do not invent per-user catalog ownership |
| Buyer Matches | known persisted `DE-NNNN` with resolvable county; result limit 5 | Actual deal and bounded candidate queries, not a synthetic empty shortcut |
| Deal Records | known persisted deal; bounded list | Reject swallowed SQL errors and fallback-only results |
| Deal Analysis | same persisted deal | All associated reads; no scaffold or Storage bucket creation attempt |
| Nexus Status | actual contact linked to the same persisted deal; limit 1 | Status-only output, zero paid provider calls and zero enrichment writes |

For every task, collect real route/workspace/principal/permission/transport evidence, generation-fenced task completion, bounded output, cross-owner denial and authoritative mutation observations. Stable before/after snapshots alone cannot rule out write-and-revert or caught failed mutations. The draft observer map documents those limitations; it does not establish completed acceptance.

## Executable offline n8n packaging

Run with Node 22.23.1 as root; neither command reads the n8n API key or contacts n8n:

```bash
env -i PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin   node scripts/prepare-buyer-workflow-package.js /protected/input.json /protected/new-package-directory
```

The input must be root-owned 0600 under trusted non-writable ancestors and contain exactly `version` (1), `workflowId`, `workflowVersion`, `releaseSha`, `backupSha256`, `gatewayOrigin`, `webhookId`, `ingressCredentialId` and `writerCredentialId`. The three unresolved gateway/credential fields may be null; in that case the command emits only `manifest.json` with `requirements-pending`. A complete configuration emits deterministic `workflow.json` and a manifest last, using exclusive protected files. Existing destinations are rejected. Credential values and legacy exports are not accepted inputs. Supplied references, revision and digest still require live verification before any mutation.

The combined disposable PostgreSQL lane is `scripts/test-buyer-writer-postgres.mjs`, using the pinned PostgreSQL 17.6 image from canonical CI. It now runs both exact reviewed migrations before writer installation and reapplies both afterward, including private-ledger preservation and dedicated-writer success. This does not authorize production execution.

Actual baseline lifecycle evidence is protected under `/var/lib/blackspire-zola-rehearsal/activation/2591e27f-74f6-4a32-923e-5c59e09d618d/operator-result.json` (release 6bc968d) and `/var/lib/blackspire-zola-rehearsal/activation/caf73888-8e6e-48ad-90a1-11044909a752/operator-result.json` (mandated recovery). Each uses an exact sealed artifact, fresh synthetic database/authentication, real role accounts, private loopback networking and actual supervisors. Startup, readiness, stopped-worker denial, new restart generation, all non-heartbeat state preservation and cleanup pass. Scoped writer is disabled in this baseline; the full writer activation and six-read commands remain incomplete. Do not execute the previously rejected six-read drafts.

The frontend ignored-build hook explicitly builds `release/zola-production-live` even when frontend bytes are unchanged, using Vercel's [system-provided branch reference](https://vercel.com/docs/environment-variables/system-environment-variables#vercel_git_commit_ref). Verify the resulting deployment is READY at the exact pushed SHA before pairing; a green GitHub deployment status alone remains insufficient.
