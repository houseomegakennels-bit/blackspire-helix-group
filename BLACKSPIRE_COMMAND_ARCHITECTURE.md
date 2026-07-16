# BLACKSPIRE_COMMAND_ARCHITECTURE

Blackspire Command is organized as a monorepo with runtime apps and replaceable packages.

## Apps
- `apps/api`: HTTP API, health/readiness, task endpoints, Jarvis static serving, emergency stop.
- `apps/telegram`: Telegram command bridge with allowlist, duplicate protection, Markdown escaping, and command routing.
- `apps/jarvis-pwa`: Installable mobile PWA for command, approvals, logs, health, settings, and emergency controls.
- `apps/worker`: Queue polling worker.

## Packages
- `packages/task-engine`: SQLite migrations, task lifecycle, audit log, flags.
- `packages/workspace-registry`: workspace records with isolated commands and policy.
- `packages/policy`: approval and isolation decisions.
- `packages/providers`: OpenAI, Anthropic, Codex, Claude Code capability detection and provider routing.
- `packages/execution`: confined command runner.
- `packages/hermes`: planner/execution coordinator/validation summarizer.
- `packages/shared`: config, utility, redaction, states.
