# Blackspire Helix — Real Estate Workflow Reference

Compiled from a full pass over the repository: root-level reference docs, `memory/`,
`prospect-research-2026-06-02/`, `ember-halo/`, `frontend/`, git history, and one
unmerged-but-relevant commit (`BLACKSPIRE_2.0_MASTER_PLAN.md`, not on `main`). This
file is the single consolidated reference for **the real estate business** —
Blackspire Helix's sibling products (Ember Halo, Helix Lawn Command, Social OS,
Oracle Helix, Recon Engine) and generic dev-tooling docs are called out explicitly
where they intersect, but are not the subject of this file.

---

## 1. What the business is

Blackspire Helix Group is a **North Carolina real estate intelligence and
wholesaling automation platform**. The parent brand's positioning is "Building AI
Employees for Modern Businesses"; inside that ecosystem, the real estate product
line is the most mature, functional business:

> Blackspire Helix is a real estate intelligence platform targeting the North
> Carolina market, with two primary engines (Seller Engine, Buyer Engine) plus
> secondary modules (Deal Engine, and now Harvester and Sentinel).

**The core pipeline** (the actual money-making workflow):

```
Seller Engine → Nexus → Deal Engine → Buyer Engine → closed transaction
                    ↑
              Harvester (marketplace/social opportunity intake)
                    ↕
              Sentinel (cross-workspace command/alert layer)
```

1. **Seller Engine** finds motivated sellers (tax-delinquent, foreclosure,
   probate, absentee-owner, vacant, code-violation properties) across NC
   counties and scores them.
2. **Nexus** resolves the real decision-maker's contact info (skip trace).
3. **Deal Engine** turns a qualified lead into a structured wholesale deal:
   ARV/MAO estimate, contract terms, packets, deal rooms, closing coordination.
4. **Buyer Engine** finds and ranks likely cash-buyer/investor matches for a
   deal and drives outreach/disposition.
5. **Harvester** is a newer intake channel: OCR-driven ingestion of off-market
   deal posts (e.g. screenshotted Facebook posts) that creates seller leads and
   deals directly, and matches them against the real Buyer Engine buyer pool.
6. **Sentinel** is a cross-workspace "command intelligence" layer — an inbox /
   morning-brief / opportunity-feed / follow-up-queue that surfaces what needs
   attention across every engine from one place.

Everything lives inside one Next.js app (`frontend/`) — this is **not** a
separate marketing site plus a separate product; the brand/marketing pages and
the operational engines are the same codebase.

---

## 2. Tech stack & architecture

- **Frontend:** Next.js 16.2.6 (App Router), React 19.2.4, TypeScript 5.x,
  Tailwind 4.x. Package name `blackspire-buyer-engine` (v0.1.0, private) — a
  naming holdover from when the app was Buyer-Engine-only.
- **Database:** Supabase Postgres, project ID `kchtrvfcixnimvxxctkj`
  ("blackspire insight") — shared across the real estate schema and Ember
  Halo's separate `ember_halo` schema.
- **Automation:** n8n (cloud, `https://cpearson0312.app.n8n.cloud/webhook`) runs
  the Buyer Engine's county-data-fetch/scoring pipeline as a webhook-triggered
  workflow, called from the Next.js backend.
- **Other libs:** `@supabase/supabase-js` 2.106.1, Stripe 22.2.0 (Recon Engine
  billing, not real estate), `pdf-lib` 1.17.1 and `adm-zip` 0.5.17 (contract/deal
  packet generation), Playwright Core 1.60.0, OpenAI (AI summaries, dossiers,
  outreach drafts).
- **Env vars:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `N8N_WEBHOOK_BASE_URL`, `OPENAI_API_KEY`. (`STRIPE_*` and `ELEVENLABS_API_KEY`
  exist for Recon Engine / Social OS, not the real estate pipeline.)

### Database tables (Supabase migrations `frontend/supabase/migrations/001`–`004`)

`data_sources`, `owners`, `properties`, `seller_leads`, `lead_scores`,
`lead_notes`, `seller_alerts`, `real_estate_engines`, `nexus_contacts`,
`skip_trace_requests`, `nexus_credit_usage`, `deal_leads`, `deal_analysis`,
`seller_conversations`, `buyer_matches`, `contracts`, `deal_packets`,
`deal_rooms`, `disposition_logs`, `buyer_group_registry`, plus (per the app-facing
API surface) `SearchJob`, `BuyerReport`, `BuyerProfile`, `CountyDataSource`,
`SellerSource`, `SellerAlert`, `CleanSale`/`RawSale` (comparable-sale data), and
`agent_tasks` (proposed, see §10). RLS is enabled on multiple tables.

### Application surface (`frontend/src/app`)

Real-estate-relevant route groups: `api/buyer-engine`, `api/buyer-groups`,
`api/buyer-reports`, `api/buyer-summary`, `api/county-sources`,
`api/deal-engine` (very large — assignment-fee, closeout, commander, contract
templates, EMD, estimate-arv, interest, investor-follow-up, launch-buyer-search,
log-outreach, save-analysis/contract/packet/seller-draft, send-email, signature,
task, timeline, title-checklist, update-stage, upload-document),
`api/harvester` (approve, buyer-match, buyer-outreach, buyer-trace, create-deal,
create-seller-lead, duplicates, entities, extract, intake), `api/nexus/trace`,
`api/outreach-brief`, `api/outreach-drafts`, `api/search`, `api/search-jobs`,
`api/seller-engine` (bulk, export, import, leads, search, settings, sources,
summary), `api/sentinel` (follow-up-queue, inbox, morning-brief,
opportunity-feed). Pages: `/buyers`, `/searches/new`, `/seller-engine/new`,
`/deal-room/[slug]`, `/harvester`, `/real-estate-intelligence/[slug]`,
`/workspace(s)/{buyer-engine,deal-engine,harvester,nexus,property/[id],
seller-engine/new,sentinel,skip-trace-engine}`. Templates for approved contract
documents live in `frontend/src/templates/contracts/`.

---

## 3. Seller Engine

Motivated-seller intelligence layer. Explicit scope decision (from
`memory/DECISIONS.md`): **stay focused on lead discovery, scoring, dossier
intelligence, and clean handoff — do not add automated texting/calling to
Seller Engine.**

**Sources:** county tax records, GIS/ArcGIS data, foreclosure/probate/
tax-delinquent lists, absentee-owner lists, code-violation/vacancy lists, public
auctions. `SELLER_LIVE_SOURCE_KEYS` covers 98 keys: 8 statewide NC OneMap feeds,
2 county-blend feeds, 6 distress-specific county feeds (Cumberland foreclosure
sales/delinquent taxes, Forsyth foreclosure sales, Guilford foreclosure
research, Mecklenburg foreclosure properties/delinquent taxpayers), 4 special
absentee feeds (Wake, Beaufort, Granville, Sampson), and 78 wave 1–3
county-absentee-owner feeds covering nearly all of NC.

**Scoring weights** (0–100+): absentee owner 20, owned 10+ years 15, tax
delinquent 25, foreclosure 30, probate 25, vacant 20, code violation 15, high
equity 20, multiple properties 10, out-of-state owner 15.
**Categories:** ≥80 Hot Lead · 60–79 Warm Lead · 40–59 Watchlist · <40 Low
Priority.
**Lead statuses:** New → Reviewing → Skip Trace Needed → Contact Ready → Sent
to Deal Engine (or Dead Lead / Watchlist).

**Fetch pipeline (`runSellerLiveSearch`):** county blend fan-out or single
source → NC OneMap query (`services.gis.nc.gov`, filtered to county, absentee =
`mstate <> 'NC'`, `struct='Y'`, residential use codes) or a distress-specific
fetcher or the generic county-absentee fetcher, which checks the Supabase
`CountyDataSource` registry first, then a curated county ArcGIS endpoint, then
falls back to NC OneMap.

**County source tiers (`CountyDataSource` registry):** Tier 1 — ~50 counties
with curated county-specific ArcGIS hosts (e.g. Cumberland →
`gis.co.cumberland.nc.us`, Forsyth → `maps.co.forsyth.nc.us`, plus Guilford
county ArcGIS); Tier 2 — 16 counties on the NC OneMap statewide fallback; Tier 3
— Wake and Mecklenburg on dedicated hardcoded paths (bypass the generic fetch
entirely — their datasets are too large for the n8n timeout). `97` county
starter sources are documented with official GIS/tax-foreclosure portal URLs,
covering essentially the whole state.

**Research artifacts:** `tmp_*.html` files at the `frontend/` root are saved
copies of the actual public source pages used to build county integrations for
Cumberland, Forsyth, and Guilford — Cumberland's Sitefinity delinquent-tax grid
and tax-foreclosure-sales page; Forsyth's Tax Administration department page
and its Property Tax Foreclosure Sales + FAQ page; Guilford's GIS Online
Services hub (Primary Data Viewer, Open Data Hub, Parcel Research, Property
Sales Research Tools); and a NC tax-foreclosure law firm's (Ruff, Bond, Cobb,
Wade & Bethune) public foreclosure-listings/bidding-process page, last updated
June 3, 2026 at capture time.

---

## 4. Nexus (contact resolution / skip trace)

Sits between seller discovery and deal execution. Resolves the real
decision-maker for a property and enriches contact intelligence
(`nexus_contacts`, `skip_trace_requests`, `nexus_credit_usage`). Nexus contact
syncing was integrated directly into Deal Engine workflows (per
`memory/SESSION_LOG.md`, 2026-06-07 to 06-09).

---

## 5. Deal Engine

Where a seller lead becomes a structured wholesale deal.

- **ARV/MAO:** `estimateArvFromSignals` in `frontend/src/lib/deal-engine-server.ts`
  (~L991–1050) currently computes ARV as `assessedValue × multiplier`, and MAO
  as `maoBase × 0.72` (~L822) — a **signal estimate**, not comp-based. The
  live master plan (§10) calls this out as the single highest-leverage fix:
  add `estimateArvFromComps(property)` querying the `CleanSale` table
  (22,250 rows) for same-zip/city + property-type sales in the trailing ~12
  months, computing a median price (or median $/sqft), returning ARV plus a
  confidence score gated on comp count (≥3 comps to trust it), and feeding
  that into MAO. Deal packets should flag "low confidence" under 3 comps.
- **Contracts/packets:** approved contract templates in
  `frontend/src/templates/contracts/` (with `approved/`, `generated/`,
  `reference/` subfolders); PDF generation via `pdf-lib`; ZIP packaging via
  `adm-zip`.
- **Full API surface:** assignment fee calc, closeout, EMD (earnest money
  deposit) tracking, investor follow-up, contract save/signature, title
  checklist, timeline, document upload, outreach logging, buyer interest
  tracking — this is a much richer surface than the two-stage description in
  older docs suggests.
- **Data integrity fix already shipped:** deals are now linked back to their
  originating property + seller lead on creation (unified record — commit
  `36e4fbf`), and a unified **Property command hub** with a **Property Health
  Score** rolls up the whole pipeline per property (commit `0c49348`).

---

## 6. Buyer Engine

Investor-matching / outreach intelligence — the original product before the
ecosystem concept existed.

**Search job lifecycle:**
`New Search Form → POST /api/search-jobs` (validates fields, date range,
minPurchases 1–5, county launch-block) → `createSearchJob()` inserts a
`SearchJob` row (status `pending`) → non-blocking `triggerBuyerEngineWorkflow()`
POSTs to the n8n webhook → n8n fetches county ArcGIS parcel sales, normalizes
and dedupes, flags absentee/cash/LLC buyers, scores them, updates `SearchJob`
to `completed`, and inserts `BuyerReport` + `BuyerProfile` rows → the frontend
polls `/api/search-jobs`.

**Buyer scoring factors:** purchase count, is-cash-buyer (no mortgage/deed of
trust on record), is-LLC (name pattern `LLC`/`INC`/`CORP`), total spend →
composite 0–100 score.

**County date-format handling:** 8 different date encodings across counties.
**County verification overrides:** `approved` / `historical_only` / `blocked` /
`unknown` — ~70 counties approved, Craven and Macon blocked.
`fallbackCountySourceRows` (91 counties) provides an offline fallback dataset.

**`queryCuratedCountyEndpoint`** is a schema-agnostic ArcGIS field-alias parser
trying 50+ name variants per data category (parcel ID, owner name, mailing
address, city/state/zip, property address, sale date, building value/vacancy,
land use). Absentee flag = mailing state ≠ "NC". Epoch-millisecond sale dates
are auto-converted.

**The n8n workflow** (`blackspire-buyer-engine`, ID `VvMHSIbycYCx4CZN`, backed
up 2026-06-07, **active: true**, 14 nodes) implements exactly this pipeline:
`Receive Search` (webhook) → `Validate Payload` (requires `search_job_id`,
`state`, `county`, `property_type`, `date_range_start`, `date_range_end`) →
`If Valid?` → `Start Job` (writes directly to the Supabase REST API) →
`If DataSource Found?` → `Pull Sales Data` → `Normalize and Save Sales` →
`Process Score Save Buyers` → `Complete Job` → `Respond 200` (with `Fail
Validation`/`Respond 400` and `Fail No DataSource`/`Respond 500` branches).
**Note:** each Code node calls Supabase's REST API directly with an embedded
anon-role key — not the service-role secret, but still worth knowing before
this backup file is shared outside the team. The live master plan flags that
`N8N_WEBHOOK_BASE_URL` / active-workflow-state / auth mismatches are the
current #1 suspected cause of dispatch failures (§10, Track A1) — **the n8n
backup in `memory/` is dated 2026-06-07 and should be re-exported if the live
workflow has changed since.**

---

## 7. Harvester (marketplace/social opportunity intake)

A newer module (introduced per commit `2ddd757`) that ingests off-market deal
posts — e.g. a screenshotted Facebook post — via OCR, extracts the poster's
name and scans the whole image for contacts (commit `e1896c7`), and can create
a seller lead and/or a deal directly from that intake, or match it against
existing buyers. Important fix already shipped: Harvester's buyer matching was
corrected to query the **real Buyer Engine database as the source of truth**
rather than a stale/separate copy (commit `bffbdfe`). API surface:
`approve`, `buyer-match`, `buyer-outreach`, `buyer-trace`, `create-deal`,
`create-seller-lead`, `duplicates`, `entities`, `extract`, `intake`.

---

## 8. Sentinel (command intelligence layer)

A cross-workspace layer introduced in Phase 1 (commit `1cffdc3`) that surfaces
what needs attention across every engine: `follow-up-queue`, `inbox`,
`morning-brief`, `opportunity-feed`. Reachable from every workspace via a
consistent nav bar (commit `7e53fdb`).

---

## 9. Brand, ecosystem, and go-to-market

### Brand system

Premium/luxury/cinematic dark-mode visual language, established from a Buyer
Engine logo analysis (`BLACKSPIRE_BUYER_ENGINE_BRAND_SYSTEM.md`): monogram
power, spire/helix symbol, targeting reticle, world/grid halo, command
platform ring. Core palette: Void Black (`#050505`–`#0A0A0A`), Signal Gold
(`#D4AF37`), Buyer Engine Amber (`#FF8A00`). Each ecosystem division inherits
the black/luminous-accent template but gets its own accent-color translation
(`BLACKSPIRE_ECOSYSTEM_DIVISION_BRAND_SPECS.md`, `frontend/src/lib/
division-theme.ts`, `frontend/src/lib/ecosystem.ts`):

| Division | Accent colors | Real estate? |
|---|---|---|
| Blackspire Helix Group (parent) | Gold `#D4AF37` + Warm Silver `#C8C2B8` | Umbrella brand |
| Buyer Engine | Orange + Gold | **Yes** |
| Seller Engine / Deal Engine / Nexus / Harvester / Sentinel | Per-division themed, same visual family | **Yes** |
| Recon Engine | — | No (gov-contract/grant intelligence, Stripe-billed) |
| Helix Lawn Command | Command Green `#63D11F` + Gold | No (lawn-care business automation) |
| Blackspire Social OS | Purple `#9B5CFF` + Blue `#4D8DFF` | No (content automation) |
| Ember Halo | Ember Orange `#FF5A1F` + Red `#C92D1A` | No (luxury rose-delivery concierge commerce) |
| Oracle Helix | Blue `#4C7DFF` + Violet `#7A63FF` | No (sports intelligence) |

`BLACKSPIRE_HELIX_PARENT_SITE_IMPLEMENTATION_PLAN.md` documents the decision
to build the parent marketing site **inside** the existing `frontend/` app
rather than as a second site, since Buyer Engine was already a live product
there — priority order for division landing pages puts Buyer Engine first
(it has a real product surface) and Ember Halo last.

### Go-to-market / prospecting (`prospect-research-2026-06-02/`)

A June 2, 2026 B2B prospecting exercise: identifying NC wholesalers/investors
as *customers* of the Buyer Engine product (not property leads). Materials:

- **Facebook page post drafts** — two posts pitching Buyer Engine to
  "wholesalers, investors, acquisitions teams, and dispo operators" around
  seller qualification, buyer organization, lead scoring, automated
  follow-up, and pipeline visibility. Tagline: *"More systems. Less chaos.
  More coming soon."*
- **15 personalized outreach drafts** (explicitly marked "drafts only — do not
  auto-send") targeting named NC investors/wholesalers (e.g. Atlantis
  Homebuyers/Raleigh, New South Property Solutions/Greensboro, Ogburn
  Properties/Winston-Salem, Maverick Property Group/Concord, Turner Home
  Team/Fayetteville, Harmony Home Buyers/statewide, Travis Buys Homes/Charlotte,
  919 Home Buyers/Raleigh, OffersMade Inc./Winston-Salem, plus several sourced
  from Facebook investor-group posts), each customized to the business/market
  and pitching specific Buyer Engine capabilities.
- **5 wholesaler DM drafts** targeting wholesalers found via off-market/
  assignment-of-contract Facebook posts.
- **Three CSVs** (`facebook_group_leads.csv` — 6 rows, `facebook_wholesaler_
  targets.csv` — 5 rows, `master_prospect_spreadsheet.csv` — 27 rows, all
  sharing a consistent schema: contact/business fields, evidence-of-activity
  fields, **Buyer Engine Fit Score**, **Lead Score**, **Priority**, **Demo
  Recommended**, **Suggested Follow-Up Angle**). This is a repeatable B2B
  sales-qualification methodology, separate from the Seller Engine's actual
  property-seller-lead pipeline. (Row-level PII — personal phone numbers and
  emails — intentionally omitted from this summary.)

### Social/marketing (parent brand, not real-estate-specific)

`INSTAGRAM_DAY_1_REEL_PACKAGE_BLACKSPIRE_HELIX.md`,
`INSTAGRAM_GROWTH_PLAN_BLACKSPIRE_HELIX_2026-06.md`, and
`RECENT_VIRAL_HASHTAG_RESEARCH_FOR_CHATGPT_2026-05.md` cover the
`@blackspirehelixgroup` account's content strategy generally ("AI employees
that automate growth, leads, and operations 24/7") — relevant to the company
brand, not specific to the real estate workflow.

---

## 10. Current state: Blackspire Helix 2.0 Master Plan

**Not on `main`** — added in commit `86bb8ce` (2026-07-13) on branch
`claude/geminara-part-one-production-rpi8a7`, never merged via its own PR. This
is the most current, ground-truth technical plan for the pipeline and is
reproduced here in full because of its direct relevance.

**North star:** *"Blackspire Helix has two layers: the business pipeline
(Seller → Deal → Buyer → close = where the money is) and the AI operator (a
cheap, self-hosted, phone-drivable assistant = the means)."* Four
independently-shippable tracks, in priority order:

**Track A — Deal pipeline reliability (highest money-leverage, do first)**
1. **A1. Fix Buyer Engine dispatch** — `triggerBuyerEngineWorkflow` in
   `frontend/src/lib/buyer-engine-server.ts` (~L3215); diagnose
   `N8N_WEBHOOK_BASE_URL` config, curl the webhook directly, confirm the n8n
   workflow is active (n8n disables workflows silently), check auth/header
   mismatches. Fix: retry with backoff, persist real HTTP status/body to
   `SearchJob.error_message`, add a manual "re-dispatch" action.
2. **A2. Real comp-based ARV** — replace the assessed-value-multiplier
   estimate with `estimateArvFromComps` querying `CleanSale` (22,250 rows) for
   real comparable sales, with a confidence score gated on comp count.
3. **A3. Purge/quarantine test data** — junk rows like `55 Test Loop`
   (Greensboro), `Unknown poster`/`Unknown property` (Rocky Mount) in
   `deal_leads`/`deal_analysis`/`seller_leads`; soft-delete via a status flag,
   never hard-delete real leads.
4. **A4. Grow lead volume** — confirm county sources are reachable, make the
   seller sweep schedulable, ensure a reliable CSV ingestion path.

**Track B — Phone deal digest (do second)**
1. **B1.** A scheduled daily job: ingest → score → auto-underwrite top N with
   comp ARV → assemble a ranked "today's best deals" digest.
2. **B2.** Deliver it over the existing Telegram channel (the same bridge used
   for coding-agent control, see §11) — top 3–5 deals each morning with
   address, distress signals, comp ARV + confidence, MAO, spread, next action.
3. **B3.** Let a Telegram reply advance a lead ("skip-trace #2", "dispatch
   buyer search #1") through a thin, allowlisted command layer.

**Track C — Agent infrastructure (enabler, lower leverage)**
1. **C1.** Swap the local coding-agent bridge's default model from
   `hermes3:3b` to a code-tuned model (`qwen2.5-coder:7b` or `:3b`).
2. **C2.** Optionally add a true pre-execution review gate to the bridge
   (today's confirm gate only covers the git-commit step, not execution).
3. **C3.** Document clearly that the 40 Claude Code skills are separate from
   what the local Hermes/Aider agent can consume (only `fable-mode` via
   `.aider-conventions.md`).

**Track D — Shared multi-agent task queue**
A new Supabase table `agent_tasks` (`id`, `title`, `description`,
`assigned_agent` [`codex`|`aider`|`claude`|`any`], `status`
[`pending`|`in_progress`|`blocked`|`done`], `claimed_by`, `claimed_at`,
`result_notes`) lets Codex, Aider/Hermes, and Claude Code claim and complete
work via one atomic `UPDATE ... WHERE status='pending' ... RETURNING *` query
— deliberately no message broker, no routing engine, no agent-to-agent
messaging; just a shared, inspectable state table.

**Global engineering discipline** applied to every batch in this plan: read
before write, small batches, static gate (`cd frontend && npx tsc --noEmit &&
npx eslint .`), behavioral gate against real data via the Supabase MCP
(preview with `SELECT` before any write, soft-delete only), structured logging
at every new integration boundary, commit-per-increment with secret-scanning.

**Known live-data facts as of this plan (2026-07-13):**
- `seller_leads` **163**, `lead_scores` **419**, `properties` **163**,
  `owners` **142**, `deal_leads` **4**, `deal_analysis` **4**,
  `CleanSale` **22,250**, `RawSale` **100,023**.
- Best real deal in the pipeline: **2217 Briargrove Dr, Charlotte NC 28215**
  (probate + foreclosure signals; ARV/MAO currently auto-estimated, **not yet
  comp-verified** — this is the concrete test case for Track A2).
- Repo baseline healthy: `tsc --noEmit` and `eslint` both clean.

**Milestones:** M1 = one real deal (Briargrove) goes green end-to-end
(dispatch fixed, ARV comp-verified, junk data purged). M2 = leads flow in and a
daily digest hits your phone. M3 = the remote coding agent is genuinely useful.
M4 = `agent_tasks` exists and at least two agents have claimed/completed a task
through it.

---

## 11. Related tooling (not the business itself, but used to run/build it)

- **Telegram bridge** (`TELEGRAM_BRIDGE_SETUP.md`,
  `scripts/telegram-aider-bridge.py`, `scripts/start-telegram-bridge.sh`) — a
  personal dev-productivity tool that lets the repo owner drive the Aider
  coding assistant from their phone via an allowlisted Telegram user ID. Aider
  runs `--yes-always` (edits/executes immediately on message receipt);
  `--no-auto-commits` only gates the subsequent `git commit` (diff shown,
  explicit yes/no reply required; a "no" runs `git checkout --` +
  `git clean -fd`). This is **not** a real-estate business workflow component
  today, but Track B of the 2.0 master plan (§10) proposes reusing this exact
  channel to deliver the daily deal digest.
- **`memory/` sync protocol** (`AI_WORKSPACE_SYNC.md`, `WORKFLOW.md`,
  `PROJECT_CONTEXT.md`) — the cross-device (desktop Codex, desktop VS Code,
  Codespaces, Claude/Codex sessions) shared-memory convention that keeps
  `AGENTS.md`, `PROJECT_CONTEXT.md`, `AI_WORKSPACE_SYNC.md`, and the four
  `memory/*.md` files as required startup reading for every agent session,
  and requires committing updates back on success. Generic engineering
  workflow, not real-estate business content itself, but this is *how* all of
  the above product work gets tracked and handed off between sessions.

## 12. Explicitly NOT part of the real estate workflow

For clarity, since they share the repo, the parent brand, and (partly) the
Supabase project:

- **Ember Halo** — luxury rose-delivery concierge commerce (Twilio SMS, Stripe
  Connect, its own `ember_halo` Supabase schema, Anthropic-powered chat
  concierge "Nyla"). Zero functional overlap with the real estate pipeline.
- **Helix Lawn Command** — lawn-care service-business automation with AI photo
  analysis.
- **Blackspire Social OS** — content/social-media automation product.
- **Oracle Helix** — sports intelligence product.
- **Recon Engine** — government contract/grant/vendor opportunity intelligence,
  Stripe-billed.
- **Blackspire Command** (`BLACKSPIRE_COMMAND_*.md`, `apps/`, `packages/`) — a
  separate local-first AI task-orchestration system (Hermes orchestrator,
  Telegram/Jarvis operator surfaces, SQLite task engine) built as its own
  product, unrelated to the real estate pipeline.
- **Book Studio** (Geminara audiobook production pipeline) — unrelated media
  project sharing the same repo and memory-sync conventions.

---

## 13. Historical evolution (from git log)

The product began narrowly and grew into the current multi-engine platform:

1. `4e37c5e` **Build Blackspire buyer engine operator app** — founding commit.
2. `70391a7` Deploy Blackspire buyer engine frontend.
3. `1950b74` Block unhealthy buyer engine sources — early data-quality gating.
4. `36f4242` Add buyer engine admin and AI summary tools.
5. `ecf351b` → `e1c6cca` Parent-brand watermark added, Buyer-Engine-specific nav
   removed — the pivot from "Buyer Engine is the whole site" to "Blackspire
   Helix Group is the parent brand, Buyer Engine is one workspace."
6. `0fefa32` Recon Engine customer accounts (isolated from operator auth).
7. `72074d9` → `126d017` → `6ac4998` Per-division color theming, visual-parity
   pass, mobile/desktop responsive optimization.
8. `3b3d09b` Expand seller county coverage and investor follow-up controls.
9. `6d49bf9` Add Deal Engine workspace and investor deal room.
10. `23d8151` Complete per-division theming for Deal + Seller Engine.
11. `2ddd757` **Harvester division** — marketplace opportunity intake (finish
    + deploy).
12. `e1896c7` Harvester OCR captures poster name + scans whole image for
    contacts.
13. `1cffdc3` **Sentinel Phase 1** — command intelligence layer.
14. `0c49348` Unified Property command hub + Property Health Score.
15. `bffbdfe` Fix: Harvester buyer matching uses the real Buyer Engine database
    as source of truth.
16. `5e6b900` Opportunity Score badge on Seller Engine lead dossier.
17. `36e4fbf` Fix: link deals to property + seller lead on creation (unified
    record).
18. `7e53fdb` Consistent cross-workspace nav bar (Sentinel reachable from
    every workspace).
19. `d4b0148` Beta program — cockpit, seller sweep route, rate limits,
    feedback, demo.
20. `4136e58` docs: add full technical reference for Blackspire Helix Group
    (`BLACKSPIRE_HELIX_FULL_REFERENCE.md`).
21. `6b22f03` Comprehensive mobile optimization across all engine shells and
    marketing pages.
22. `86bb8ce` **Blackspire Helix 2.0 master plan** (§10) — most recent,
    currently unmerged into `main`.

---

## 14. Key file index

| Area | Path |
|---|---|
| Ecosystem/division registry | `frontend/src/lib/ecosystem.ts`, `frontend/src/lib/division-theme.ts` |
| Buyer Engine server logic | `frontend/src/lib/buyer-engine-server.ts` |
| Deal Engine server logic | `frontend/src/lib/deal-engine-server.ts` |
| Seller Engine server logic | `frontend/src/lib/seller-engine-server.ts` (referenced), `seller-county-sources.ts` |
| Contract templates | `frontend/src/templates/contracts/{approved,generated,reference}` |
| Matching logic | `frontend/src/lib/matching/` |
| DB migrations | `frontend/supabase/migrations/001_seller_engine.sql` … `004_buyer_group_registry.sql` |
| Business/tech reference | `BLACKSPIRE_HELIX_COMPLETE_SYSTEM_REFERENCE.md`, `BLACKSPIRE_HELIX_FULL_REFERENCE.md` |
| Brand system | `BLACKSPIRE_BUYER_ENGINE_BRAND_SYSTEM.md`, `BLACKSPIRE_ECOSYSTEM_DIVISION_BRAND_SPECS.md` |
| Parent site plan | `BLACKSPIRE_HELIX_PARENT_SITE_IMPLEMENTATION_PLAN.md` |
| 2.0 master plan (unmerged) | `BLACKSPIRE_2.0_MASTER_PLAN.md` at commit `86bb8ce` on `claude/geminara-part-one-production-rpi8a7` |
| Prospecting/outreach | `prospect-research-2026-06-02/` |
| n8n Buyer Engine workflow backup | `memory/n8n-blackspire-buyer-engine-backup-2026-06-07.json` |
| Persistent working memory | `memory/{ACTIVE_CONTEXT,DECISIONS,NEXT_ACTIONS,SESSION_LOG}.md` |
| County source research captures | `frontend/tmp_{cumberland,forsyth,guilford,rbcwb}_*.html` |
| Telegram bridge (dev tooling) | `TELEGRAM_BRIDGE_SETUP.md`, `scripts/telegram-aider-bridge.py`, `scripts/start-telegram-bridge.sh` |

---

*Compiled from the repository state on branch `claude/blackspire-final-merge-readiness`
plus one commit read directly from `claude/geminara-part-one-production-rpi8a7`
(`86bb8ce`, not merged into `main`). Personal contact details (phone numbers,
emails) from prospecting CSVs were intentionally omitted — only business names,
roles, cities, and the shared scoring schema are described.*
