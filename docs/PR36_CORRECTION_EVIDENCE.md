# PR #36 correction evidence procedure

This is a post-push, read-only evidence procedure. It does not deploy, install host components,
change PR draft state, or mutate production. Run it only after the local correction commit has been
manually pushed to the existing PR branch.

Use a new evidence directory outside the repository. Do not place credentials or environment-file
contents in it. The GitHub metadata query deliberately uses only supported `gh pr view --json`
fields. Metadata collection and validation are the first gate; `set -euo pipefail` prevents any
later command or green summary after setup failure.

```bash
set -euo pipefail
export PATH=/opt/nodejs/node-v22.23.1-linux-x64/bin:$PATH
test "$(node --version)" = "v22.23.1"

: "${PR36_REMOTE_BRANCH:?launcher must provide PR36_REMOTE_BRANCH}"
evidence_root="$(mktemp -d /tmp/blackspire-pr36-evidence.XXXXXXXX)"
status_file="$evidence_root/status.tsv"

record() {
  label="$1"
  shift
  log="$evidence_root/${label}.log"
  set +e
  "$@" >"$log" 2>&1
  status=$?
  set -e
  printf '%s\t%s\n' "$label" "$status" >>"$status_file"
  if [ "$status" -ne 0 ]; then
    printf 'EVIDENCE_FAILED: %s (exit %s; log %s)\n' "$label" "$status" "$log" >&2
    exit "$status"
  fi
}

record metadata gh pr view 36 \
  --repo houseomegakennels-bit/blackspire-helix-group \
  --json number,state,isDraft,headRefName,headRefOid,baseRefName,url

node - "$evidence_root/metadata.log" "$PR36_REMOTE_BRANCH" "$(git rev-parse HEAD)" <<'NODE'
import fs from 'node:fs';
const [file, expectedBranch, expectedHead] = process.argv.slice(2);
const metadata = JSON.parse(fs.readFileSync(file, 'utf8'));
if (metadata.number !== 36
  || metadata.state !== 'OPEN'
  || metadata.isDraft !== true
  || metadata.baseRefName !== 'main'
  || metadata.headRefName !== expectedBranch
  || metadata.headRefOid !== expectedHead) {
  throw new Error('PR #36 metadata does not match the open draft correction head');
}
NODE
printf 'metadata_validation\t0\n' >>"$status_file"

record npm_ci npm ci --ignore-scripts
record focused_living_memory node --test --test-concurrency=1 tests/living-memory-ancestry.test.js
record focused_production_boundary node --test --test-concurrency=1 tests/production-bind-boundary.test.js
record living_memory bash scripts/check-living-memory.sh
record source_preflight npm run production:preflight
record strict_host_preflight npm run production:preflight:host
record diff_check git diff --check origin/main...HEAD
record full_test npm test
record build npm run build
record lint npm run lint
record typecheck npm run typecheck
record security_scan npm run security:scan
record audit npm audit --audit-level=high
record final_living_memory bash scripts/check-living-memory.sh
record final_diff_check git diff --check origin/main...HEAD
record final_status git status --short --branch

printf 'EVIDENCE_COMPLETE: all recorded commands exited 0; source and strict-host preflights are separate\n'
printf 'Evidence directory: %s\n' "$evidence_root"
```

The focused security repetition is intentionally performed during correction, before the full
suite, and recorded in canonical memory with its count. This post-push procedure runs the complete
focused group once against the exact remote PR head; it does not pretend that repeating a small
non-adversarial subset is additional security coverage.
