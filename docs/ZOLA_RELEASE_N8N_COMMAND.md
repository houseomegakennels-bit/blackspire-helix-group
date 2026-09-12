# Protected n8n release transition

`bash scripts/with-node.sh scripts/zola-release-n8n.js --dry-run /absolute/protected/input.json`

The command implements the workflow lane of release orchestration. It does not establish global release readiness, merge PR125, apply SQL, activate the VPS, invoke a workflow or restore legacy anonymous writes. Provider ACL, immutable URL containment and complete acceptance remain prerequisites for the enclosing release commander.

The root-owned 0600 input has exactly these fields:

- `releaseSha`: the complete reviewed release SHA.
- `packageConfigurationFile`: protected configuration for the existing deterministic n8n package.
- `backupFile`: the original protected live workflow snapshot whose exact bytes match the package's backup digest.
- `configurationFile`: the installed API-only Buyer writer configuration.
- `exclusiveWindowUntil`: UTC timestamp ending the coordinated exclusive workflow administration window, at most fifteen minutes ahead when each mutation executes.

`--dry-run` regenerates the candidate and checks the backup without reading the API key or opening network connections or journals. It does read the explicitly supplied protected snapshot, which can contain secrets; no snapshot contents are printed. All other modes require root, Node 22.23.1 and a clean exact local release branch. Forward mutations also require the same SHA from the fixed GitHub repository URL. Read-only reconciliation and rollback can use the retained exact reviewed checkout after the remote branch advances. The authenticated API key is loaded only from `/var/lib/blackspire-operator/n8n-api-key` and is never logged. The workflow and Cloud origin are constants, not configurable endpoints.

Execute the separately reviewable transitions in this order after all enclosing release gates pass:

1. `--inspect` observes the current and published version twice, checking exact authored fields and published nodes/connections against the protected baseline or regenerated candidate.
2. `--deactivate` stops new legacy intake and positively confirms the inactive baseline. This is a production change and is not executed as preparation.
3. `--update` requires the confirmed deactivation, complete execution pagination with no unfinished jobs, both existing credential references, and two identical workflow observations. It sends only the documented writable fields to an inactive workflow. Nonempty static or pinned workflow data fails closed before replacement; the inspected baseline has empty static data and null pinned data. It never assumes PUT on an active workflow is a harmless draft operation.
4. `--publish` requires the confirmed candidate version and continued quiescence, then sends that explicit `versionId` to `/activate`. It confirms both current and published candidate graph twice and checks canonical writer readiness again.
5. `--rollback` only deactivates a positively observed published candidate. It does not overwrite the workflow, discard executions, remove ledgers or republish the old definition. Writer health, CI freshness, remote branch equality, credential resolution and empty retained workflow data are not required to stop failed intake. Rollback preserves retained data.

Before each normal mutation, the CLI verifies PR125 is still open at the exact release SHA and the latest canonical CI run for that SHA succeeded within twenty-four hours. Kernel-derived canonical API/worker process identity, installed sealed production artifact, NSS separation, socket ownership, actual health/readiness and committed writer authority must pass twice. A stopped API, stale generation, wrong SHA, unready writer, failed CI, workflow drift, unresolved credential or unfinished execution refuses the transition before its mutation intent. The short administration window is an explicit coordination prerequisite; the public API does not provide a proven compare-and-swap update contract. Repeated checks detect observable drift but do not replace that exclusive window.

The fixed directory `/var/lib/blackspire-operator/release-operations` contains one host-wide `commander.lock` and a hash-chained, fsynced `n8n.jsonl`. The lock is shared across release SHAs. The journal namespace binds the original backup and exact candidate, so re-pinning to a different release SHA cannot erase earlier operation intents. Every intent is durable before the HTTP mutation. Each operation can be sent once; successful and uncertain responses are followed by read-only state reconciliation, never a mutation retry.

Use `--reconcile` after an uncertain result. Two equal, positive observations of the exact pending target can mark that intent confirmed. Observing the old state cannot authorize a retry. Process death retains the lock. Only `--reconcile` may recover a lock while holding a kernel `flock` on its opened inode, after validating its exact protected schema and establishing the original boot/PID/start-time owner is absent. It preserves the original lock bytes in an exclusive read-only retained file before releasing its active name; live or ambiguous owners refuse recovery. The recovered invocation remains GET-only. Preserve the journal, including partial lines; malformed or torn journals fail closed. Mutation modes never recover locks, and no journal deletion exists.

Tests use a real loopback HTTP server for the complete deactivate/update/publish/rollback sequence, lost acknowledgements, pending-intent reconciliation, active PUT refusal, execution quiescence and graph drift. Root filesystem tests prove serialization, replay persistence and lock retention after a real child process exits. These are isolated transition proofs, not a Cloud migration or full production acceptance.

API semantics are grounded in the [n8n public API reference](https://docs.n8n.io/api/api-reference/) and the [version-specific activation schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/workflows/spec/paths/workflows.id.activate.yml). Actual Cloud inactive/PUT/publication semantics remain an execution-time verification requirement; unexpected schema stops without retry.
