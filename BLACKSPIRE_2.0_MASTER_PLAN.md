# Blackspire Helix 2.0 — Master Plan

_Revisitable plan. Written from Fable-5's judgment. Sequenced by leverage; each
track is independently shippable. Pick up at the lowest unchecked item in
Track A._

## North Star

Blackspire Helix has two layers: the **business pipeline** (Seller → Deal →
Buyer → close = where the money is) and the **AI operator** (a cheap,
self-hosted, phone-drivable assistant = the means). 2.0 = a **Blackspire
Operator Console**: the pipeline runs reliably, surfaces the day's best deals to
your phone, and a capable-but-cheap agent helps you act. Four tracks, in
priority order: **A (pipeline)**, **B (phone deal digest)**, **C (agent
infra)**, **D (multi-agent task queue)**.

## Global engineering discipline (applies to EVERY code batch)

The "double-check + debug each section" rule, stated once so each step can just
say "apply the standard gate":

1. **Read before write.** Open the file, trace current behavior, reuse existing
   helpers. No edits based on assumption.
2. **Small batches.** One coherent change at a time; the project must still
   build after each.
3. **Static gate after each batch:** `cd frontend && npx tsc --noEmit && npx eslint .`
   — both must be clean (baseline today: both pass).
4. **Behavioral gate (the real double-check):** exercise the change against real
   data via the Supabase MCP (project `kchtrvfcixnimvxxctkj`), not just types.
   Every track names its specific behavioral check.
5. **DB safety:** for any data change, `SELECT` to preview the exact rows first,
   review, then change. Never hard-delete real leads — use a status/flag (soft
   delete). Keep multi-row writes reversible.
6. **Debug hooks:** add structured logging at each new integration boundary
   (webhook calls, comp queries, digest sends) so failures surface with inputs,
   not silently. Check `get_logs` / `get_advisors` (Supabase MCP) when debugging.
7. **Commit per increment → PR → keep `main` green.** Secret-scan every staged
   diff before commit.

---

## TRACK A — Deal Pipeline Reliability (do first: highest money-leverage)

### A1. Fix the Buyer Engine dispatch
- **Where:** `frontend/src/lib/buyer-engine-server.ts` → `triggerBuyerEngineWorkflow`
  (~L3215); webhook base from `getWebhookBaseUrl` (~L1597,
  `N8N_WEBHOOK_BASE_URL` default `https://cpearson0312.app.n8n.cloud/webhook`);
  failure persisted at ~L3370–3388.
- **Diagnose (in order):** (a) confirm `N8N_WEBHOOK_BASE_URL` is set in
  Codespaces/Vercel secrets; (b) `curl -i` the `/buyer-engine` webhook with a
  sample payload and read the status; (c) verify the n8n "buyer-engine" workflow
  is **active** (n8n disables workflows silently); (d) check for auth/header
  mismatch.
- **Fix:** make the trigger resilient — retry with backoff, persist the real
  HTTP status + body into `SearchJob.error_message`, add a manual
  **"re-dispatch"** action so a broken run can be re-kicked without recreating
  the job.
- **Double-check / debug:** re-dispatch Briargrove's search (`seller_lead_id` for
  2217 Briargrove Dr); confirm `SearchJob.status` transitions past "created" and
  `buyer_matches` rows populate. Log webhook request+response. If n8n is the
  blocker, fix the workflow in the n8n cloud console.

### A2. Real comp-based ARV (replace the signal-estimate)
- **Where:** `frontend/src/lib/deal-engine-server.ts` → `estimateArvFromSignals`
  (~L991–1050, currently `assessedValue × multiplier`) and MAO (~L822,
  `maoBase × 0.72`).
- **Fix:** add `estimateArvFromComps(property)` that queries **`CleanSale`**
  (22,250 rows) for comparable sold records — same `zip`/`city` + `property_type`,
  last ~12 months — computes a median sale price (or median $/sqft × subject
  sqft) and returns ARV + a **confidence** (comp count). Use comps when
  confidence is sufficient (≥3 comps), fall back to `estimateArvFromSignals`
  otherwise. Feed comp ARV into MAO.
- **Double-check / debug:** unit-test with Briargrove (Charlotte 28215) — compare
  comp ARV vs the current $282k signal figure; assert sane bounds; log comp-set
  size + comps used. Flag "low confidence" in the deal packet when <3 comps.

### A3. Purge/quarantine test & junk data
- **Targets seen:** `55 Test Loop` (Greensboro), `Unknown poster`,
  `Unknown property` (Rocky Mount) across `deal_leads` / `deal_analysis` /
  `seller_leads`.
- **Fix:** `SELECT` the exact junk rows first (owner names like `Unknown %`,
  addresses like `%Test%`); review; then set `status='archived_test'` (soft
  delete) rather than DELETE. Add a guard so obvious placeholders don't enter
  scoring.
- **Double-check:** row counts before/after; confirm zero real leads flagged.

### A4. Lead volume (top of funnel)
- **Where:** `seller-engine-server.ts` (sweep + `parseSellerCsv`),
  `seller-county-sources.ts`.
- **Fix:** confirm county sources reachable; make the sweep schedulable; provide
  a reliable CSV path for immediate volume.
- **Double-check:** a sweep run increases `seller_leads` and produces
  `lead_scores`; spot-check a new lead's score reasons.

---

## TRACK B — Phone Deal Digest (do second: makes "from my phone" pay off)

### B1. Scheduled daily pipeline run
- Compose existing pieces into one job: ingest (A4) → score → auto-underwrite top
  N with comp ARV (A2) → assemble a ranked "today's best deals" digest. Run via a
  scheduled trigger (cron) — a standalone runner or an n8n schedule reusing Track
  A plumbing.

### B2. Deliver the digest to your phone
- Reuse the Telegram channel from `telegram-aider-bridge.py` (or a simpler push):
  each morning, top 3–5 deals with address, distress signals, comp ARV +
  confidence, MAO, spread, and next action.
- **Double-check / debug:** dry-run the digest to yourself; verify numbers match
  the DB; confirm chunking under Telegram's 4096 limit; log every send.

### B3. Act from the digest
- Let a reply advance a lead ("skip-trace #2", "dispatch buyer search #1") — a
  thin command layer over existing server actions, allowlisted to your user ID
  (same security model as the bridge).
- **Double-check:** each command's effect confirmed in the DB before reporting
  success; unauthorized sender still silently ignored.

---

## TRACK C — Agent Infrastructure (do third: enabler, lower money-leverage)

### C1. Right-size the local coding model
- Swap the bridge's default from `hermes3:3b` to a **code-tuned** model
  (`qwen2.5-coder:7b`, or `:3b` on the smallest machines) — much better at Aider
  edits at similar cost. Keep Hermes for general chat.
  `HERMES_MODEL=qwen2.5-coder:7b bash scripts/setup-hermes-agent.sh`.
- **Double-check:** the num_ctx / map-tokens / edit-format fixes (already on
  `main`) still apply; run one real edit through the bridge and confirm a valid
  diff returns.

### C2. Optional pre-execution review in the bridge
- If desired, add Aider `ask`-mode → confirm → execute as a real two-phase gate
  (today the confirm gate only covers git history, not execution). Scope only if
  you want true pre-execution review.

### C3. Clarify the skills story (documentation, not code)
- Record plainly: the 40 skills are **Claude Code** skills; the local
  Hermes/Aider agent only consumes **`fable-mode`** via `.aider-conventions.md`.
  Set expectations so the bridge isn't asked to do frontier-level work.

---

## TRACK D — Shared Multi-Agent Task Queue (Codex + Aider/Hermes + Claude Code)

**Design choice and why:** a real message-broker/scheduler is over-engineering
for three CLI agents that each run in a different, often-ephemeral environment
(this sandbox, your Codespace, wherever Codex runs). The simplest thing that
actually works: a **shared table in Supabase** (already the system of record for
everything else) as the queue, plus a **small convention** each agent's CLI
invocation follows to claim/complete work. No new service, no daemon, no
always-on process — just a durable place all three agents "check in" with.

### D1. Schema
New table `agent_tasks` (Supabase project `kchtrvfcixnimvxxctkj`):
- `id uuid pk`, `title text`, `description text`
- `assigned_agent text` — one of `codex` | `aider` | `claude` | `any`
- `status text` — `pending` | `in_progress` | `blocked` | `done`
- `claimed_by text null`, `claimed_at timestamptz null`
- `result_notes text null`, `created_at`, `updated_at`
- RLS: service-role only (matches every other table's pattern).

### D2. Claim convention (no routing engine needed)
- Tasks are created with either a specific `assigned_agent` (you decide which
  agent should do it) or `any` (first agent to check claims it).
- Each agent's session, at the start of a work block, runs one query: "claim the
  oldest `pending` task where `assigned_agent` = mine OR `any`" — an atomic
  `UPDATE ... WHERE status='pending' AND (...) RETURNING *` so two agents can't
  double-claim.
- On finish: update `status`, write `result_notes` (what was done, what was
  verified — same double-check discipline as every other track).
- **This session (Claude Code) and Aider (via the bridge) can run this query
  directly through the Supabase MCP / a small script.** Codex needs the same
  query run from wherever Codex executes (your Codespace) — a short
  `scripts/agent-tasks.mts` (claim/list/complete) is the one piece of shared
  tooling to write, callable by any of the three.

### D3. What this deliberately does NOT do (scope discipline)
- No automatic "smartest agent for this task" routing — you (or whoever creates
  the task) decide `assigned_agent`. Automatic routing is a plausible 3.0, not
  now.
- No live agent-to-agent messaging — coordination is entirely through the
  table's state, which is simple to inspect, debug, and reason about.

### D4. Double-check / debug
- Create one test task assigned `any`; claim it from this session via Supabase
  MCP; confirm the atomic claim actually prevents double-claim (try claiming
  the same row twice, second should return 0 rows).
- Confirm `scripts/agent-tasks.mts` works standalone (list / claim / complete)
  before relying on it from Codex or the bridge.

---

## Sequencing & milestones

1. **Milestone 1 (Track A1–A3):** one real deal (Briargrove) goes green
   end-to-end — dispatch works, ARV is comp-verified, junk data gone.
2. **Milestone 2 (Track A4 + B):** leads flow in and a daily deal digest hits
   your phone.
3. **Milestone 3 (Track C):** the remote agent is genuinely useful for small
   changes with the right model.
4. **Milestone 4 (Track D):** the `agent_tasks` table exists and at least two of
   the three agents (this session + one other) have successfully claimed and
   completed a task through it.

## Known live-data facts (as of this plan)
- Supabase project: `kchtrvfcixnimvxxctkj` ("blackspire insight").
- `seller_leads` 163, `lead_scores` 419, `properties` 163, `owners` 142,
  `deal_leads` 4, `deal_analysis` 4, `CleanSale` 22,250, `RawSale` 100,023.
- Best real deal found: **2217 Briargrove Dr, Charlotte NC 28215** (probate +
  foreclosure; ARV/MAO auto-estimated, **not** comp-verified — see A2).
- Repo baseline healthy: `tsc --noEmit` + `eslint` both clean; scripts valid.

## How to revisit
Pick up at the lowest unchecked item in Track A. Each item is self-contained
with its file refs, fix, and its own double-check/debug step.
