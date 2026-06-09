# BLACKSPIRE HELIX GROUP

## Complete System Reference For `blackspirehelix.com`

This document is a front-to-back reference of the Blackspire Helix website and operating platform as it currently exists in the codebase. It is written so it can be pasted into ChatGPT as high-context project documentation.

---

## 1. What Blackspire Helix Is

BLACKSPIRE HELIX GROUP is not just a marketing website. It is a branded public-facing site plus a multi-system operational platform.

At a high level, it has two layers:

1. The public website at `blackspirehelix.com`
2. The internal and semi-internal product systems that power Blackspire's business workflows

The brand thesis is:

- luxury AI systems
- dark, cinematic, premium presentation
- operator-first tooling
- multiple business divisions under one parent ecosystem
- real-world workflow execution, not just brochure pages

The parent brand is:

- Name: `BLACKSPIRE HELIX GROUP`
- Tagline: `Building AI Employees for Modern Businesses`

The site is structured like a command center for an AI systems company, with each division functioning like its own branded product.

---

## 2. Core Purpose Of The Website

The website serves several jobs at once:

- present the Blackspire parent company brand
- explain each ecosystem division
- route visitors into specific products and workspaces
- provide demo and service information
- support lead capture and contact workflows
- host real working software for Blackspire's internal and client-facing operations

It is best understood as a hybrid of:

- luxury company website
- internal operating system
- product ecosystem portal
- workflow dashboard platform

---

## 3. Current Tech Stack

Frontend stack:

- Next.js App Router
- React
- TypeScript
- Tailwind CSS
- custom theme token system in global CSS

Data/backend stack:

- Supabase for database and auth
- Next.js API routes for server logic
- Stripe integration in Recon Engine
- CSV import pipelines
- PDF and ZIP generation utilities

AI/workflow stack:

- OpenAI/LLM-ready integration surfaces
- AI-generated summaries, outreach drafts, and dossier generation
- workflow dispatch and automation hooks for buyer/recon operations

Supporting libraries currently present:

- `@supabase/supabase-js`
- `stripe`
- `pdf-lib`
- `adm-zip`
- `playwright-core`

---

## 4. Design System And Brand Logic

The design direction is intentionally dark luxury:

- black
- charcoal
- metallic tones
- controlled neon accents
- cinematic gradients
- branded per-division theme overlays

The site does not use one universal palette everywhere anymore. Each ecosystem division has its own theme derived from its logo colors.

Important theme behavior:

- the homepage uses the parent Blackspire Helix brand
- each ecosystem division page uses its own division color scheme
- the division page background also reflects that division's palette
- each division page can show a large translucent logo motif in the background, similar to the parent motif treatment on the homepage

Theme routing is controlled by:

- `frontend/src/lib/division-theme.ts`
- `frontend/src/lib/ecosystem.ts`
- global theme token overrides in `frontend/src/app/globals.css`

The key idea is that the ecosystem registry is the source of truth for logo-derived branding, and division pages inherit color and accent tokens from that registry.

---

## 5. Top-Level Site Architecture

The site has several major content and application zones.

### Public marketing and company pages

- `/`
- `/about`
- `/contact`
- `/services`
- `/industries`
- `/demos`
- `/ecosystem`
- `/ecosystem/[slug]`

### Real estate division hub

- `/real-estate-intelligence`
- `/real-estate-intelligence/[slug]`

### Product and workspace surfaces

- `/seller-engine`
- `/buyers`
- `/searches`
- `/searches/new`
- `/workspace/buyer-engine`
- `/workspace/deal-engine`
- `/workspace/deal-engine/[dealId]`
- `/workspace/deal-engine/[dealId]/packet`
- `/workspace/nexus`
- `/workspace/skip-trace-engine`
- `/workspace/helix-lawn-command`
- `/workspaces`
- `/workspaces/buyer-engine`
- `/workspaces/deal-engine`
- `/workspaces/nexus`
- `/workspaces/nexus/contacts`
- `/workspaces/nexus/leads`
- `/workspaces/nexus/logs`
- `/workspaces/nexus/settings`
- `/workspaces/seller-engine`

### Recon Engine

- `/recon-engine`
- `/recon-engine/[industry]`
- `/recon-engine/account`
- `/recon-engine/dashboard`
- `/recon-engine/login`

### Helix Lawn Command

- `/helix-lawn-command`
- `/lawn-command`

### Admin surfaces

- `/admin`
- `/admin/buyer-groups`
- `/admin/county-sources`
- `/admin/recon`

### Auth surfaces

- `/auth`

---

## 6. Global Navigation Model

The navigation is built around four major buckets:

### Overview

- Home
- Ecosystem
- Workspaces

### Real Estate

- Real Estate Intelligence
- Seller Engine
- Nexus
- Deal Engine
- Buyer Engine

### Products

- Recon Engine
- Helix Lawn Command
- Demos
- Services
- Industries

### Company

- About
- Contact

This navigation structure exists in:

- `frontend/src/lib/site-structure.ts`

That same file also defines the workspace launch surface used to present internal tools as operator systems.

---

## 7. Ecosystem Model

The ecosystem is the master registry for Blackspire divisions. This is one of the most important architectural concepts in the repo.

Source of truth:

- `frontend/src/lib/ecosystem.ts`

This registry defines:

- division slug
- name
- role
- tagline
- description
- brand colors
- surface tints
- edge/glow/accent behavior
- public page link
- workspace/product link
- lifecycle status

### Live divisions

1. `recon-engine`
2. `buyer-engine`
3. `seller-engine`
4. `deal-engine`
5. `nexus`
6. `helix-lawn-command`

### Building divisions

1. `social-os`
2. `ember-halo`
3. `oracle-helix`

This ecosystem file is used to drive:

- public ecosystem listings
- division detail pages
- color theme inheritance
- link routing
- workspace launch cards
- brand-consistent UI accents

---

## 8. Real Estate Intelligence Suite

Blackspire's real estate ecosystem is a pipeline, not a set of isolated tools.

The current real estate pipeline is:

1. Seller Engine
2. Nexus
3. Deal Engine
4. Buyer Engine

This suite is modeled in:

- `frontend/src/lib/real-estate-intelligence.ts`

That module acts as a central description layer for the real estate systems and also provides a combined operational snapshot across them.

### Real estate business logic

The real estate division is designed to move a property opportunity from raw seller signal to buyer disposition.

Flow:

1. Seller Engine discovers or imports motivated seller records
2. Nexus resolves contact information and decision-maker confidence
3. Deal Engine analyzes the opportunity and prepares the assignment/disposition package
4. Buyer Engine identifies likely investors and creates outreach outputs
5. closed transaction becomes the end-state

The real estate hub can surface metrics such as:

- seller leads found
- contacts enriched
- deals analyzed
- buyer matches
- projected assignment fees
- closed transactions

---

## 9. Seller Engine

### What it is

The Seller Engine is the motivated seller intelligence system.

Its job is to find, import, score, organize, and qualify seller-side property leads for wholesale real estate operators.

This is not a texting/calling engine. It is the intelligence and qualification layer that prepares lead records for downstream action.

### Core responsibilities

- manual CSV imports from county/public record sources
- live source search when a user initiates a search
- county source registry management
- motivated seller scoring
- seller dossier generation
- alerting on high-priority or distress signals
- status and note management
- handoff to Nexus or Deal Engine

### Data sources the system is designed around

- county tax records
- GIS property data
- foreclosure lists
- probate lists
- tax delinquent lists
- absentee owner lists
- code violation lists
- vacancy lists
- public auction lists

### Main routes

- `/seller-engine`
- `/workspaces/seller-engine`
- `/admin/county-sources`

### Main server functions

From `frontend/src/lib/seller-engine-server.ts`:

- `listSellerLeads`
- `getSellerLeadDetail`
- `importSellerCsv`
- `updateSellerLead`
- `updateSellerWeights`
- `listSellerSources`
- `listBuyerCountyRegistrySources`
- `syncSellerSourcesFromBuyerRegistry`
- `createSellerSource`
- `bootstrapSellerCountyStarterSources`
- `toggleSellerSourceActive`
- `runSellerLiveSearch`
- `probeSellerSourceHealth`
- `generateSellerLeadSummary`
- `listSellerAlerts`

### Main API routes

- `/api/seller-engine/import`
- `/api/seller-engine/leads`
- `/api/seller-engine/search`
- `/api/seller-engine/settings`
- `/api/seller-engine/sources`
- `/api/seller-engine/summary`
- `/api/seller-engine/export`

### Seller lead scoring

The scoring model is 0 to 100+ style weighted motivation scoring.

Examples of score factors include:

- absentee owner
- long ownership duration
- tax delinquency
- foreclosure signal
- probate signal
- vacancy signal
- code violation signal
- high estimated equity
- multiple properties owned
- out-of-state owner

The system supports adjustable weights through settings so scoring is not hardcoded forever.

### Seller Engine output

The intended output is a clean qualified seller lead package containing:

- owner info
- property info
- motivation score
- motivation reasons
- notes and status
- dossier summary
- source data
- next recommended action

---

## 10. Nexus

### What it is

Nexus is the contact resolution and skip trace command layer.

It sits between seller discovery and deal execution.

Its job is to determine who the real decision maker is and enrich the lead with contact intelligence.

### Core responsibilities

- skip trace requests
- contact confidence scoring
- contact record storage
- owner/contact resolution
- bridging seller leads into actionable outreach posture

### Main routes

- `/workspace/nexus`
- `/workspaces/nexus`
- `/workspaces/nexus/contacts`
- `/workspaces/nexus/leads`
- `/workspaces/nexus/logs`
- `/workspaces/nexus/settings`
- `/workspace/skip-trace-engine`

### Main server functions

From `frontend/src/lib/nexus-server.ts`:

- `getNexusSnapshot`
- `runNexusSkipTrace`

### Database role

Nexus adds a contact-intelligence layer on top of seller leads, using dedicated contact and request tables so the seller lead can become an actual reachable target rather than just a property record.

---

## 11. Deal Engine

### What it is

The Deal Engine is the wholesale acquisition and disposition command system.

Its purpose is to turn a qualified seller opportunity into a structured deal, underwrite it, package it, coordinate the process, and prepare it for buyer-side disposition.

### Core responsibilities

- create deals from seller leads
- store seller conversation posture
- estimate ARV
- save analysis assumptions
- save contract terms
- rank buyer fit
- generate deal packets
- power deal room pages
- track investor interest
- coordinate closeout tasks

### Main routes

- `/workspace/deal-engine`
- `/workspace/deal-engine/[dealId]`
- `/workspace/deal-engine/[dealId]/packet`
- public deal room surfaces under `/deal-room/[slug]` if enabled in the app

### Main server functions

From `frontend/src/lib/deal-engine-server.ts`:

- `listDealEngineLeads`
- `listDealEngineSellerSignals`
- `listDealEngineBuyerSignals`
- `createDealFromSeller`
- `saveDealContractTerms`
- `saveDealAnalysis`
- `estimateDealArv`
- `launchBuyerSearchFromDeal`
- `createDealBuyerOutreachDraft`
- `saveDealPacket`
- `saveInvestorInterest`
- `saveDealStageUpdate`
- `saveInvestorFollowUp`
- `saveOperatorTask`
- `saveDealCoordination`
- `saveSellerOutreachDraft`
- `uploadDealDocument`
- `downloadDealDocument`
- `sendDealEmail`
- `saveDealOutreachExecution`
- `saveDealCloseout`
- `getDealEngineDealDetail`
- `getDealEngineDealRoomBySlug`
- `getDealEngineWorkspaceSnapshot`

### Main API routes

Representative routes include:

- `/api/deal-engine/create-from-seller`
- `/api/deal-engine/estimate-arv`
- `/api/deal-engine/save-analysis`
- `/api/deal-engine/save-contract`
- `/api/deal-engine/save-packet`
- `/api/deal-engine/create-buyer-draft`
- `/api/deal-engine/launch-buyer-search`
- `/api/deal-engine/document`
- `/api/deal-engine/upload-document`
- `/api/deal-engine/send-email`
- `/api/deal-engine/interest`
- `/api/deal-engine/task`
- `/api/deal-engine/coordination`
- `/api/deal-engine/update-stage`
- `/api/deal-engine/closeout`

### Operational position

The Deal Engine is the bridge between lead intelligence and monetization.

It is where a seller lead becomes a structured wholesale deal.

---

## 12. Buyer Engine

### What it is

The Buyer Engine is the investor-matching and outreach intelligence system.

It exists to search buyer records, generate investor fit reports, export buyer targets, and support outreach preparation.

### Core responsibilities

- buyer search jobs
- county and geographic targeting
- buyer group registry management
- investor report generation
- export record tracking
- outreach brief and draft generation
- workflow triggering for buyer search execution

### Main routes

- `/workspace/buyer-engine`
- `/workspaces/buyer-engine`
- `/buyers`
- `/searches`
- `/searches/new`
- `/admin/buyer-groups`

### Main server functions

From `frontend/src/lib/buyer-engine-server.ts`:

- `listSearchJobs`
- `getSearchJobById`
- `listSearchJobsByIds`
- `createSearchJob`
- `listBuyerReports`
- `listAllBuyerReports`
- `listExports`
- `createExportRecord`
- `listCountySourceRows`
- `listAdminCountySourceRows`
- `toggleCountySourceActive`
- `getLiveCountyCapabilities`
- `listBuyerGroupRegistry`
- `importBuyerGroupRegistryCsv`
- `syncDefaultBuyerGroups`
- `toggleBuyerGroupActive`
- `getBuyerGroupMatchForName`
- `listOutreachDraftRecords`
- `persistOutreachDraftRecord`
- `triggerBuyerEngineWorkflow`

### Main API routes

- `/api/buyer-groups`
- `/api/buyer-reports`
- `/api/buyer-summary`
- `/api/exports`
- `/api/outreach-brief`
- `/api/outreach-drafts`
- `/api/search-jobs`
- `/api/search-jobs/[id]/trigger`
- `/api/county-sources`

### Important architecture note

The buyer engine is also the origin point for county registry knowledge that can be synced into the seller engine. That means the county source ecosystem is partially shared, not fully isolated.

---

## 13. Recon Engine

### What it is

Recon Engine is Blackspire's opportunity intelligence system for government contracts, grants, vendor programs, and similar public/private opportunity discovery.

This is separate from the real estate pipeline.

### Core responsibilities

- opportunity scans
- lead scan creation
- ingest live opportunities
- generate proposal support
- support paid/user account flows
- admin reporting

### Main routes

- `/recon-engine`
- `/recon-engine/[industry]`
- `/recon-engine/account`
- `/recon-engine/dashboard`
- `/recon-engine/login`

### Main server functions

From `frontend/src/lib/recon-engine-server.ts`:

- `createLeadScan`
- `recordReconCheckout`
- `listRecentOpportunities`
- `getReconAdminMetrics`
- `generateProposalForBid`
- `listAlertRecipients`
- `ingestReconOpportunities`
- `ingestSamGovOpportunities`

### Main API routes

- `/api/recon-engine/lead-scan`
- `/api/recon-engine/checkout`
- `/api/recon-engine/stripe-webhook`
- `/api/recon/proposal`
- `/api/recon/account`
- `/api/recon/sign-in`
- `/api/recon/sign-up`
- `/api/recon/sign-out`
- `/api/cron/fetch-opportunities`
- `/api/cron/send-alerts`

### Billing/integration note

Recon includes Stripe-specific flows, which makes it one of the more productized and customer-facing systems in the platform.

---

## 14. Helix Lawn Command

### What it is

Helix Lawn Command is a local service business automation system tailored toward lawn-care operations.

It is a separate Blackspire division and is not part of the real estate intelligence pipeline.

### Core responsibilities

- lawn lead intake
- AI photo analysis
- service-business workflow posture
- local command dashboard behavior

### Main routes

- `/helix-lawn-command`
- `/lawn-command`
- `/workspace/helix-lawn-command`

### Main API routes

- `/api/helix-lawn-command/analyze-photo`
- `/api/helix-lawn-command/leads`

---

## 15. Admin And Auth Layer

### Admin functions

The admin area is where Blackspire operators manage system registries, operational toggles, and diagnostics.

Important admin routes:

- `/admin`
- `/admin/buyer-groups`
- `/admin/county-sources`
- `/admin/recon`

Admin concerns include:

- county source registry management
- buyer group registry management
- recon metrics
- auth bootstrap/system checks

### Auth routes

Blackspire also includes auth endpoints and bootstrapping logic through Next API routes.

Important auth APIs include:

- `/api/auth/bootstrap`
- `/api/auth/sign-in`
- `/api/auth/sign-out`
- `/api/auth/sign-up`
- `/api/auth/status`
- `/api/auth/change-password`

Supabase is the main auth/data backend currently represented in the app.

---

## 16. Database And Persistence Model

The database is organized around product domains, especially the real estate stack.

The current migration history in `frontend/supabase/migrations` shows the main persistent systems:

1. `001_seller_engine.sql`
2. `002_real_estate_intelligence_nexus.sql`
3. `003_deal_engine_persistence.sql`
4. `004_buyer_group_registry.sql`

There are also remote history placeholder migrations to align local history with remote Supabase migration state.

### Seller Engine tables

The seller engine migration creates or supports:

- `data_sources`
- `owners`
- `properties`
- `seller_scoring_settings`
- `seller_leads`
- `lead_scores`
- `lead_notes`
- `lead_status_history`
- `seller_alerts`

Important seller concepts in the schema:

- source registry
- owner records
- property records
- motivation scoring
- note history
- status changes
- alert generation
- sent-to-deal-engine handoff tracking

### Real estate intelligence and Nexus tables

The Nexus/real-estate migration creates or supports:

- `real_estate_engines`
- `nexus_contacts`
- `skip_trace_requests`
- `nexus_credit_usage`

It also expands owner/contact-related capabilities.

### Deal Engine tables

The deal persistence migration creates or supports:

- `deal_leads`
- `deal_analysis`
- `seller_conversations`
- `buyer_matches`
- `contracts`
- `deal_packets`
- `deal_rooms`
- `disposition_logs`

This persistence layer allows a seller lead to graduate into a full deal record with packaging and buyer-side activity.

### Buyer Engine tables

The buyer group migration creates:

- `buyer_group_registry`

The buyer engine also depends on search job, report, export, and county-source persistence patterns implemented through its server layer and connected backend tables.

### Security model

Multiple domain tables explicitly enable row level security in the migrations.

That means the intended architecture is not just raw table access. It is a protected application data model meant to be mediated through auth and server logic.

---

## 17. Data Flow Across The Real Estate Stack

This is the most important operational chain in the platform.

### Step 1. Seller discovery

Seller Engine ingests data from:

- CSV uploads
- county source registries
- live county/state search endpoints when initiated by users

The system normalizes the lead into owner, property, and seller lead records.

### Step 2. Seller qualification

The lead gets:

- motivation score
- motivation reasons
- source attribution
- notes
- statuses
- alerts
- AI seller summary or dossier

### Step 3. Contact resolution

Nexus uses skip trace and contact-resolution logic to determine:

- the decision maker
- contact confidence
- phone/email/contact posture

### Step 4. Deal conversion

A lead can be sent into Deal Engine where it becomes:

- a deal lead
- an underwriting record
- a contract posture
- a buyer packet
- a deal room
- a coordinated transaction workflow

### Step 5. Buyer disposition

Buyer Engine can be launched from the Deal Engine to:

- find investors
- rank likely buyer fit
- generate investor reports
- draft outreach materials
- support disposition workflows

This is why the site should be thought of as a connected operating environment rather than separate SaaS pages.

---

## 18. API Architecture

The backend is primarily implemented through Next.js API routes under:

- `frontend/src/app/api`

The API surface is product-oriented rather than generic.

Major API groups include:

- auth
- seller-engine
- deal-engine
- buyer-engine-related routes
- recon-engine
- helix-lawn-command
- nexus-related operations
- cron jobs
- exports and outreach helpers

This means the frontend and backend are living in the same Next.js application, with server behavior routed through App Router API endpoints.

---

## 19. AI And Automation Behavior

Blackspire is not currently a pure chat application. The AI is embedded into specific workflow functions.

Current AI-style behaviors across the platform include:

- seller lead summaries
- seller dossier generation
- outreach draft generation
- buyer brief generation
- recon proposal support
- AI photo analysis in Helix Lawn Command

The platform is better described as:

- an AI-assisted operations system

not:

- a generic chatbot website

Future agent-style orchestration could sit on top of these systems, but the current architecture is domain-specific and function-triggered.

---

## 20. File-Level Source Of Truth Areas

If someone needs to understand the app quickly, these are the highest-value files to read first:

### Brand and platform structure

- `frontend/src/lib/ecosystem.ts`
- `frontend/src/lib/real-estate-intelligence.ts`
- `frontend/src/lib/site-structure.ts`
- `frontend/src/lib/division-theme.ts`
- `frontend/src/app/layout.tsx`
- `frontend/src/app/globals.css`

### Seller Engine

- `frontend/src/lib/seller-engine.ts`
- `frontend/src/lib/seller-engine-server.ts`
- `frontend/src/lib/seller-county-sources.ts`
- `frontend/src/lib/seller-engine-demo.ts`

### Buyer Engine

- `frontend/src/lib/buyer-engine-server.ts`
- `frontend/src/lib/buyer-engine-data.ts`
- `frontend/src/lib/buyer-groups.ts`
- `frontend/src/lib/buyer-engine-browser.ts`
- `frontend/src/lib/outreach-drafts.ts`

### Deal Engine

- `frontend/src/lib/deal-engine.ts`
- `frontend/src/lib/deal-engine-server.ts`

### Nexus

- `frontend/src/lib/nexus-server.ts`
- `frontend/src/lib/skip-trace-engine.ts`
- `frontend/src/lib/tracerfy.ts`

### Recon Engine

- `frontend/src/lib/recon-engine.ts`
- `frontend/src/lib/recon-engine-server.ts`
- `frontend/src/lib/recon-engine-stripe.ts`

### Helix Lawn Command

- `frontend/src/lib/helix-lawn-command.ts`
- `frontend/src/lib/helix-lawn-command-server.ts`

### Database

- `frontend/supabase/migrations/001_seller_engine.sql`
- `frontend/supabase/migrations/002_real_estate_intelligence_nexus.sql`
- `frontend/supabase/migrations/003_deal_engine_persistence.sql`
- `frontend/supabase/migrations/004_buyer_group_registry.sql`

---

## 21. Operational Reality Of The Platform

Blackspire Helix is currently a living system with multiple active divisions, not a finished static brochure.

Important practical realities:

- the public site and the internal workspaces are tightly connected
- division branding is now meant to be page-specific, not one-size-fits-all
- the real estate stack is a pipeline
- the seller engine is the lead intelligence layer
- Nexus is the contact intelligence layer
- Deal Engine is the underwriting and execution layer
- Buyer Engine is the investor targeting and disposition layer
- Recon Engine is a separate opportunity intelligence business line
- Helix Lawn Command is a separate service-business automation business line

---

## 22. Best Mental Model For ChatGPT

If this project is being handed to ChatGPT, the best way to describe it is:

`blackspirehelix.com` is a luxury multi-division AI operations platform built in Next.js with Supabase. It includes a public brand site plus multiple real working systems inside the same application. The main operational real estate stack is Seller Engine -> Nexus -> Deal Engine -> Buyer Engine. Additional divisions include Recon Engine and Helix Lawn Command. The platform uses a central ecosystem registry for division metadata, brand colors, page routing, and theme inheritance. Each division page should match the specific logo palette of that division, including accents and background treatment. The app uses Next.js API routes for backend logic, Supabase for persistence/auth, CSV import flows, and AI-assisted summaries/drafts within domain workflows.`

---

## 23. Recommended Copy-Paste Prompt For ChatGPT

Use this if you want ChatGPT to understand the system before making changes:

```md
You are working on BLACKSPIRE HELIX GROUP, a luxury AI systems platform built in Next.js, TypeScript, Tailwind, and Supabase. This is not just a marketing site. It is a multi-division operating environment with public pages, workspace pages, API routes, database persistence, and product-specific workflows.

Core ecosystem divisions:
- Recon Engine
- Buyer Engine
- Seller Engine
- Deal Engine
- Nexus
- Helix Lawn Command

The real estate intelligence pipeline is:
Seller Engine -> Nexus -> Deal Engine -> Buyer Engine

Seller Engine handles motivated seller lead discovery, source imports, live county searches, scoring, alerts, and seller dossiers.
Nexus handles skip tracing and contact resolution.
Deal Engine handles underwriting, contract posture, buyer packets, deal rooms, investor interest, and close coordination.
Buyer Engine handles buyer searches, investor reports, outreach drafts, exports, and county/buyer-group registry workflows.
Recon Engine handles contracts/grants/vendor opportunity intelligence and includes account/billing flows.
Helix Lawn Command handles lawn business automation and AI-assisted lead/photo workflows.

The source of truth for ecosystem divisions and branding is `frontend/src/lib/ecosystem.ts`.
The source of truth for navigation/workspaces is `frontend/src/lib/site-structure.ts`.
The source of truth for real estate stack relationships is `frontend/src/lib/real-estate-intelligence.ts`.
The source of truth for per-division theme class/style behavior is `frontend/src/lib/division-theme.ts`.

When making UI changes:
- keep the dark luxury Blackspire feel
- preserve division-specific branding
- match each division page to that division's logo colors
- include strong background atmosphere, not flat filler
- treat the platform like a command center, not a generic SaaS dashboard

When making system changes:
- preserve the pipeline relationship between Seller, Nexus, Deal, and Buyer
- respect Supabase persistence and Next.js API route structure
- do not flatten the ecosystem into a single generic CRM
- think in terms of operator workflows and intelligence layers
```

---

## 24. Short Summary

Blackspire Helix is a premium multi-system AI business platform. The website is the shell, the ecosystem registry is the map, the real estate stack is the primary internal pipeline, and each division is meant to feel like its own branded command system inside one parent company.
