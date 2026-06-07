# Ember Halo Lovable Prompt

Paste this entire prompt into Lovable to generate the Ember Halo frontend that matches the current local repo, backend API, schema, and blueprint.

---

Build **Ember Halo**, a private luxury roses-only concierge platform with two primary surfaces:

1. A **customer-facing conversational booking experience**
2. A **secure admin/operator dashboard**

This frontend must integrate with an existing TypeScript backend and Supabase-backed data model. Do not invent generic ecommerce behavior. This is **not** a normal flower shop. It should feel discreet, cinematic, premium, intimate, and mobile-first.

## Source Of Truth

Use these constraints as fixed:

- The current repo has a minimal Next.js scaffold, but you should design the full UX from scratch.
- The existing backend already exposes routes for customer chat, agreements, pricing, checkout, scheduling, admin dashboard, analytics, reviews, media, profile publishing, takeover mode, notifications, VIP vault, special requests, location controls, providers, and collaborations.
- Frontend prices must always come from the backend. Never hardcode prices.
- Standard rose packages are fixed at **15, 30, 100, and 200 roses**.
- **200+ roses** must route to a manual/special-request flow.
- Pickup and delivery have separate prices.
- Payment confirmation is only real after backend/webhook confirmation.

## Product Goals

Create a luxury app that feels like texting a confident private concierge late at night.

The customer flow should:

- enforce a lawful-use gate before anything else
- reveal the app through a smooth cinematic unlock transition
- keep chat as the primary interaction
- show live rose package pricing
- support pickup or delivery
- escalate unusual requests to a human/admin workflow
- finish with secure checkout and elegant confirmation

The admin flow should let an operator:

- monitor conversations
- take over live chats
- edit package pricing and special packages
- manage active cities, hours, and online status
- review scheduling records
- manage media
- manage owner profile pages
- review notifications, analytics, reviews, VIP vault entries, and special requests

## Design Direction

Visual language:

- dark luxury
- black, charcoal, warm gold, ember orange, restrained deep red accents
- premium glassmorphism used carefully
- elegant serif headlines paired with a refined sans body font
- soft blur dissolves, fades, glow, depth, ambient gradients
- no generic SaaS dashboard look
- no bright ecommerce palette
- no cheesy romance visuals

Use a palette close to:

- `#050505`
- `#0A0A0A`
- `#111111`
- `#1A1A1A`
- `#C9A84C`
- `#E8C96B`
- `#B86A2E`
- `#8B1A1A`
- `#FAFAFA`

Typography:

- headings: elegant serif such as Playfair Display, Cormorant Garamond, or Canela-style equivalent
- body/chat/UI: modern clean sans such as Inter, Manrope, or Söhne-like equivalent

Motion:

- subtle, expensive, not flashy
- fade and blur transitions around `700ms` to `1200ms`
- the app should feel calm, controlled, and exclusive

## Core Information Architecture

Create these major routes/pages:

- `/` customer app
- `/admin/login`
- `/admin`
- `/admin/conversations`
- `/admin/pricing`
- `/admin/location`
- `/admin/scheduling`
- `/admin/profile`
- `/admin/media`
- `/admin/notifications`
- `/admin/analytics`
- `/admin/reviews`
- `/admin/vault`
- `/admin/special-requests`
- `/profile/[adminId]` public owner profile page

If Lovable prefers a single dashboard route with tabs, that is acceptable as long as deep linking still works.

## Customer State Machine

The customer experience should be driven by these states:

```ts
'locked_gate' | 'nda_pending' | 'unlocked_customer_ui' | 'quote_pending' | 'checkout_pending' | 'booking_confirmed' | 'post_service_followup'
```

Use this exact logic:

- `locked_gate`: only the gate chat is visible
- `nda_pending`: compliance passed, privacy/NDA screen visible
- `unlocked_customer_ui`: full customer experience unlocked
- `quote_pending`: package or request has been quoted, awaiting confirmation
- `checkout_pending`: payment UI active
- `booking_confirmed`: wait for backend-confirmed success, then show confirmation
- `post_service_followup`: retention/review-friendly post-service state

## Locked Gate Experience

The first screen is a full-screen private luxury gate with a centered AI chatbox and ember halo mark.

The very first message must be:

`Before we continue… please confirm you are at least 18 years old and agree to use this service only for lawful floral gifting.`

Required customer response, validated client-side using trim + lowercase comparison:

`I confirm that I am at least 18 years old and will use this service only for lawful floral gifting.`

Rules:

- show the required phrase beneath the input as a hint
- if incorrect, show: `Please enter the exact confirmation above to continue.`
- do not unlock anything until the phrase matches
- while locked, hide package cards, pricing, navigation, and checkout
- keep the chatbox visually consistent so the unlock feels like the room opens around it

## NDA / Privacy Screen

After successful gate confirmation, show a private/confidential agreement screen.

Use copy in this spirit:

- private and discreet
- do not redistribute or screenshot content
- the service is for lawful floral gifting only

Primary actions:

- `I Agree — Continue`
- `Exit`

On accept:

- call `POST /api/agreement/accept`
- log timestamp and session identifier
- transition to `unlocked_customer_ui`

The transition should feel like access has been granted, not like a hard page reload.

## Main Customer Experience

After unlock, reveal a premium chat-led booking interface.

Layout:

- desktop: large concierge chat panel left/center, rose package rail or cards on the right
- mobile: chat remains primary, package cards become a horizontal scroll section or stacked panel

### Customer Chat

The chat is the primary control surface.

Requirements:

- all customer messages post to `POST /api/conversation/message`
- support a typing indicator
- support streaming-feel or staged reply animation even if backend is non-streaming
- AI replies should feel short, natural, text-message-like
- keep the interface conversational, not form-like
- the UI should gather order information through dialogue, not giant forms

The AI persona should feel:

- witty
- smooth
- flirty but not explicit
- socially intelligent
- premium and discreet
- human-like, not robotic

Do not make the UI language feel like a generic support bot.

### Rose Packages

Fetch pricing from:

- `GET /api/rose-packages?admin_id={adminId}`

Display:

- package name
- rose count
- pickup price
- delivery price
- active status or scarcity cues when applicable

Rules:

- standard packages: 15, 30, 100, 200
- show `Custom Arrangement` or `200+ Roses — Request Quote` as a manual/special request path
- clicking a package should seed the conversation naturally
- never hardcode prices

### Main Customer Data To Collect Through Chat

The UX should help the AI collect:

- package size
- pickup or delivery
- delivery city
- address or pickup preference
- date
- time window
- rose color preference
- anonymous sender preference
- card message
- rush preference
- unusual/special instructions

### Special Requests

Special requests must stand out as a first-class flow, not a hidden edge case.

Examples:

- more than 200 roses
- unusual timing
- rush requests
- multiple stops
- privacy-sensitive delivery notes
- requests outside operating hours or active service areas
- anything the AI cannot safely approve

When a special request is detected:

- the customer UI should acknowledge it elegantly
- do not falsely confirm it automatically
- visually mark the request as under concierge review
- create a graceful waiting state

Admin data for these flows comes from:

- `GET /api/admin/special-requests`
- `POST /api/admin/special-requests/resolve`

## Checkout Flow

When backend conversation flow advances to checkout:

- show an order summary card
- show selected package, fulfillment type, city, date/time, and final backend-derived price
- create payment via `POST /api/payment/create-intent`
- support Stripe-powered checkout options: card, Apple Pay, Google Pay, Cash App Pay where available

Critical rule:

- do not treat the frontend redirect as confirmation
- after payment submission, show a confirming state
- poll `GET /api/order/status?order_id={id}`
- only move to `booking_confirmed` when backend returns confirmed/paid status

## Booking Confirmation

The confirmation screen should feel elegant and calm.

Include:

- premium success state
- concise order summary
- city/date/time window
- pickup or delivery status
- subtle ambient motion

No loud celebration UI.

## Post-Service Followup State

Create a lightweight retained state for follow-up/review messaging.

The backend supports post-service follow-up and verified review flows. The UI should be ready to:

- show a thank-you state
- invite a verified review when appropriate
- make reordering feel effortless

## Admin Authentication

Use Supabase Auth email/password for admin login.

Environment variables expected client-side:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_BASE_URL=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
```

If Lovable prefers `VITE_` naming internally, keep the app adaptable, but output a Next.js-friendly frontend since the current repo frontend is Next.js App Router.

## Admin Dashboard

Build a luxury operator dashboard that feels powerful but not corporate.

### Admin Home

Show:

- active conversations
- bookings today
- pending special requests
- unresolved alerts
- revenue snapshot
- online/offline status
- active cities

Use:

- `GET /api/admin/dashboard`

### Conversations

Use:

- `GET /api/admin/conversations`
- `GET /api/admin/conversations/:id`
- `POST /api/admin/takeover`
- `POST /api/admin/release`
- `POST /api/admin/send-message`

Requirements:

- list both web and SMS conversations
- show classification, channel, last activity, special request flag
- open full transcript view
- provide live-looking takeover mode
- when takeover is active, show an AI suggested-reply panel
- support release back to AI

### Pricing

Use:

- `GET /api/admin/packages`
- `PATCH /api/admin/packages/price`
- `GET /api/admin/special-packages`
- `POST /api/admin/special-packages`
- `PATCH /api/admin/special-packages/:id`
- `POST /api/admin/special-packages/:id/toggle`
- `GET /api/admin/scarcity`
- `POST /api/admin/scarcity`

Requirements:

- editable pickup and delivery prices for 15, 30, 100, 200
- special package management
- scarcity message management
- clear active/inactive states
- timestamps and premium table/card UI

### Location And Hours

Use:

- `GET /api/admin/location`
- `PATCH /api/admin/location`
- `POST /api/admin/location/online`
- `PATCH /api/admin/location/hours`
- `GET /api/admin/location/availability`

Requirements:

- active cities
- service radius
- travel mode
- rush mode
- holiday mode
- online/offline toggle
- availability until
- editable hours

This should support the mobile pop-up operator model.

### Scheduling

Use:

- `GET /api/scheduling/records`
- `PATCH /api/scheduling/status`
- `GET /api/scheduling/export`

Requirements:

- day/week/list style views or a polished agenda table
- statuses such as confirmed, preparing, out for delivery, delivered, rescheduled, cancelled
- filters, search, date range
- clear support for pickup and delivery appointments

### Profile

Use:

- `GET /api/admin/profile`
- `POST /api/admin/profile`
- `POST /api/admin/profile/generate-bio`
- `POST /api/admin/profile/publish`
- `GET /api/admin/profile/versions`
- `POST /api/admin/profile/restore`
- `GET /api/profile/public/:adminId`

Requirements:

- editable display name, bio, title, service area, hours, specials, tone, privacy level
- AI bio generation
- publish/unpublish
- version history / restore UI
- polished public-facing slideshow-style owner profile page

The public profile page should feel cinematic, image-led, and premium.

### Media

Use:

- `GET /api/admin/media`
- `POST /api/admin/media`
- `DELETE /api/admin/media/:id`
- `PATCH /api/admin/media/reorder`
- `GET /api/media/signed-url?media_id=...`

Requirements:

- media grid
- upload flow
- category filtering
- drag-to-reorder
- soft-confirm delete
- signed/private image loading

### Notifications

Use:

- `GET /api/admin/notifications`
- `POST /api/admin/notifications`
- `POST /api/admin/notifications/bulk`

Requirements:

- event-based notification preferences
- SMS/email/both/none controls
- clean control surface for operator alerts

### Analytics

Use:

- `GET /api/admin/analytics`
- `GET /api/admin/analytics/upsells`
- `GET /api/admin/analytics/revenue`

Requirements:

- revenue trend
- conversion/upsell signals
- persona and city-aware insights
- premium charts, restrained and readable

### Reviews

Use:

- `GET /api/admin/reviews`
- `GET /api/admin/reviews/stats`

The frontend should support a reviews overview surface and prepare room for moderation/feature controls if returned by the backend.

### VIP Vault

Use:

- `GET /api/admin/vault`
- `GET /api/admin/vault/:customerPhone`
- `PATCH /api/admin/vault/:entryId`

Requirements:

- searchable high-value customer records
- preferences, spending, anonymity, notes
- premium but discreet presentation

## Secondary Admin Modules

If scope allows, also scaffold clean placeholders or hidden-ready sections for:

- collaborations
- vetted providers directory

Related routes exist:

- `/api/admin/collaborations`
- `/api/providers`
- `/api/providers/apply`
- `/api/admin/providers/bookmarks`
- `/api/admin/providers/applications`

Do not let these distract from the core customer flow and main dashboard.

## Technical Requirements

- build in **React + TypeScript**
- target **Next.js App Router style structure**
- use responsive components from the start
- keep state organization clean and production-minded
- create reusable primitives for chat, cards, stat blocks, status pills, forms, tables, and cinematic sections
- prefer clear component boundaries

## UX Guardrails

- no hardcoded package prices
- no generic checkout cart page
- no bright floral-shop visuals
- no robotic AI copy
- no fake success states before webhook/backend confirmation
- no single-screen cram of every admin feature
- no demo routes in the public navigation

## Responsive QA Requirement

After generating the app, do a full responsive pass for:

- `375px` mobile width
- `1280px` desktop width

Verify at minimum:

- locked gate
- NDA screen
- unlock transition
- customer chat
- rose package display
- special request state
- checkout
- booking confirmation
- admin login
- admin dashboard and all major tabs
- takeover mode
- public owner profile page

Then do a second responsive verification pass after API wiring/components are complete.

## Important Product Notes

- The service is always framed as **lawful floral gifting**
- The AI may be flirtatious in tone, but the UI must remain tasteful and non-explicit
- Custom 200+ requests require human review
- Operators can work across changing cities and hours
- SMS and web conversations both feed the same system
- Payment, scheduling, notifications, and follow-up are all real parts of the app, not placeholders

## Final Build Goal

Deliver a frontend that feels like a private luxury concierge product with:

- a cinematic compliance-gated customer booking flow
- a premium chat-first ordering experience
- strong mobile behavior
- a serious operator dashboard
- public owner profile support
- real hooks for the existing backend API

Build the production app first. Do **not** prioritize demo pages, voice concierge, heatmaps, driver assignment, or unrelated speculative features in this pass.
