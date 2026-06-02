# BLACKSPIRE HELIX GROUP Parent Site Implementation Plan

Date: June 1, 2026

Source reviewed:

- [Blackspire_Helix_Group_FULL_LOGO_WEBSITE_CODE_PLAN.pdf](C:/Users/USER/Downloads/Blackspire_Helix_Group_FULL_LOGO_WEBSITE_CODE_PLAN.pdf)

## Executive Read

The PDF is strong and unusually actionable. It already defines:

- the brand position
- the ecosystem structure
- the page architecture
- the component inventory
- the initial data model
- the MVP sprint sequence

The main adjustment is technical, not strategic:

the repo is **not** starting from zero.

`frontend/` is already a live Next.js app for `Blackspire Buyer Engine`, with working app routes, API routes, Supabase integration, and an established dark premium visual system. Because of that, the best move is **not** to create a separate disconnected website from scratch.

The best move is to turn the existing frontend into:

1. a parent-company marketing hub for `BLACKSPIRE HELIX GROUP`
2. while preserving the existing `Buyer Engine` product routes as one ecosystem proof point

## What The PDF Is Asking For

The PDF is asking for a premium parent-brand site with:

- a dominant `BLACKSPIRE HELIX GROUP` identity
- five visible divisions:
  - `Blackspire Buyer Engine`
  - `Helix Lawn Command`
  - `Blackspire Social OS`
  - `Ember Halo`
  - `Oracle Helix`
- a homepage that explains the offer in plain business language
- ecosystem navigation
- service and industry explanation pages
- a demo gallery
- founder story
- a strategy-call / AI-readiness lead form
- room to expand into deeper division pages and internal tools later

## Current Repo Reality

What already exists in the repo:

- root repo metadata is mostly placeholder
- the real app is in `frontend/`
- `frontend/` is already a Next.js app using:
  - Next.js
  - TypeScript
  - Tailwind
  - Supabase
- current product routes already exist:
  - `/`
  - `/buyers`
  - `/searches`
  - `/searches/new`
  - `/workflows`
  - `/auth`
  - `/admin`
- the visual theme already aligns with the PDF:
  - black background
  - gold accents
  - premium dashboard styling

What does **not** exist yet:

- parent-brand homepage
- ecosystem pages
- division branding system
- logo-driven navigation
- marketing content architecture
- lead capture flow for the parent brand
- child landing pages for the four non-buyer-engine divisions

## Core Recommendation

Build the parent site **inside the existing `frontend/` app**.

Do not start a second disconnected site unless there is a strong deployment reason later.

## Recommended Information Architecture

### Public Marketing Layer

Use the root and top-level content routes for the parent brand:

- `/` → `BLACKSPIRE HELIX GROUP` homepage
- `/ecosystem`
- `/services`
- `/industries`
- `/demos`
- `/about`
- `/contact`

### Division / Product Layer

Keep product-specific and division-specific routes beneath clear paths:

- `/ecosystem/buyer-engine`
- `/ecosystem/helix-lawn-command`
- `/ecosystem/social-os`
- `/ecosystem/ember-halo`
- `/ecosystem/oracle-helix`

### Existing Operational Product Routes

Keep these alive and reachable as the real proof product:

- `/buyers`
- `/searches`
- `/searches/new`
- `/workflows`
- `/auth`
- `/admin`

## Best Structural Refactor

Use route groups so the marketing site and the operational app can coexist cleanly.

Recommended shape:

```text
frontend/src/app/
  (marketing)/
    page.tsx
    ecosystem/page.tsx
    services/page.tsx
    industries/page.tsx
    demos/page.tsx
    about/page.tsx
    contact/page.tsx
    layout.tsx
  (product)/
    buyers/page.tsx
    searches/page.tsx
    searches/new/page.tsx
    workflows/page.tsx
    auth/page.tsx
    admin/page.tsx
  api/
  layout.tsx
  globals.css
```

Why this is the right structure:

- parent-brand marketing gets its own shell
- existing product surfaces remain intact
- future division pages can live in the marketing layer first
- later, mature divisions can break into standalone products if needed

## Implementation Phases

## Phase 1: Brand Foundation

Goal:

make the site read as `BLACKSPIRE HELIX GROUP` first instead of `Buyer Engine` first

Tasks:

1. update root metadata and browser title to parent-brand defaults
2. define ecosystem design tokens:
   - parent gold/silver
   - buyer engine orange/gold
   - lawn green/gold
   - social purple/blue
   - ember orange/red
   - oracle blue/violet/silver
3. add a central ecosystem data file
4. organize logo assets under a consistent public path
5. create a marketing layout shell with:
   - sticky header
   - ecosystem nav
   - footer logo strip

Deliverables:

- `ecosystem.ts`
- centralized asset paths
- parent-site metadata
- marketing header/footer shell

## Phase 2: Parent Homepage

Goal:

ship the premium parent-company homepage from the PDF

Sections to build:

1. hero
2. problem section
3. solution section
4. ecosystem logo card grid
5. how it works
6. AI employee use cases
7. demo gallery preview
8. founder vision
9. final CTA / lead capture

Important note:

the current `/` page is heavily product-operations oriented. That content should be repositioned into `Buyer Engine` space, not left as the public homepage.

Deliverables:

- new parent-company homepage
- CTA flow into `/contact`
- links from homepage into buyer engine and other divisions

## Phase 3: Content Pages

Goal:

create the trust-building pages the PDF calls for

Pages:

- `/ecosystem`
- `/services`
- `/industries`
- `/demos`
- `/about`
- `/contact`

What each page should do:

- `/ecosystem`:
  interactive map or premium grid of all divisions with short explanations
- `/services`:
  explain AI employees, automations, CRM workflows, lead routing, dashboards, and integrations
- `/industries`:
  translate services into market-specific outcomes
- `/demos`:
  show reels, UI screenshots, workflows, and concept evidence
- `/about`:
  founder story and long-term brand vision
- `/contact`:
  strategy-call intake and AI-readiness questions

## Phase 4: Division Landing Pages

Goal:

turn each child division into a credible proof-of-concept node

Priority order:

1. `Blackspire Buyer Engine`
2. `Helix Lawn Command`
3. `Blackspire Social OS`
4. `Oracle Helix`
5. `Ember Halo`

Why this order:

- `Buyer Engine` already has real product surface area
- `Helix Lawn Command` is closest to a clear service-business automation offer
- `Blackspire Social OS` connects directly to your current AI content output
- `Oracle Helix` can become a strong intelligence demo
- `Ember Halo` is compelling but likely needs the most custom commerce polish

Each division page should include:

- logo
- role
- tagline
- problem
- solution
- use cases
- feature bullets
- demo media
- CTA

## Phase 5: Lead Capture System

Goal:

turn the site into a real intake engine

Form fields from the PDF are good:

- name
- email
- phone
- business type
- biggest manual task
- monthly lead volume
- budget range
- urgency

Recommended implementation:

1. React Hook Form
2. Zod validation
3. server action or route handler
4. n8n webhook as first delivery target
5. optional Supabase persistence as second layer

Recommended post-submit flow:

1. save submission
2. notify by email/SMS
3. create internal summary
4. tag by industry
5. return a clean thank-you screen

## Phase 6: Demo and Proof System

Goal:

make the ecosystem feel real, not aspirational

Needed content buckets:

- vertical reels
- dashboard screenshots
- workflow diagrams
- before/after automations
- division-tagged case-study cards

Important rule:

every demo asset should clearly belong to a division.

That means each card should show:

- division logo
- division accent color
- short caption
- CTA

## Phase 7: Polish and Launch

Tasks:

1. mobile QA at the widths named in the PDF
2. image compression and WebP exports
3. alt text and accessibility pass
4. SEO metadata and OG images
5. analytics
6. domain wiring
7. production form testing

## Build Order I Recommend

This is the order I would actually execute in the repo:

1. create ecosystem data model and asset structure
2. move current root homepage behavior into a Buyer Engine route context
3. build the new parent-company homepage
4. build header/footer/navigation shared by marketing pages
5. build `/ecosystem`
6. build `/services`, `/industries`, `/about`
7. build `/contact` and wire the intake flow
8. build `/demos`
9. build division landing pages
10. polish, QA, deploy

## Gaps In The PDF

The PDF is strong, but a few implementation choices still need to be decided:

### 1. Source of Truth for Division Assets

Need one final approved asset set for:

- parent logo
- all five division logos
- icon-only variants
- transparent-background versions
- light/dark-safe exports

### 2. Navigation Boundary Between Marketing and Product

Need a clean distinction between:

- public website visitors
- product operators

My recommendation:

- keep public brand pages in top navigation
- put product routes behind a `Products` or `Operator` entry point

### 3. Contact Funnel Destination

Need to choose whether intake goes first to:

- n8n only
- Supabase only
- both

My recommendation:

- send to both eventually
- start with n8n first for speed

### 4. Demo Content Inventory

The site will look much stronger once there are real assets per division.

So alongside development, there should be a content collection pass for:

- screenshots
- reel embeds
- workflow diagrams
- brand mockups

## Success Criteria

The build is successful when:

1. the homepage clearly presents `BLACKSPIRE HELIX GROUP` as the parent brand
2. each division feels like part of one ecosystem
3. the existing `Buyer Engine` app remains usable
4. a visitor can understand the offer in under 15 seconds
5. a lead can submit an intake form without friction
6. the site feels premium, intentional, and future-facing

## Best Next Step

The best immediate next step is:

**implement Phase 1 and Phase 2 first**

That means:

1. create the ecosystem data/config layer
2. reframe the app architecture into marketing + product
3. replace the current `/` with the parent-brand homepage

## Recommendation For Us

Do not treat this as a pure design exercise.

Treat it as a brand-platform migration:

- from `single product dashboard at root`
- to `parent company site with one live product and four expanding divisions`

That matches both the PDF and the repo reality.
