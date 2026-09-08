# Six-read production collection

The collector submits exactly six fixed `read_only` objectives through the canonical API and validates the durable SQLite task, single dispatch receipt, authority binding, actual frontend observation, bounded output, kernel listener owner, process start times and systemd generations. The production entrypoint requires the clean source checkout SHA to equal the expected runtime SHA, and binds the actual process WORKER_ID separately from systemd InvocationID. The same task is read over authenticated HTTP, then requested using an existing different authenticated principal's session and required to return an exact non-disclosing 404. This is Command task access denial, not Supabase row-owner policy acceptance.

Run from the reviewed release checkout with pinned Node:

```
bash scripts/with-node.sh scripts/zola-six-read-collect.js --dry-run /var/lib/blackspire-operator/preparation/six-read-config.json
bash scripts/with-node.sh scripts/zola-six-read-collect.js --production /var/lib/blackspire-operator/preparation/six-read-config.json
```


The same entrypoint also runs a protected, noncanonical integration acceptance:

```
sudo bash scripts/with-node.sh scripts/zola-six-read-collect.js --candidate
```

Candidate mode accepts no config or credential path. Its supervised child receives an explicit four-variable environment, creates a fresh private network namespace, verifies only loopback exists and no default route exists, then starts the actual API on an ephemeral loopback port. It provisions generated credentials and two principals only in its fresh disposable SQLite database. All six reads traverse the actual HTTP admission and task-disclosure endpoints, exact-key SQLite reconciliation, real claim/dispatcher/receipts and actual frontend route implementations with synthetic division data. The production collector's HTTP boundary is shared, so authentication, response bounds and exact foreign-session 404 verification use the same code. Reopening the durable journal and rerunning adds zero tasks and zero dispatches. Anonymous and wrong-token HTTP admissions are rejected before task creation.

The child uses a root-owned ephemeral directory under `/root`, so the existing protected journal checks remain intact; the supervisor removes only its known database and journal files after the child exits. Child runtime and output limits remain enforced. It does not start systemd services or contact a deployed frontend. Its generation is the real local process/network namespace, **not a production supervisor generation**. Result SHA fields describe synthetic route source/current checkout, not an independently observed live deployment; a digest records the integration's source files. Candidate PASS exits 0 while `livePass` remains false, and cannot satisfy production gates. This proves actual API/collector integration and network-contained synthetic dispatch, not production row-owner policies or production database mutation deltas.

Configuration and credentials must be explicitly supplied, root-owned 0600 JSON under root-owned ancestors without group/other writes or named ACLs. No credentials are discovered or loaded in dry-run. Example schema (replace each value with independently verified deployment metadata; this is not an executable production config):

```json
{
  "version": 1,
  "releaseSha": "0000000000000000000000000000000000000000",
  "frontendOrigin": "https://verified-deployment.example",
  "workspace": "blackspire-command",
  "principal": "blackspire-operator",
  "deniedPrincipal": "existing-other-principal",
  "dealId": "DE-0001",
  "apiPid": 100,
  "workerPid": 101,
  "port": 8789,
  "databasePath": "/var/lib/blackspire-command/command.sqlite",
  "credentialPath": "/var/lib/blackspire-operator/preparation/six-read-credentials.json",
  "journalDirectory": "/var/lib/blackspire-operator/preparation/six-read-journals",
  "runId": "release-acceptance-before-migration"
}
```

The credential object has exactly `bearer` (canonical API administrator credential) and `deniedCookie` (existing valid session Cookie header bound to `deniedPrincipal`). The collector does not create principals, sessions, grants or division rows. If no real second principal/session is available it refuses before admitting any tasks. Production API currently only authorizes its configured operator; a valid different principal session is authenticated by `/api/auth/session` and refused at the protected task boundary. An anonymous or invalid session cannot satisfy this witness.

Create the journal directory as root mode 0700. The journal is hash chained and every intent is fsynced before its POST. SQLite is opened read-only with exact idempotency lookup, including actor/workspace/channel/authority/intent/request binding. A lost response with a found exact task continues collection; absence remains UNKNOWN and is never retried, including a crash before transmission. Preserve the run ID and configuration on rerun. A changed generation refuses reuse. HTTP requests have a four-second timeout and 128 KiB ceiling; each task has at most 60 half-second polling intervals. Concurrent runs sharing a run ID are refused.

A crash leaves `<runId>.lock`. Before removing only that lock, independently verify its recorded PID and `/proc/PID/stat` start time no longer identify a running collector; preserve the `.jsonl` evidence. Torn or corrupted journals require forensic reconciliation and are never truncated automatically. Successful reruns do not create new tasks or provider dispatches. A new run ID intentionally requests six new reads and must only be used for a separately authorized acceptance phase after all uncertain prior admissions are reconciled.

Stdout contains sanitized machine-readable JSON. Stderr contains the human summary. Raw results, contacts, SQL rows, HTTP bodies, cookies and bearer credentials are not logged. Result hashes and bounded counts are recorded; the journal retains sanitized generation/task IDs. The API intentionally writes task, permission, audit and receipt records; this is not literal zero SQLite mutations.

Exit codes: 0 = dry-run plan validated or isolated candidate integration passed; 1 = failed closed; 2 = six live reads collected but complete release acceptance unverified. Production cannot currently return a full PASS. The supplied read-client observation excludes mutation methods and confines its own transport to bounded PostgREST GET/HEAD, but is not process-wide egress evidence or an authoritative division before/after row delta. Nexus reports zero paid-provider calls for this specific dispatch based on the exact-SHA reviewed route and its supplied-client-only contact lookup; this does not claim zero unrelated process-wide activity. Nexus absent status is reported honestly and does not prove a positive stored-contact witness. The executable intentionally holds release on missing process-wide paid-provider evidence, division mutation deltas, and Supabase row-owner denial. Do not substitute caller-provided boolean proofs for these gaps.
