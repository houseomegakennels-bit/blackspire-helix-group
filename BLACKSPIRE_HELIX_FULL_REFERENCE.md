# Blackspire Helix Group — Complete Technical Reference

> Generated 2026-06-10. Covers every subsystem, data model, routing layer, and integration in the frontend application.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Tech Stack](#2-tech-stack)
3. [Architecture Overview](#3-architecture-overview)
4. [Environment Variables](#4-environment-variables)
5. [Pages & Routes](#5-pages--routes)
6. [API Routes](#6-api-routes)
7. [Components](#7-components)
8. [Seller Engine](#8-seller-engine)
   - [Source Keys](#81-seller_live_source_keys)
   - [Source Definitions](#82-seller_live_sources)
   - [Scoring System](#83-scoring-system)
   - [Lead Statuses & Source Types](#84-lead-statuses--source-types)
   - [County Starter Sources](#85-county-starter-sources)
   - [Server-Side Fetch Layer](#86-server-side-fetch-layer)
   - [Import & Persistence](#87-import--persistence)
   - [Live Search Presets](#88-live-search-presets)
9. [Buyer Engine](#9-buyer-engine)
   - [County Metadata](#91-county-metadata)
   - [County Verification Overrides](#92-county-verification-overrides)
   - [Fallback County Source Rows](#93-fallback-county-source-rows)
   - [Workflow Definitions](#94-workflow-definitions)
   - [Search Job Lifecycle](#95-search-job-lifecycle)
   - [Buyer Scoring](#96-buyer-scoring)
   - [Helper Functions](#97-helper-functions)
10. [CountyDataSource Registry](#10-countydatasource-registry)
    - [Database Schema](#101-database-schema)
    - [Source Type Constraint](#102-source-type-constraint)
    - [County Endpoint Tiers](#103-county-endpoint-tiers)
    - [Runtime Routing](#104-runtime-routing)
11. [queryCuratedCountyEndpoint — Field Alias Catalog](#11-querycuratedcountyendpoint--field-alias-catalog)
12. [n8n Workflows](#12-n8n-workflows)
13. [Authentication](#13-authentication)
14. [Admin Features](#14-admin-features)
15. [Deal Engine](#15-deal-engine)
16. [Recon Engine](#16-recon-engine)
17. [Helix Lawn Command](#17-helix-lawn-command)
18. [Data Flow Diagrams](#18-data-flow-diagrams)
19. [Database Tables (Supabase)](#19-database-tables-supabase)

---

## 1. Overview

**Blackspire Helix Group** is a real estate intelligence platform targeting the North Carolina market. It runs two primary engines:

- **Seller Engine** — discovers motivated sellers, absentee owners, and distressed properties from NC county ArcGIS feeds, tax records, and foreclosure databases. Produces scored leads with status tracking.
- **Buyer Engine** — profiles recent real-property buyers from county parcel sale records. Finds repeat buyers, cash buyers, and LLC investors for deal-matching and outreach.

Secondary modules:
- **Deal Engine** — workspace for packaging properties and matching with buyers.
- **Recon Engine** — public-facing lead scan tool with Stripe-gated checkout.
- **Helix Lawn Command** — AI-assisted lawn-care lead generation sub-product.

The entire frontend is a Next.js 16 App Router application hosted on Vercel. Backend automation runs through n8n workflows with data persisted in Supabase (PostgreSQL).

---

## 2. Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | Next.js | 16.2.6 |
| UI runtime | React | 19.2.4 |
| Styling | Tailwind CSS | 4.x |
| Language | TypeScript | 5.x |
| Database | Supabase (PostgreSQL) | `@supabase/supabase-js` 2.106.1 |
| Automation | n8n (self-hosted) | cloud instance |
| Payments | Stripe | 22.2.0 |
| PDF generation | pdf-lib | 1.17.1 |
| ZIP handling | adm-zip | 0.5.17 |
| Browser automation | Playwright Core | 1.60.0 |
| Linter | ESLint | 9.x + `eslint-config-next` |

Package name: `blackspire-buyer-engine` (v0.1.0, private).

---

## 3. Architecture Overview

```
User Browser
     │
     ▼
Next.js App Router (Vercel)
     │
     ├── React Server Components (page.tsx files)
     │     └── prefetch data from Supabase on the server
     │
     ├── API Routes (/api/*)
     │     ├── seller-engine/* → seller-engine-server.ts (server-only)
     │     ├── search-jobs/*  → buyer-engine-server.ts (server-only)
     │     └── county-sources/* → CountyDataSource table
     │
     └── Client Components ("use client")
           └── poll API routes for live updates

seller-engine-server.ts
     │
     ├── fetchRowsForLiveSource()
     │     └── per-county wrapper fn → fetchGenericNcCountyAbsenteeRows()
     │           ├── getBuyerCountyRegistrySource() → CountyDataSource (Supabase)
     │           ├── queryCuratedCountyEndpoint() → county ArcGIS REST endpoint
     │           └── fallback → fetchNcOneMapAbsenteeRows() → services.gis.nc.gov
     │
     └── importSellerRows() → SellerLead table (Supabase)

buyer-engine-server.ts
     │
     ├── createSearchJob() → SearchJob table (Supabase)
     ├── triggerBuyerEngineWorkflow() → n8n webhook
     │
n8n Buyer Engine Workflow
     │
     ├── county fetch → ArcGIS parcel service
     ├── normalization + scoring
     └── persistBuyerReport() → BuyerReport + BuyerProfile tables (Supabase)
```

---

## 4. Environment Variables

| Variable | Used In | Purpose |
|---|---|---|
| `SUPABASE_URL` | server-only libs | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only libs | Supabase admin key (bypasses RLS) |
| `NEXT_PUBLIC_SUPABASE_URL` | client components | Supabase URL exposed to browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | client components | Supabase anon key for Realtime |
| `N8N_WEBHOOK_BASE_URL` | `search-jobs/route.ts` | n8n webhook base URL (default: `https://cpearson0312.app.n8n.cloud/webhook`) |
| `STRIPE_SECRET_KEY` | recon-engine checkout | Stripe server key |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook route | Webhook signature verification |
| `OPENAI_API_KEY` | helix-lawn-command | Photo analysis + script generation |
| `ELEVENLABS_API_KEY` | mod-voiceover workflow | Text-to-speech generation |

---

## 5. Pages & Routes

### Marketing / Public

| Route | File | Description |
|---|---|---|
| `/` | `app/page.tsx` | Home / landing page |
| `/about` | `app/about/page.tsx` | About page |
| `/services` | `app/services/page.tsx` | Services overview |
| `/industries` | `app/industries/page.tsx` | Industries served |
| `/ecosystem` | `app/ecosystem/page.tsx` | Ecosystem product map |
| `/contact` | `app/contact/page.tsx` | Contact page |
| `/demos` | `app/demos/page.tsx` | Demo pages |

### Application

| Route | File | Description |
|---|---|---|
| `/auth` | `app/auth/page.tsx` | Operator sign-in / sign-up |
| `/searches` | `app/searches/page.tsx` | Buyer Engine search job monitor |
| `/searches/new` | `app/searches/new/page.tsx` | Create a new buyer search job |
| `/seller-engine` | `app/seller-engine/page.tsx` | Seller lead management dashboard |
| `/buyers` | `app/buyers/page.tsx` | Buyer profiles view |
| `/workflows` | `app/workflows/page.tsx` | n8n workflow status monitor |
| `/workspace` | `app/workspace/page.tsx` | Operator workspace |
| `/deal-room` | `app/deal-room/page.tsx` | Deal room workspace |
| `/recon-engine` | `app/recon-engine/page.tsx` | Recon lead scan tool |
| `/lawn-command` | `app/lawn-command/page.tsx` | Helix Lawn Command |
| `/helix-lawn-command` | `app/helix-lawn-command/page.tsx` | Helix Lawn Command (alt path) |

### Admin

| Route | File | Description |
|---|---|---|
| `/admin` | `app/admin/page.tsx` | Admin dashboard |
| `/admin/county-sources` | `app/admin/county-sources/page.tsx` | CountyDataSource registry UI |
| `/admin/recon` | `app/admin/recon/page.tsx` | Recon admin panel |

---

## 6. API Routes

### Authentication

| Method | Route | Description |
|---|---|---|
| POST | `/api/auth/sign-up` | Create operator account |
| POST | `/api/auth/sign-in` | Sign in with email/password |
| POST | `/api/auth/sign-out` | Sign out current session |
| POST | `/api/auth/change-password` | Change password |
| GET | `/api/auth/status` | Check auth + bootstrap state |
| POST | `/api/auth/bootstrap` | Bootstrap first operator account |

### Buyer Engine

| Method | Route | Description |
|---|---|---|
| GET | `/api/search-jobs` | List search jobs; optional `?highlight={jobId}` for report rows |
| POST | `/api/search-jobs` | Create search job, trigger n8n workflow |
| POST | `/api/search-jobs/[id]/trigger` | Re-trigger an existing job |
| GET | `/api/buyer-summary` | Aggregate buyer stats |
| GET | `/api/county-sources` | List CountyDataSource rows |
| PATCH | `/api/county-sources` | Update a CountyDataSource row |
| GET | `/api/exports` | Export buyer data |

**POST /api/search-jobs — required fields:**

```json
{
  "title": "string",
  "state": "NC",
  "county": "string",
  "propertyType": "land | residential | commercial",
  "dateRangeStart": "YYYY-MM-DD",
  "dateRangeEnd": "YYYY-MM-DD",
  "minPurchases": 1,
  "notes": "optional string"
}
```

Validates: date range chronological, `minPurchases` 1–5 integer, county not launch-blocked.

### Seller Engine

| Method | Route | Description |
|---|---|---|
| POST | `/api/seller-engine/search` | Run a live seller source search |
| GET | `/api/seller-engine/leads` | List seller leads with filters |
| PATCH | `/api/seller-engine/leads` | Update lead status |
| GET | `/api/seller-engine/sources` | List seller source registrations |
| GET/PATCH | `/api/seller-engine/settings` | Scoring weights settings |
| GET | `/api/seller-engine/summary` | Lead pipeline summary stats |
| GET | `/api/seller-engine/export` | Export leads as CSV |
| POST | `/api/seller-engine/import` | Import leads from CSV |

**POST /api/seller-engine/search — body:**

```json
{
  "sourceKey": "SellerLiveSourceKey (optional)",
  "county": "string (required)",
  "city": "string (optional)",
  "limit": 25
}
```

Returns: `{ ok, imported, total, errors, sourceName, sourceDescription, sourceKey, blendedSourceKeys }`

Max duration: 60 seconds. Force-dynamic.

### Other

| Method | Route | Description |
|---|---|---|
| POST | `/api/outreach-drafts` | Generate outreach draft |
| POST | `/api/outreach-brief` | Generate outreach brief |
| GET/POST | `/api/recon/sign-up` | Recon user registration |
| POST | `/api/recon/sign-in` | Recon user sign-in |
| POST | `/api/recon/sign-out` | Recon sign-out |
| GET/PATCH | `/api/recon/account` | Recon account management |
| POST | `/api/recon/proposal` | Generate recon proposal |
| POST | `/api/recon-engine/lead-scan` | Run a lead scan |
| POST | `/api/recon-engine/checkout` | Stripe checkout session |
| POST | `/api/recon-engine/stripe-webhook` | Stripe event handler |
| POST | `/api/helix-lawn-command/analyze-photo` | AI lawn photo analysis |
| GET | `/api/helix-lawn-command/leads` | Lawn Command leads |
| POST | `/api/deal-engine/save-packet` | Save deal packet |
| POST | `/api/deal-engine/create-buyer-draft` | Create buyer outreach draft |
| POST | `/api/cron/send-alerts` | Cron: send alert notifications |
| POST | `/api/cron/fetch-opportunities` | Cron: pull new opportunities |

---

## 7. Components

Located at `frontend/src/components/`:

| Component | Description |
|---|---|
| `auth-panel.tsx` | Sign-in / sign-up form panel |
| `buyer-engine-home.tsx` | Buyer Engine landing/home view |
| `buyer-reports-monitor.tsx` | Live buyer report results display |
| `buyer-shell.tsx` | Outer shell layout for buyer pages |
| `county-sources-admin.tsx` | Admin UI for CountyDataSource registry |
| `deal-engine-actions.tsx` | Deal Engine action buttons |
| `deal-engine-deal-detail.tsx` | Deal detail view |
| `deal-engine-home.tsx` | Deal Engine home |
| `deal-engine-packet-view.tsx` | Deal packet display |
| `deal-engine-shell.tsx` | Outer shell for deal engine pages |
| `deal-room-interest-form.tsx` | Buyer interest submission form |
| `deal-room-public-view.tsx` | Public-facing deal room view |
| `division-watermark.tsx` | Blackspire division branding watermark |
| `ecosystem-card.tsx` | Ecosystem product card |
| `ecosystem-mark.tsx` | Ecosystem brand mark |
| `helix-lawn-command-home.tsx` | Lawn Command home view |
| `helix-lawn-command-page.tsx` | Lawn Command main page wrapper |
| `helix-lawn-intake-demo.tsx` | Lawn Command intake demo |
| `luxury-hero-stage.tsx` | Marketing hero section |
| `marketing-nav.tsx` | Marketing site nav |
| `marketing-shell.tsx` | Marketing page shell layout |
| `new-search-form.tsx` | New buyer search job form |
| `recon-account-panel.tsx` | Recon account management panel |
| `recon-auth-panel.tsx` | Recon sign-in/up panel |
| `recon-checkout-button.tsx` | Stripe checkout trigger button |
| `recon-dashboard.tsx` | Recon Engine dashboard |
| `recon-engine-lead-form.tsx` | Recon lead scan form |
| `search-jobs-monitor.tsx` | Live search job queue monitor |
| `seller-engine-dashboard.tsx` | Seller Engine full dashboard (client component) |
| `seller-engine-shell.tsx` | Outer shell for seller engine page |

---

## 8. Seller Engine

### 8.1 SELLER_LIVE_SOURCE_KEYS

98 source keys total, organized into groups:

#### Statewide NC OneMap Feeds (8)

| Key | Description |
|---|---|
| `nc_onemap_absentee_search` | Primary absentee owner sweep |
| `nc_onemap_legacy_absentee_search` | Legacy sales (pre-cutoff date) |
| `nc_onemap_high_value_absentee_search` | High assessed-value absentee properties |
| `nc_onemap_portfolio_absentee_search` | Portfolio / repeat-owner absentee |
| `nc_onemap_corporate_absentee_search` | Corporate/LLC absentee owners |
| `nc_onemap_legacy_portfolio_absentee_search` | Legacy portfolio absentee |
| `nc_onemap_motivated_seller_sweep` | Motivated-seller signal sweep |
| `nc_onemap_full_recon_sweep` | Full county recon sweep |

#### County Blend Feeds (2)

| Key | Description |
|---|---|
| `county_distress_blend` | Merges all distress-type sources for the given county |
| `county_operational_blend` | Merges all operational sources for the given county |

These two keys dynamically resolve to the set of active source keys for the requested county via `getCountyLiveSourceKeys()`, then fan out with `Promise.all`, merge by parcel ID, and rank results.

#### Distress-Specific County Feeds (6)

| Key | County |
|---|---|
| `cumberland_county_foreclosure_sales` | Cumberland |
| `cumberland_county_delinquent_taxes` | Cumberland |
| `forsyth_county_foreclosure_sales` | Forsyth |
| `guilford_county_foreclosure_research` | Guilford |
| `mecklenburg_county_foreclosure_properties` | Mecklenburg |
| `mecklenburg_county_delinquent_taxpayers` | Mecklenburg |

#### Special Absentee Feeds (4)

| Key | County | Seat |
|---|---|---|
| `wake_county_absentee_owners` | Wake | Raleigh |
| `beaufort_county_absentee_owners` | Beaufort | Washington |
| `granville_county_absentee_owners` | Granville | Oxford |
| `sampson_county_absentee_owners` | Sampson | Clinton |

#### Wave 1–3 County Absentee Owner Feeds (78)

Listed by geographic region:

**Foothills / Mountains West**
`stokes`, `stanly`, `wilkes`, `ashe`, `avery`, `burke`, `surry`, `caldwell`, `watauga`, `henderson`, `buncombe`, `haywood`, `cherokee`, `polk`, `rutherford`, `mcdowell`, `transylvania`, `yancey`, `cleveland`, `davie`, `yadkin`, `montgomery`, `jackson`, `macon`

**Triangle / Piedmont**
`durham`, `chatham`, `johnston`, `harnett`, `orange`, `granville` (also in special), `nash`, `edgecombe`, `person`, `franklin`, `vance`

**Charlotte Metro / Piedmont Triad**
`cabarrus`, `union`, `iredell`, `gaston`, `lincoln`, `rowan`, `davidson`, `alamance`, `randolph`, `catawba`

**Eastern / Coastal**
`new_hanover`, `brunswick`, `pender`, `onslow`, `craven`, `pitt`, `wayne`, `wilson`, `duplin`, `carteret`, `pamlico`, `chowan`, `pasquotank`, `currituck`, `dare`, `bladen`, `columbus`, `lenoir`, `robeson`, `warren`

**Other**
`rockingham`, `moore`, `lee`, `halifax`, `hoke`

All formatted as: `{county_name}_county_absentee_owners`

---

### 8.2 SELLER_LIVE_SOURCES

Array of objects, one per source key:

```typescript
{
  key: SellerLiveSourceKey;      // unique key string
  label: string;                 // human-readable display name
  description: string;           // longer description shown in UI
  sourceType: SellerSourceType;  // categorization
}
```

---

### 8.3 Scoring System

**DEFAULT_SELLER_SCORING_WEIGHTS:**

| Factor | Points |
|---|---|
| `absenteeOwner` | 20 |
| `ownedTenPlusYears` | 15 |
| `taxDelinquent` | 25 |
| `foreclosure` | 30 |
| `probate` | 25 |
| `vacant` | 20 |
| `codeViolation` | 15 |
| `highEquity` | 20 |
| `multipleProperties` | 10 |
| `outOfStateOwner` | 15 |

**Score Categories:**

| Range | Category |
|---|---|
| ≥ 80 | Hot Lead |
| 60–79 | Warm Lead |
| 40–59 | Watchlist |
| < 40 | Low Priority |

**Functions:**
- `calculateSellerLeadScore(input, weights)` → `{ score, category, reasons[] }`
- `getSellerLeadCategory(score)` → category name string
- `recommendedSellerAction(score, reasons)` → recommended next action string

**SellerScoreInput fields (all optional booleans/numbers):**
`isAbsenteeOwner`, `ownedTenPlusYears`, `isTaxDelinquent`, `hasForeclosure`, `isProbate`, `isVacant`, `hasCodeViolation`, `hasHighEquity`, `hasMultipleProperties`, `isOutOfStateOwner`

---

### 8.4 Lead Statuses & Source Types

**SELLER_LEAD_STATUSES:**

```
"New" | "Reviewing" | "Skip Trace Needed" | "Contact Ready" |
"Sent to Deal Engine" | "Dead Lead" | "Watchlist"
```

**SELLER_SOURCE_TYPES:**

```
"county_tax_records" | "gis_property_data" | "foreclosure" | "probate" |
"tax_delinquent" | "absentee_owner" | "code_violation" | "vacancy" |
"public_auction" | "blended_search"
```

---

### 8.5 County Starter Sources

`SELLER_COUNTY_STARTER_SOURCES` (97 entries) in `seller-county-sources.ts`.

Type definition:

```typescript
type SellerCountyStarterSource = {
  county: string;
  state: "NC";
  name: string;
  sourceType: SellerSourceType;
  sourceUrl: string;           // official county portal URL
  integrationType: "county_portal";
  notes: string;
};
```

Counties covered with official portal links:

| County | Sources |
|---|---|
| Mecklenburg | Open Mapping, Tax Foreclosure Properties |
| Wake | Open Data, CRPI Foreclosure Notices |
| Forsyth | CAD Parcels, Tax Foreclosure Sales |
| Guilford | GIS Online, Foreclosure Research |
| Cumberland | Real Estate GIS, Tax Foreclosure, Delinquent Taxes |
| Durham | GIS Parcel Viewer, Tax Foreclosure |
| Johnston | GIS Portal, Tax Foreclosure |
| Chatham | GIS Parcel Data |
| Harnett | Property Search |
| Cabarrus | GIS Parcel Search, Foreclosure Sales |
| Union | GIS Property Data, Tax Foreclosure |
| Iredell | GIS Parcel Viewer |
| Gaston | GIS Parcel Data, Tax Foreclosure |
| Alamance | Property Records |
| Randolph | GIS Property Data |
| Catawba | GIS Parcel Data, Tax Foreclosure |
| Buncombe | GIS Property Data, Tax Foreclosure |
| Henderson | GIS Parcel Data |
| New Hanover | GIS Data Downloads, Tax Foreclosure |
| Brunswick | GIS Property Data |
| Onslow | GIS Property Data |
| Pitt | GIS Property Data, Tax Foreclosure |
| Wayne | GIS Property Data |
| Moore | GIS Parcel Data |
| + 25 wave 3 counties | Single GIS Property Data portal entry each |

---

### 8.6 Server-Side Fetch Layer

**File:** `frontend/src/lib/seller-engine-server.ts` (~4,100 lines, `"server-only"`)

#### Key Types

```typescript
type LiveSellerSearchInput = {
  sourceKey?: SellerLiveSourceKey;
  county: string;
  city?: string;
  limit?: number;            // clamped 1–100, default 25
};

type SellerImportRow = Record<string, string>;
```

#### Function Hierarchy

```
runSellerLiveSearch(input)
  │
  ├── COUNTY_BLEND_SOURCE_KEYS check
  │     └── getCountyLiveSourceKeys() → parallel fetchRowsForLiveSource()
  │           └── mergeSellerRowsByParcel() + rankSellerRows()
  │
  └── fetchRowsForLiveSource({ sourceKey, county, city, limit })
        │
        ├── NC OneMap direct keys → fetchNcOneMapAbsenteeRows()
        ├── Blend keys → (handled above)
        ├── Distress keys → fetchCumberlandForeclosureRows(), fetchMecklenburgDelinquentRows(), etc.
        └── County absentee keys → fetch{County}CountyAbsenteeRows()
              └── fetchGenericNcCountyAbsenteeRows(input, countyName, defaultCity, sourceName)
                    ├── getBuyerCountyRegistrySource(countyName) → CountyDataSource (Supabase)
                    ├── queryCuratedCountyEndpoint(sourceUrl, opts) → SellerImportRow[]
                    └── fallback: fetchNcOneMapAbsenteeRows()
```

#### fetchNcOneMapAbsenteeRows

Queries `services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0`.

Filter logic:
- `cntyname = '{county}'`
- `mstate <> 'NC'` (absentee: mailing state is out of state)
- `struct = 'Y'` (has structure)
- `parusedsc2 LIKE 'RES%'` (residential use)

Additional filters per source key:
- `nc_onemap_legacy_absentee_search` — `saledate <= NC_ONEMAP_LEGACY_ABSENTEE_MAX_SALEDATE`
- `nc_onemap_portfolio_absentee_search` / `nc_onemap_corporate_absentee_search` / `nc_onemap_motivated_seller_sweep` — query limit multiplied ×4 for post-filter expansion

Output fields: `ownname`, `ownname2`, `mailadd`, `munit`, `mcity`, `mstate`, `mzip`, `siteadd`, `scity`, `parno`, `altparno`, `saledate`, `saledatetx`, `sourceref`, `struct`, `structno`, `parusedesc`, `cntyname`, `parval`, `landval`

#### resolveLiveSourceUrl

Maps each `SellerLiveSourceKey` to a URL string used for logging and source tracking:

- Direct distress keys → official county web portal URLs
- County absentee keys → `"buyer_registry:{CountyName}"` sentinel string (indicates CountyDataSource lookup)
- Default fallback → `"https://services.arcgis.com/04HiymDgLlsbhaV4/arcgis/rest/services/NCOneMap_Parcels/FeatureServer/79"`

---

### 8.7 Import & Persistence

`importSellerRows({ rows, sourceName, sourceType, county, integrationType, sourceUrl, configuration })`:

- Deduplicates by parcel ID
- Runs `calculateSellerLeadScore()` on each row
- Upserts to `SellerLead` table in Supabase
- Records import metadata (source, timestamp, config)

Returns: `{ imported, total, errors[] }`

---

### 8.8 Live Search Presets

Pre-configured search presets shown in the dashboard UI:

| Label | County | City | Source Key |
|---|---|---|---|
| Charlotte Distress Blend | Mecklenburg | Charlotte | `county_distress_blend` |
| Fayetteville Distress Blend | Cumberland | Fayetteville | `county_distress_blend` |
| Charlotte Operational Blend | Mecklenburg | Charlotte | `county_operational_blend` |
| Raleigh Operational Blend | Wake | Raleigh | `county_operational_blend` |
| Charlotte Full Sweep | Mecklenburg | Charlotte | `nc_onemap_full_recon_sweep` |
| Raleigh Full Sweep | Wake | Raleigh | `nc_onemap_full_recon_sweep` |
| Winston-Salem Sweep | Forsyth | Winston-Salem | `nc_onemap_full_recon_sweep` |
| Wake Absentee | Wake | Raleigh | `wake_county_absentee_owners` |
| Beaufort Absentee | Beaufort | Washington | `beaufort_county_absentee_owners` |
| Granville Absentee | Granville | Oxford | `granville_county_absentee_owners` |
| Sampson Absentee | Sampson | Clinton | `sampson_county_absentee_owners` |
| Stokes Absentee | Stokes | Danbury | `stokes_county_absentee_owners` |
| Stanly Absentee | Stanly | Albemarle | `stanly_county_absentee_owners` |
| Wilkes Absentee | Wilkes | Wilkesboro | `wilkes_county_absentee_owners` |
| Warren Absentee | Warren | Warrenton | `warren_county_absentee_owners` |
| Robeson Absentee | Robeson | Lumberton | `robeson_county_absentee_owners` |
| Rockingham Absentee | Rockingham | Reidsville | `rockingham_county_absentee_owners` |
| Orange Absentee | Orange | Hillsborough | `orange_county_absentee_owners` |
| Nash Absentee | Nash | Rocky Mount | `nash_county_absentee_owners` |
| … + all other county presets | | | |

---

## 9. Buyer Engine

### 9.1 County Metadata

`countyMetadata` maps each county to its date format(s). This drives how raw sale dates from ArcGIS responses are parsed.

Date format values:
- `"epoch ms"` — Unix timestamp in milliseconds (most NC OneMap counties)
- `"YYYYMMDD int"` — Integer like `20240315`
- `"YYYYMMDD string"` — String `"20240315"`
- `"ISO string"` — `"2024-03-15T00:00:00Z"`
- `"MM/DD/YYYY"` — US date string
- `"SaleYear + SaleMonth"` — Two separate fields, year and month number
- `"YYYYMMDD int or string"` — Mixed
- `"MM/YYYY"` — Month and year only

Counties by date format:

| Format | Counties |
|---|---|
| epoch ms | Beaufort, Burke, Chowan, Columbus, Currituck, Dare, Durham, Edgecombe, Franklin, Gaston, Guilford, Halifax, Haywood, Hoke, Jackson, Lenoir, Macon, McDowell, Montgomery, Nash, Orange, Pamlico, Pasquotank, Person, Polk, Rockingham, Rutherford, Sampson, Stokes, Surry, Transylvania, Union, Vance, Watauga, Wayne, Wilkes, Yancey, Yadkin, Warren, Robeson |
| YYYYMMDD int | Avery, Davie |
| YYYYMMDD string | Ashe, Buncombe |
| ISO string | Johnston |
| MM/DD/YYYY | Brunswick, Duplin, Granville |
| SaleYear + SaleMonth | Cabarrus, Catawba, Lee |
| YYYYMMDD int or string | Bladen |
| MM/YYYY | Pitt |

---

### 9.2 County Verification Overrides

`countyVerificationOverrides` controls per-county behavior for 90-day buyer sweeps and UI trust indicators.

```typescript
type CountyVerificationOverride = {
  supportsPast90Days: boolean;
  verificationStatus: "approved" | "historical_only" | "unknown" | "blocked";
  verificationReason: string;
};
```

**Status summary:**

| Status | Meaning | Counties (sample) |
|---|---|---|
| `approved` | Live feed verified, past-90-day sweeps enabled | ~70 counties including all major ones |
| `historical_only` | Feed only has older data | Bladen, Iredell, Lincoln, Lee, Surry |
| `blocked` | Do not use for buyer sweeps | Craven, Macon |
| `unknown` | Not explicitly configured (default) | Falls back via `buildCountyCapabilities()` |

If a county is not in `countyVerificationOverrides`, `buildCountyCapabilities()` defaults it to `verificationStatus: "unknown"` and `supportsPast90Days: false`.

---

### 9.3 Fallback County Source Rows

`fallbackCountySourceRows` is a hardcoded array of `CountySourceRow` used when the Supabase `CountyDataSource` table is unreachable.

```typescript
type CountySourceRow = {
  county: string;
  state: string;
  source_type: string;   // e.g. "arcgis", "arcgis_alamance"
  active: boolean;
  notes?: string | null;
};
```

91 counties covered. `buildCountyCapabilities(fallbackCountySourceRows)` builds `fallbackCountyCapabilities`, which drives `activeCounties` and the `/admin/county-sources` display when live DB is unavailable.

---

### 9.4 Workflow Definitions

Defined in `buyer-engine-data.ts` as `WorkflowStatus[]`:

| Name | Workflow ID | Status | Description |
|---|---|---|---|
| `blackspire-buyer-engine` | `VvMHSIbycYCx4CZN` | `production-ready` | Full search intake → county fetch → normalization → scoring → report persistence |
| `viral-video-factory` | `VSLwewZ63PDbuVPi` | `needs-finish` | Script → Pexels clips → voiceover → assembly → Drive upload |
| `mod-script-generator` | `n6Tr0z6joHvzN1cQ` | `stable-module` | OpenAI-backed script generation for video factory |
| `mod-pexels-search` | `qEVM2LF35KMD0XIb` | `stable-module` | Five-query video clip retrieval from Pexels |
| `mod-voiceover` | `cQgczaWAG0QhKrlC` | `stable-module` | ElevenLabs voiceover + Google Drive upload |
| `mod-video-assembler` | `WL1WhCpS94tMoX6P` | `needs-finish` | Render assembly (highest failure rate) |

**Status values:** `"production-ready"` | `"stable-module"` | `"needs-finish"` | `"early"`

---

### 9.5 Search Job Lifecycle

```
1. User fills New Search Form
   (title, state, county, propertyType, dateRangeStart, dateRangeEnd, minPurchases)

2. POST /api/search-jobs
   ├── Validate required fields
   ├── Validate date range (chronological)
   ├── Validate minPurchases (1–5 integer)
   ├── getCountyLaunchBlock(county, propertyType) — check blocked counties
   ├── createSearchJob() — INSERT into SearchJob table, status = "pending"
   └── after() hook → triggerBuyerEngineWorkflow(job) → POST to n8n webhook

3. n8n Buyer Engine Workflow (VvMHSIbycYCx4CZN)
   ├── Receives job payload (county, state, propertyType, dateRange, minPurchases)
   ├── Fetches county parcel data from ArcGIS FeatureServer/MapServer
   ├── Normalizes raw sales (deduplicate parcel, parse dates, identify absentees)
   ├── Scores buyers (purchase count, cash flag, LLC flag, total spend)
   ├── UPDATEs SearchJob status = "completed", total_buyers_found, total_sales_analyzed
   └── INSERTs BuyerReport + BuyerProfile rows

4. Frontend polls /api/search-jobs
   ├── SearchJobsMonitor client component shows live status
   └── ?highlight={jobId} fetches and displays BuyerReport rows inline
```

---

### 9.6 Buyer Scoring

Buyer profiles are scored on:
- `purchaseCount` — number of qualifying purchases in date range
- `isCashBuyer` — no associated mortgage/deed of trust
- `isLlc` — owner name contains LLC/INC/CORP patterns
- `totalSpend` — sum of purchase prices
- `score` — composite score (0–100)

`BuyerProfile.score_breakdown.buyer_identity.note` — descriptive classification.

---

### 9.7 Helper Functions

| Function | Purpose |
|---|---|
| `buildCountyCapabilities(rows)` | Merges source rows with `countyMetadata` + `countyVerificationOverrides` → `CountyCapability[]` |
| `getCountyCapability(county, capabilities)` | Find single county capability |
| `getCountyVerificationTone(status)` | Map status → `"good" \| "warn" \| "bad" \| "neutral"` |
| `getCountyLaunchBlock(county, propertyType, capabilities?)` | Returns `{ blocked, reason }` |
| `getCountyOperationalRisk(county, propertyType)` | Returns `CountyOperationalRisk` with tone + message |
| `getSystemStats()` | Dashboard aggregate stats |
| `getLiveCountyCapabilities(includeInactive?)` | Queries CountyDataSource, merges with metadata overrides |
| `getOperatorShellStatus()` | Auth state, sign-in status, bootstrap required flag |
| `getBuyerEngineEnvStatus()` | Checks env vars are configured |
| `getBuyerEngineRealtimeClientEnv()` | Returns Supabase Realtime config for client components |

---

## 10. CountyDataSource Registry

### 10.1 Database Schema

Table: `"CountyDataSource"` in Supabase

| Column | Type | Description |
|---|---|---|
| `id` | uuid (PK) | Auto-generated |
| `state` | text | Always `"NC"` |
| `county` | text | County name (title case, e.g. `"Wake"`) |
| `source_url` | text | Full ArcGIS REST endpoint URL |
| `source_type` | text | Constrained enum (see below) |
| `active` | boolean | Whether this row is used at query time |
| `notes` | text | Endpoint documentation, field notes, diagnostic results |
| `created_at` | timestamptz | Row creation time |

Row selection: `getBuyerCountyRegistrySource(county, state)` queries `ORDER BY active DESC, created_at DESC LIMIT 1`.

---

### 10.2 Source Type Constraint

`CountyDataSource_source_type_check` allows:

```
arcgis
arcgis_alamance    arcgis_buncombe    arcgis_cabarrus    arcgis_cherokee
arcgis_craven      arcgis_cumberland  arcgis_davidson    arcgis_durham
arcgis_forsyth     arcgis_gaston      arcgis_guilford    arcgis_harnett
arcgis_henderson   arcgis_hoke        arcgis_iredell     arcgis_lee
arcgis_lincoln     arcgis_macon       arcgis_mecklenburg arcgis_moore
arcgis_newhanover  arcgis_onslow      arcgis_pender      arcgis_person
arcgis_pitt        arcgis_rowan       arcgis_rutherford  arcgis_surry
arcgis_wake        arcgis_warren      arcgis_wilson      arcgis_yadkin
```

All other counties use the generic `arcgis` type.

---

### 10.3 County Endpoint Tiers

**Tier 1 — Curated county-specific hosts (~50 counties)**

These have dedicated ArcGIS endpoints on county-owned or county-specific ArcGIS Online orgs. Examples:

| County | Endpoint host |
|---|---|
| Alamance | `apps.alamance-nc.com` |
| Beaufort | `services1.arcgis.com` (Beaufort_Service) |
| Bladen | `gis.bladenco.org` |
| Brunswick | `bcgis.brunswickcountync.gov` |
| Buncombe | `gis.buncombecounty.org` |
| Burke | `gis.burkenc.org` |
| Cabarrus | `location.cabarruscounty.us` |
| Caldwell | `gis.caldwellcountync.org` |
| Carteret | `arcgisweb.carteretcountync.gov` |
| Catawba | `arcgis2.catawbacountync.gov` |
| Chatham | `gisservices.chathamcountync.gov` |
| Cherokee | `services5.arcgis.com` (Cherokee Parcels) |
| Craven | `gis.cravencountync.gov` |
| Cumberland | `gis.co.cumberland.nc.us` |
| Davidson | `webgis.co.davidson.nc.us` |
| Davie | `gis.daviecountync.gov` |
| Durham | `services2.arcgis.com` (Durham Parcels_NEW) |
| Duplin | `gis.duplinnc.gov` |
| Edgecombe | `gis.edgecombecountync.gov` |
| Forsyth | `maps.co.forsyth.nc.us` |
| Gaston | (county ArcGIS) |
| Guilford | (county ArcGIS) |
| Harnett | (county ArcGIS) |
| Henderson | (county ArcGIS) |
| Hoke | (county ArcGIS) |
| Iredell | (county ArcGIS) |
| Johnston | (county ArcGIS) |
| Lee | (county ArcGIS) |
| Lincoln | (county ArcGIS) |
| Macon | (county ArcGIS) |
| Mecklenburg | (dedicated path, inactive row) |
| Montgomery | `services6.arcgis.com` (Montgomery_County_Parcels) |
| Moore | (county ArcGIS) |
| Nash | (county ArcGIS) |
| New Hanover | (county ArcGIS) |
| Onslow | (county ArcGIS) |
| Pender | (county ArcGIS) |
| Person | (county ArcGIS) |
| Pitt | (county ArcGIS) |
| Polk | `gis.polk-county.net` |
| Randolph | `gis.randolphcountync.gov` |
| Robeson | (county ArcGIS) |
| Rowan | (county ArcGIS) |
| Rutherford | (county ArcGIS) |
| Sampson | (county ArcGIS) |
| Surry | (county ArcGIS) |
| Transylvania | `gis.transylvaniacounty.org` |
| Union | `services8.arcgis.com` (Union Parcels) |
| Wake | (dedicated path, inactive row) |
| Warren | (county ArcGIS) |
| Watauga | `gisviewer.townofboone.net` |
| Wilson | (county ArcGIS) |
| Yadkin | (county ArcGIS) |
| Yancey | `gis.yanceycountync.org` |

**Tier 2 — NC OneMap statewide fallback (16 counties)**

These use `services.gis.nc.gov/secure/rest/services/NC1Map_Parcels/FeatureServer/0` with a county filter:

Chowan, Cleveland, Columbus, Currituck, Dare, Franklin, Halifax, Jackson, Johnston, Lenoir, McDowell, Pamlico, Pasquotank, Rockingham, Vance, Wayne

NC OneMap fields available: `ownname`, `ownname2`, `mailadd`, `mcity`, `mstate`, `mzip`, `siteadd`, `parno`, `saledate` (epoch ms), `parval`, `landval`, `struct`, `parusedesc`. **Sale price not available.**

**Tier 3 — Dedicated hardcoded paths (2 counties)**

Wake and Mecklenburg use entirely separate, purpose-built fetch functions that do not go through `fetchGenericNcCountyAbsenteeRows`.

---

### 10.4 Runtime Routing

When `fetchGenericNcCountyAbsenteeRows(input, countyName, defaultCity, sourceName)` is called:

```
1. getBuyerCountyRegistrySource(countyName)
   → SELECT * FROM "CountyDataSource"
     WHERE county = '{countyName}' AND state = 'NC'
     ORDER BY active DESC, created_at DESC LIMIT 1

2. If row.source_url exists:
   → queryCuratedCountyEndpoint(row.source_url, opts)
   → If returns 0 rows: fall back to fetchNcOneMapAbsenteeRows()
   → If throws: fall back to fetchNcOneMapAbsenteeRows()

3. If no row (DB unavailable or no active row):
   → fetchNcOneMapAbsenteeRows() directly
```

---

## 11. queryCuratedCountyEndpoint — Field Alias Catalog

This function in `seller-engine-server.ts` is the schema-agnostic parser. It handles any ArcGIS FeatureServer or MapServer response by trying 50+ field name aliases per data category.

### Parcel ID aliases
`PIN_NUM`, `PIN14`, `PIN4`, `PIN`, `PINNUM`, `PinNum`, `PARCEL_ID`, `PARCEL_NUMBER`, `PARID`, `GIS_PIN`, `TAX_PIN`, `GIS_PARID`, `TAX_PARID`, `REID`, `PARCEL_PK`, `GPIN`, `GPINLONG`, `NCPIN`, `TWN_PIN`, `ncpin`, `parno`, `PID`

### Owner name (primary) aliases
`OWNER`, `OWNER1`, `OWN1`, `PROPERTY_OWNER`, `OWNNAME`, `OWNAM1`, `NAME1`, `NAME`, `CURR_NAME1`, `AcctName1`, `BUYER1`, `OwnerName`, `ownname`, `name1`, `Name`

### Owner name (secondary) aliases
`OWNER2`, `OWN2`, `OWNAM2`, `NAME2`, `CURR_NAME2`, `AcctName2`, `BUYER2`, `ownname2`, `name2`

### Mailing address line 1 aliases
`OWNER_MAIL_1`, `MAIL_ADDR1`, `MAILADD`, `MAILADDR1`, `MAILINGADDRESS`, `MAILING_AD`, `ADDR1`, `ADDR`, `ADDRESS1`, `ADD1`, `ADDRLINE1`, `OWNER_ADDR1`, `OWNERADDR1`, `OwnerAddress1`, `CURR_ADDR1`, `TAXADD1`, `TaxpayerAddress1`, `TMADDR`, `OWADR1`, `mailadd`, `MailingAddress`

### Mailing address line 2 aliases
`OWNER_MAIL_2`, `MAIL_ADDR2`, `ADDR2`, `ADDRESS2`, `ADD2`, `ADDRLINE2`, `OWNER_ADDR2`, `OwnerAddress2`, `CURR_ADDR2`, `TAXADD2`, `munit`

### Mailing address line 3 aliases
`OWNER_MAIL_3`, `ADDRESS3`, `OWNER_ADDR3`, `OwnerAddress3`

### City aliases
`OWNER_MAIL_CITY`, `MAIL_CITY`, `MAILCITY`, `MailCity`, `CITY`, `OWNER_CITY`, `OWCITY`, `CURR_CITY`, `CITYNM`, `TaxpayerCity`, `City`, `mcity`

### State aliases
`OWNER_MAIL_STATE`, `MAIL_STATE`, `MAILSTATE`, `MailState`, `STATE`, `OWNER_STATE`, `OWSTA`, `CURR_STATE`, `TAXSTE`, `State`, `mstate`

### ZIP aliases
`OWNER_MAIL_ZIP`, `MAIL_ZIP`, `MAILZIP`, `MailZip`, `MailZipCode`, `ZIP`, `ZIPCODE`, `OWNER_ZIP`, `OWZIPA`, `CURR_ZIPCODE`, `ZIPCode`, `Zip`, `mzip`

### Property address aliases
`SITE_ADDRESS`, `PROP_ADDR`, `PROP_ADDRESS`, `PROPERTY_ADDRESS`, `PropertyAddress`, `LOCATION_ADDR`, `PHYSICAL_ADDRESS`, `PHYSICALADDRESS`, `PHYSICALADDR`, `PHYS_ADDR`, `PHYSSTRADD`, `PARCEL_ADD`, `PhyStreetAddr`, `FullAdd`, `FULLADD`, `PropAddr`, `FormattedPropertyAddress`, `siteadd`

### Sale date aliases
`DEED_DATE`, `DEEDDATE`, `SALEDATE`, `SALE_DATE`, `PKG_SALE_DATE`, `Sale_Date`, `DATESOLD`, `DateSold`, `DeedDate`, `RECENT_SALEDT`, `AMDTSL`, `SALEDT`, `date_dt`, `deed_date`, `sale_date`, `saledate`

### Building value / vacancy signal aliases
`BLDG_VAL`, `BLDGVALUE`, `TOT_B_VAL`, `bldg_value`, `parcelbuildingvalue`, `NBR_BLDG`, `BLDGCNT`, `ActualYearBuilt`, `yr_built`, `ResComYrBlt`

### Property type / land use aliases
`LAND_USE`, `LANDTYPE`, `LAND_CLASS`, `TYPE_USE_DECODE`, `UseCode`, `UseCd`, `LAND_CLASS_DECODE`, `parusedesc`, `parusedsc2`, `PROPTYPE`, `PARCEL_CLA`, `class`, `LegalLandT`

### Absentee owner detection logic
A property is flagged as absentee if the mailing state field differs from `"NC"` (case-insensitive). This drives the `owner_occupancy_status` field on imported seller leads.

### Epoch-ms date handling
If the sale date field value is a number > 1,000,000,000,000 (13 digits), it is treated as Unix epoch milliseconds and converted to a `YYYY-MM-DD` string.

---

## 12. n8n Workflows

### Buyer Engine (production-ready)

**Webhook path:** `{N8N_WEBHOOK_BASE_URL}/buyer-engine`

**Payload sent by app:**
```json
{
  "jobId": "uuid",
  "title": "string",
  "state": "NC",
  "county": "string",
  "propertyType": "land | residential | commercial",
  "dateRangeStart": "YYYY-MM-DD",
  "dateRangeEnd": "YYYY-MM-DD",
  "minPurchases": 1
}
```

**Workflow steps:**
1. Receive webhook payload
2. Select ArcGIS endpoint based on county (using CountyDataSource or hardcoded map)
3. Fetch parcel sales within date range
4. Normalize fields (owner name, mailing address, sale date, price)
5. Identify absentee signal (mailing address ≠ property address / out-of-state owner)
6. Group by buyer name + mailing address
7. Score each buyer (purchase count, cash flag, LLC detection, spend total)
8. UPDATE SearchJob: `status = "completed"`, `total_buyers_found`, `total_sales_analyzed`
9. INSERT BuyerReport rows
10. INSERT BuyerProfile rows with full score breakdown JSON

**Wake County special path:** App-server prefetch (`fetchWakeCountyRawSales()`) runs directly from the Next.js server before triggering n8n, to avoid n8n timeout on Wake's large dataset. n8n receives pre-fetched rows.

### Viral Video Factory (needs-finish)

**Sub-modules:** `mod-script-generator` (OpenAI) → `mod-pexels-search` → `mod-voiceover` (ElevenLabs) → `mod-video-assembler` → Google Drive upload → (social publishing not yet wired)

---

## 13. Authentication

**Provider:** Supabase Auth (email + password)

**Flow:**
1. `POST /api/auth/bootstrap` — creates first operator account (one-time setup)
2. `POST /api/auth/sign-in` — creates Supabase session
3. `GET /api/auth/status` — returns `{ authenticated, bootstrapRequired, isAdmin }`
4. Server components call `getOperatorShellStatus()` to gate content

**Operator shell status fields:**
- `isAuthenticated` — has valid Supabase session
- `bootstrapRequired` — no operator accounts exist yet
- `isAdmin` — operator has admin flag
- `userEmail` — signed-in email

**Note:** A legacy "default user fallback" existed for development; it is deprecated and being replaced with full operator accounts.

---

## 14. Admin Features

### /admin/county-sources

Component: `county-sources-admin.tsx`

- Lists all counties from `fallbackCountySourceRows` (or live DB when available)
- Shows: county name, source type, active status, endpoint host, notes
- Allows toggling active/inactive per county
- PATCH calls to `/api/county-sources`
- Changes propagate immediately to runtime (next seller search for that county)

### /admin (Dashboard)

- Operator shell status summary
- Search job counts: pending / processing / completed / failed
- Beta tester snapshots and usage analytics
- Environment readiness checklist (Supabase URL, service role key, n8n webhook URL)

### /admin/recon

Recon user management for the public-facing Recon Engine product.

---

## 15. Deal Engine

Pages: `/deal-room`
Components: `deal-engine-home.tsx`, `deal-engine-deal-detail.tsx`, `deal-engine-packet-view.tsx`, `deal-engine-actions.tsx`, `deal-engine-shell.tsx`, `deal-room-interest-form.tsx`, `deal-room-public-view.tsx`

API routes:
- `POST /api/deal-engine/save-packet` — persist a deal packet (property + analysis)
- `POST /api/deal-engine/create-buyer-draft` — generate outreach draft for a matched buyer

Features:
- Package properties with deal analysis
- Match deals to buyers from the Buyer Engine
- Public-facing deal room view for buyer interest submission
- Outreach draft generation (AI-assisted)

---

## 16. Recon Engine

Pages: `/recon-engine`
Components: `recon-dashboard.tsx`, `recon-engine-lead-form.tsx`, `recon-auth-panel.tsx`, `recon-account-panel.tsx`, `recon-checkout-button.tsx`

API routes:
- `POST /api/recon-engine/lead-scan` — run a property lead scan
- `POST /api/recon-engine/checkout` — create Stripe checkout session
- `POST /api/recon-engine/stripe-webhook` — handle Stripe events
- `/api/recon/sign-up|sign-in|sign-out|account|proposal` — recon user auth and account management

Features:
- Public-facing (separate auth from operator auth)
- Lead scan gated behind Stripe payment
- Recon proposal generation
- Stripe webhook handling for payment confirmation

---

## 17. Helix Lawn Command

Pages: `/lawn-command`, `/helix-lawn-command`
Components: `helix-lawn-command-home.tsx`, `helix-lawn-command-page.tsx`, `helix-lawn-intake-demo.tsx`

API routes:
- `POST /api/helix-lawn-command/analyze-photo` — AI analysis of lawn photo (OpenAI vision)
- `GET /api/helix-lawn-command/leads` — list lawn command leads

Features:
- Upload a lawn photo for AI assessment
- Generate lawn service recommendations
- Lead capture for lawn care operators
- Demo mode for showcasing the product

---

## 18. Data Flow Diagrams

### Seller Engine Search Flow

```
Browser (seller-engine-dashboard.tsx)
  POST /api/seller-engine/search { sourceKey, county, city, limit }
  │
  ▼
/api/seller-engine/search/route.ts
  │ validate county
  ▼
runSellerLiveSearch(input) [seller-engine-server.ts]
  │
  ├─ blend? → getCountyLiveSourceKeys()
  │           → Promise.all(fetchRowsForLiveSource × N)
  │           → merge + rank
  │
  └─ single → fetchRowsForLiveSource({ sourceKey, county, city, limit })
               │
               ├─ NC OneMap keys → fetchNcOneMapAbsenteeRows()
               │    → GET services.gis.nc.gov FeatureServer/0/query
               │
               ├─ Distress keys → fetchCumberlandForeclosureRows() etc.
               │    → GET county tax/foreclosure portal
               │
               └─ Absentee keys → fetchGenericNcCountyAbsenteeRows()
                    │
                    ├─ getBuyerCountyRegistrySource(county)
                    │    → SELECT CountyDataSource WHERE county=? AND active=true
                    │
                    ├─ queryCuratedCountyEndpoint(sourceUrl)
                    │    → POST {sourceUrl}/query with outFields + where
                    │    → schema-agnostic field aliasing → SellerImportRow[]
                    │
                    └─ fallback: fetchNcOneMapAbsenteeRows()
  │
  ▼
importSellerRows(rows)
  → deduplicate by parcel ID
  → calculateSellerLeadScore()
  → UPSERT SellerLead table (Supabase)
  │
  ▼
Response: { ok, imported, total, errors, sourceName, sourceKey }
```

### Buyer Engine Search Flow

```
Browser (new-search-form.tsx)
  POST /api/search-jobs { title, state, county, propertyType, dateRange, minPurchases }
  │
  ▼
/api/search-jobs/route.ts
  │ validate fields + date range + minPurchases
  │ getCountyLaunchBlock(county, propertyType)
  ▼
createSearchJob() → INSERT SearchJob (status="pending")
  │
  ▼ [after() — non-blocking]
triggerBuyerEngineWorkflow(job)
  → POST {N8N_WEBHOOK_BASE_URL}/buyer-engine { jobId, county, ... }
  │
  ▼
n8n workflow
  → fetch ArcGIS parcel data for county + date range
  → normalize + score buyers
  → UPDATE SearchJob (status="completed", total_buyers_found)
  → INSERT BuyerReport + BuyerProfile rows
  │
  ▼
Browser polls GET /api/search-jobs
  → SearchJobsMonitor shows live status
  → ?highlight={jobId} shows BuyerReport rows inline
```

---

## 19. Database Tables (Supabase)

### Core Tables

| Table | Key Columns | Description |
|---|---|---|
| `SearchJob` | `id`, `county`, `state`, `property_type`, `date_range_start`, `date_range_end`, `min_purchases`, `status`, `total_buyers_found`, `total_sales_analyzed`, `error_message`, `created_at` | Buyer Engine search jobs |
| `BuyerReport` | `id`, `job_id`, `buyer_name_snapshot`, `mailing_address_snapshot`, `score`, `purchase_count`, `total_spend`, `is_llc`, `is_cash_buyer`, `created_at` | Per-buyer rows from a completed job |
| `BuyerProfile` | `id`, `buyer_report_id`, `score_breakdown` (JSON) | Full score breakdown with buyer_identity note |
| `SellerLead` | `id`, `parcel_id`, `county`, `property_address`, `owner_name`, `owner_mailing_address`, `owner_occupancy_status`, `assessed_value`, `score`, `score_category`, `lead_status`, `source_name`, `source_type`, `source_url`, `integration_type`, `configuration` (JSON), `imported_at` | Seller Engine leads |
| `CountyDataSource` | `id`, `state`, `county`, `source_url`, `source_type`, `active`, `notes`, `created_at` | ArcGIS endpoint registry per county |
| `SellerSource` | `id`, `name`, `county`, `state`, `source_type`, `integration_type`, `source_url`, `active`, `last_imported_at`, `configuration` (JSON) | Seller source registrations with health data |
| `SellerAlert` | `id`, `title`, `message`, `alert_type`, `read`, `created_at` | Operator alert notifications |

### Supabase Project

Project ID: `kchtrvfcixnimvxxctkj` (name: "blackspire insight")

---

*End of reference document. Generated from codebase state as of 2026-06-10.*
