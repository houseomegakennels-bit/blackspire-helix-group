# Blackspire Living-Memory Maintenance

## Canonical set

- `docs/BLACKSPIRE_SOURCE_OF_TRUTH.md`
- `docs/BLACKSPIRE_ACTIVE_CONTEXT.md`
- `docs/BLACKSPIRE_NEXT_ACTIONS.md`
- `docs/BLACKSPIRE_DECISIONS.md`
- `docs/BLACKSPIRE_SESSION_LOG.md`
- this file

## Milestone rule

After each meaningful milestone, Codex must update only affected sections, append exactly one dated entry to `BLACKSPIRE_SESSION_LOG.md`, run the living-memory check and repository secret scan, and commit the memory update with the implementation or as an immediately following documentation commit.

Before editing, read the source of truth and inspect branch, HEAD, status, worktrees, upstream divergence, and recent commits. Reconcile claims against code and evidence. Mark uncertainty `UNVERIFIED`; never infer current production state from configuration alone.

Never include credentials, tokens, environment values, credential-file contents, private evidence payloads, or raw production logs. Authentication may be recorded by method name only.

Required validation:

```bash
bash scripts/check-living-memory.sh
npm run security:scan
git diff --check
git status --short --branch
```

If product behavior changed, also run the relevant tests and normal build/lint/typecheck gates. Do not weaken the check to make documentation pass.

## Recovery prompt

`Read docs/BLACKSPIRE_SOURCE_OF_TRUTH.md, run scripts/check-living-memory.sh, inspect Git state and recent commits, then reconcile any requested work against code and verified evidence before editing.`
