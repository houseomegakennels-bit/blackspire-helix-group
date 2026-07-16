# Implementation Plan: Blackspire Command Foundation

## Overview
Build a local-first Blackspire Command foundation with Hermes orchestration, SQLite persistence, Telegram command handling, Jarvis PWA, policy gates, provider mode detection, and packaging.

## Architecture Decisions
- Use Node.js built-ins and the sqlite3 CLI to avoid heavyweight service dependencies.
- Keep persistence behind `packages/task-engine` so PostgreSQL can replace SQLite later.
- Use safe manual/provider handoff modes when external credentials or official execution surfaces are unavailable.

## Phases
- Foundation: database, task lifecycle, workspace registry, policy.
- Interfaces: API, Telegram bridge, Jarvis PWA.
- Execution: runner, Hermes validation loop, provider routing.
- Packaging and docs: Docker, compose, setup, reports.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|---|---|---|
| Missing external credentials | Medium | Capability detection and manual handoff mode |
| Command execution abuse | High | Workspace command allowlists and path confinement tests |
| Phone workflow gaps | High | PWA and Telegram expose normal controls |
