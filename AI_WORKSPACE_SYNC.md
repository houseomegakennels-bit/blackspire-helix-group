# AI Workspace Sync Protocol

## Admin intent
Everything done from mobile Codespaces, desktop VS Code, desktop Codex, Codex inside Codespaces, and Claude Code if used should share the same workspace and memory.

The source of truth is this GitHub repo:

`houseomegakennels-bit/blackspire-helix-group`

Codex Desktop and Codex inside VS Code/Codespaces are clients of this repo. They do not share authority through local session state or local auth files.

## Shared memory files
Agents must treat these files as shared cloud memory:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `memory/SESSION_LOG.md`
- `memory/ACTIVE_CONTEXT.md`
- `memory/DECISIONS.md`
- `memory/NEXT_ACTIONS.md`

## Default behavior
Unless the admin explicitly says otherwise, every AI/code session must:

1. Load memory at the beginning.
2. Work inside the repo.
3. Save session memory at the end.
4. Commit and push successful changes to GitHub.

## Mobile clarification
When the admin uses Codespaces from mobile, that is the same cloud workspace model as Codespaces from desktop. Mobile Codespaces must still use this repo and the same memory files.

Mobile Codespaces + Code, Codespaces + Codex, desktop VS Code, and desktop Codex all sync through GitHub.

## Codespaces Codex policy
Codespaces should bootstrap Codex automatically from repo configuration:

- install the Codex CLI during Codespace setup
- install the Codex VS Code extension from devcontainer configuration
- authenticate Codex with `OPENAI_API_KEY` from GitHub Codespaces secrets

Do not try to sync desktop Codex auth files into Codespaces. Desktop Codex can keep its normal local ChatGPT login.

## Admin override
If the admin says:

`ADMIN OVERRIDE: skip memory sync`

then skip automatic memory load/save for that session.

## Start command
From repo root:

```bash
./scripts/agent-start.sh
```

## Save command
From repo root:

```bash
./scripts/agent-save.sh
```

## Agent startup instruction
Every agent must read `AGENTS.md`, `PROJECT_CONTEXT.md`, and the `memory/` directory before editing.

## Safety
Do not silently overwrite another agent's work. If local uncommitted changes exist, warn and preserve them. Do not push broken builds unless the admin explicitly approves.
