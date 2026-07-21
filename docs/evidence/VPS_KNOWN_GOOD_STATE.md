# Blackspire Command — Known-Good State Capture (Step 1)

**Capture (UTC):** 2026-07-21T20:29:31Z
**Author:** Claude Code known-good-state capture (read-only)
**Scope:** Read-only inspection + this sanitized evidence note only. No host, runtime, service,
network, DNS, proxy, TLS, user, group, permission, systemd, firewall, Telegram, credential, or
production change occurred.

> Sanitization: no IP addresses, secrets, tokens, environment values, private URLs, certificate
> material, full database paths, or database contents are recorded here.

---

## 1. Repository / Git state

| Item | Value |
|---|---|
| Repository path | `/tmp/blackspire-unified-input` |
| Working branch (at capture) | `feature/unified-input-foundation` (local HEAD `0ae1990`) |
| origin/main full SHA | `0a9affacaf13dd1b040c5d96eb112d979ab59444` |
| main tip | `0a9affa` — "Merge pull request #27 …" (PR #27 present on main) |
| Working tree | clean; no merge/rebase/cherry-pick/bisect in progress |
| This note's branch | `docs/known-good-state-capture` (local only; **not pushed**, **no PR**) |

## 2. Host / runtime classification

- **Host class:** single Linux host running a Docker container runtime + host-level systemd.
- **Current live Blackspire runtime is DEVELOPMENT-mode, containerized — NOT a production
  deployment.** No durable production runtime exists yet (`/opt/blackspire-command` release root
  is **absent**; `blackspire-command.service` is **not installed**).

### Running processes (sanitized)

| Role | PID | Parent | Start (UTC) | Uptime @ capture | Manager | Notes |
|---|---|---|---|---|---|---|
| Command API | `949485` | `949484` (`sh -c`) | 2026-07-20 22:21:16 | ~22h06m | Docker container (cwd `/app`) | `node apps/api/server.js` |
| Worker | `141927` | `141926` (`sh -c`) | 2026-07-17 18:14:01 | ~4d02h | Docker container | `node apps/worker/worker.js` |
| Codex runner | `158371` | `1` | 2026-07-17 18:24:25 | ~4d02h | **systemd** `blackspire-codex-runner.service` (user `codexrunner`, active/running) | `/opt/blackspire/apps/codex-runner/server.js` |

- **API supervision:** containerized (docker-proxy publishes the port). **Not** managed by a
  Blackspire production systemd unit.
- **Runtime mode classification (non-secret keys only):** `NODE_ENV=development`,
  `TRUST_PROXY=false`, `BLACKSPIRE_DB_PATH` set (custom persistent path). Not the vps-production
  profile.
- **External-provider capability:** credentials **are present** in the dev container environment
  (provider + Telegram token keys are SET; values withheld and never displayed). This is the
  development container, not the production no-provider profile.
- **Real Telegram connected:** **No** — `telegramMode=dry-run` (token present but not connected/polling).
- **TEST_MODE:** not enabled (no test-mode env key set; health reports the normal API service).

## 3. Listeners / network boundary

| Port | Listener | Bind | Class | TLS |
|---|---|---|---|---|
| 80 | none | — | — | — |
| 443 | none | — | — | — |
| 8787 | `docker-proxy` (pids 949448/949455) | `0.0.0.0` and `[::]` | **public bind at host level** | none (plain HTTP) |

- **Reverse proxy installed:** No (nginx/caddy absent).
- **TLS termination:** None (no certbot, no `/etc/letsencrypt`, no app-side TLS).
- **Note:** Port 8787 is currently bound on all interfaces (`0.0.0.0`) by docker-proxy, i.e.
  publicly bindable at the host level (any external cloud security-group/firewall is outside this
  host's visible config; host `ufw` is **inactive**). The durable production plan instead binds
  `127.0.0.1:8787` behind nginx — a future change, not applied here.

## 4. Health / application state (bounded read-only)

| Check | Result |
|---|---|
| `GET /health` | **200**, ~4 ms; body `{ ok: true, service: "blackspire-command-api", emergencyStop: false, telegramMode: "dry-run" }` |
| `GET /ready` | 200, ~9 ms |
| `GET /api/tasks` (no creds) | **401** — auth boundary enforced |
| `GET /jarvis` | **200** — Jarvis PWA served |
| Strict headers on `/` | `content-security-policy`, `x-frame-options`, `x-content-type-options` **present** |

- **Runtime healthy:** Yes.
- **Contains merged Jarvis release:** Jarvis route is live (200) in the running dev container;
  whether it is byte-identical to merged main `0a9affac` is **not provable** (see §5 — container
  commit unknown).

## 5. Live commit / release evidence

- **Running container (API/worker) commit:** **UNKNOWN.** Container cwd `/app` has no `.git`; the
  build commit cannot be proven from the host. Recorded honestly as unknown — not guessed.
- **Strongest available evidence:**
  - Host git checkout `/opt/blackspire` HEAD = `19994131394678ca5f7cb2f91693c4c7b0cfc3e2` (this is
    the **codex-runner** source checkout, not proven to be the API container's code).
  - Merged code baseline on `origin/main` = `0a9affacaf13dd1b040c5d96eb112d979ab59444`.
- **Release-directory mechanism:** none present (`/opt/blackspire-command/releases` absent) — there
  is no symlink-based release rollback in place yet.

## 6. Database state (canonical config, read-only)

- **Type:** SQLite via `node:sqlite` `DatabaseSync` (`packages/task-engine/db.js`).
- **WAL mode:** configured/active by design (`PRAGMA journal_mode=WAL;` in db init).
- **Path class:** custom persistent path under the container's `/app/.blackspire-command`, on
  **ext4 `/dev/sda1`** (a persistent host-backed mount — survives container restart). It is
  **outside** the durable production release layout (`/opt/blackspire-command/shared/database`,
  which does not exist yet).
- **File metadata / owner / mode / size / mtime:** not host-accessible (the DB lives inside the
  container filesystem namespace); classified via configuration only.
- **WAL/SHM file presence:** not host-observable from outside the container namespace.
- **Integrity check / checksum:** **NOT taken.** A checksum or `PRAGMA integrity_check` was
  deliberately skipped — it would add load and (for a copy/checksum) risk a write; not needed for a
  known-good classification and outside this read-only step.

## 7. Rollback target

| Item | Value |
|---|---|
| Current live application dir | containerized `/app` (API + worker) |
| Current live release/commit | **UNKNOWN** (container has no `.git`); strongest evidence in §5 |
| Current running command | `node apps/api/server.js` (API), `node apps/worker/worker.js` (worker), in-container |
| Service-manager config | API/worker: Docker container; codex-runner: systemd `blackspire-codex-runner.service` |
| Current database path | custom persistent path under `/app/.blackspire-command` on `/dev/sda1` (SQLite/WAL) |
| Current health result | healthy (`/health` 200, `ok=true`, `telegramMode=dry-run`) |
| **Exact code rollback target to restore today's live state** | The current running dev container itself (untouched). Merged code baseline is `0a9affac`, but the container's exact commit is unproven, so "restore today's state" = "leave the current container running / restart the same image." |
| Target preservation | Only as the **running container** (+ persistent state on `/dev/sda1`). Not preserved as a proven immutable release. |
| Database rollback required (for Step 1) | **No** — nothing was changed. |
| Release-directory rollback mechanism exists | **No** (`/opt/blackspire-command` absent). |

## 8. Unresolved uncertainties

1. The **exact commit of the running API/worker container is unknown** (no `.git` in `/app`).
2. It is therefore **unproven** whether the running container already contains merged main
   `0a9affac` / the Jarvis release, though the Jarvis route responds 200.
3. The current live runtime is **development-mode with provider + Telegram credentials present** in
   its environment — this is NOT the production no-provider profile. Any future production runtime
   is a separate, not-yet-provisioned deployment.
4. Host-level 8787 is bound on `0.0.0.0`; external network reachability depends on cloud/edge
   controls not visible from this host.

## 9. Mutation statement

**No host or production mutation occurred.** This step performed read-only inspection and created
only this sanitized evidence note on a local documentation branch. No users/groups, directories,
permissions, packages, proxy/TLS, systemd, firewall, DNS, database, Telegram, credentials, Vercel,
or production state were changed. Nothing was pushed and no PR was opened.
