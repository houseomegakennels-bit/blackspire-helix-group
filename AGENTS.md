# Blackspire Agent Rules

1. Read `docs/BLACKSPIRE_SOURCE_OF_TRUTH.md` first.
2. Before work, inspect the branch, HEAD, `git status`, worktrees, and recent commits.
3. Reconcile documentation against code, commits, tests, deployment evidence, and operator-confirmed results; mark unsupported claims `UNVERIFIED`.
4. Never record secrets, raw credentials, tokens, or credential-file contents.
5. After meaningful verified work, update only affected canonical-memory sections and append one dated session-log entry.
6. Prefer Codex and safe code automation over manual operator work. Never bypass required operator authority.
7. Protect approval boundaries, workspace isolation, budgets, evidence integrity, emergency controls, and the prohibition on live trading or funds movement.
8. Preserve unrelated and unpublished work. Never push, merge, deploy, or change production without explicit authority.
9. Use Node.js `22.23.1` and deterministic `npm ci`; keep VPS production startup separate from disposable mock-only Codespace, Quick Tunnel, and iPhone test startup.
10. Never auto-load production credentials into a development or test environment.
11. Follow `docs/BLACKSPIRE_MEMORY_MAINTENANCE.md` before committing a milestone.
