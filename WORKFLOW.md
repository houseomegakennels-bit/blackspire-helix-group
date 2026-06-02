# Blackspire Repo Workflow

Date: June 1, 2026

## Purpose

This repo is used by:

- you
- Codex
- Claude Code
- possibly other coding tools

The goal of this workflow is to prevent:

- duplicate source-of-truth folders
- silent overwrites
- conflicting edits across tools
- uncommitted work getting lost

## Source Of Truth

The only source-of-truth workspace for this project is:

`C:\Users\USER\Desktop\blackspire-helix-group`

Do not create parallel working copies of the same app unless explicitly intended.

## Rule 1: Always Check Repo State First

Before making any edits in any tool, run:

```powershell
cd C:\Users\USER\Desktop\blackspire-helix-group
git pull
git status
```

If the repo has local uncommitted work, do not blindly start editing overlapping files.

## Rule 2: Preserve Unrelated Changes

Any coding tool working in this repo must:

- inspect current repo state before editing
- preserve unrelated local changes
- never overwrite or revert changes it did not create
- call out overlap/conflict before modifying already-dirty files

## Rule 3: Commit Frequently

After every meaningful piece of work:

```powershell
git status
git add <relevant files>
git commit -m "clear focused message"
git push
```

Do not let large amounts of work sit uncommitted if you plan to switch tools.

## Rule 4: Use Small Focused Commits

Good commit scopes:

- `parent site branding`
- `buyer engine admin`
- `oracle helix routes`
- `contact intake wiring`

Bad commit scopes:

- mixed frontend + backend + docs + unrelated cleanup all in one

## Rule 5: Branch Strategy

Default:

- `main` = stable source of truth

Use feature branches for major or overlapping workstreams:

- `feature/parent-site`
- `feature/buyer-engine-admin`
- `feature/oracle-helix`
- `feature/contact-intake`

Create a branch with:

```powershell
git checkout -b feature/your-branch-name
```

## Rule 6: Tool Switching

If switching from Codex to Claude Code or back:

1. finish current change
2. run `git status`
3. commit if possible
4. push
5. in the other tool, run `git pull` and `git status` before editing

If you are not ready for a real commit, use a checkpoint commit:

```powershell
git add .
git commit -m "checkpoint before switching tools"
git push
```

## Rule 7: Avoid Overlapping File Edits

Do not have two tools edit the same file family at the same time.

Examples of safe parallelism:

- one tool on `frontend`
- one tool on `oracle-helix`
- one tool on docs

Examples of risky parallelism:

- both tools editing `frontend/src/app/page.tsx`
- both tools changing the same API route

## Rule 8: Build Before Push

Before pushing frontend changes:

```powershell
cd C:\Users\USER\Desktop\blackspire-helix-group\frontend
npm run build
```

If a relevant test/build exists for the area you changed, run it before push.

## Rule 9: Git Safety Settings

This repo is configured locally with:

- `pull.rebase = false`
- `rerere.enabled = true`
- `merge.conflictstyle = zdiff3`

These settings help make merges and conflicts safer and easier to reason about.

## Rule 10: Standard Session Prompt For Coding Tools

Use this at the top of new tool sessions:

```text
Treat C:\Users\USER\Desktop\blackspire-helix-group as the only source of truth. Check git status before editing. Do not overwrite or revert unrelated changes. If the repo is dirty, preserve existing work and work around it unless explicitly told otherwise.
```

## Recommended Daily Flow

```powershell
cd C:\Users\USER\Desktop\blackspire-helix-group
git pull
git status
```

Do work.

Then:

```powershell
git status
git add <relevant files>
git commit -m "clear message"
git push
```

## Current Project Note

The main live frontend is:

`C:\Users\USER\Desktop\blackspire-helix-group\frontend`

The parent brand and ecosystem marketing pages now live inside that frontend.

Keep that structure unless there is a deliberate refactor decision.
