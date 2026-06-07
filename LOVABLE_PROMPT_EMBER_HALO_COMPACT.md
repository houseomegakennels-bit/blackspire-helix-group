# Ember Halo Lovable Prompt (Compact)

Build **Ember Halo**, a **private luxury roses-only concierge platform** in **Next.js + TypeScript** with a **customer-facing chat-led booking flow** and a **secure admin dashboard**.

This is **not** a generic flower shop or standard ecommerce site. It should feel **discreet, cinematic, premium, intimate, and mobile-first**.

## Visual Direction

- Dark luxury aesthetic
- Black, charcoal, warm gold, ember orange, restrained deep red accents
- Elegant serif headlines + refined sans-serif UI/body text
- Soft glow, blur dissolve, fade transitions, premium spacing
- No bright floral-shop visuals
- No generic SaaS dashboard look

Suggested palette:

- `#050505`
- `#0A0A0A`
- `#111111`
- `#1A1A1A`
- `#C9A84C`
- `#E8C96B`
- `#B86A2E`
- `#8B1A1A`
- `#FAFAFA`

## App Structure

Create these major routes:

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

## Customer State Machine

Use these exact states:

```ts
'locked_gate' | 'nda_pending' | 'unlocked_customer_ui' | 'quote_pending' | 'checkout_pending' | 'booking_confirmed' | 'post_service_followup'
```

## Locked Gate

The first screen is a full-screen dark luxury gate with a centered AI chatbox.

The opening message must be:

`Before we continue… please confirm you are at least 18 years old and agree to use this service only for lawful floral gifting.`

Required exact phrase:

`I confirm that I am at least 18 years old and will use this service only for lawful floral gifting.`

Rules:

- validate client-side with trim + lowercase comparison
- show the phrase below the input as a hint
- if incorrect, show: `Please enter the exact confirmation above to continue.`
- while locked, hide navigation, pricing, packages, checkout, and the rest of the app

## NDA Screen

After successful gate confirmation, show a privacy/confidentiality agreement with:

- `I Agree — Continue`
- `Exit`

On agree:

- call `POST /api/agreement/accept`
- log session/timestamp
- advance to `unlocked_customer_ui`

The unlock transition should feel cinematic and seamless, with fade + blur over roughly `700ms` to `1200ms`.

## Main Customer Experience

Make the chat the primary interaction surface.

Layout:

- desktop: chat left/center, package cards right
- mobile: chat first, package cards in horizontal scroll or stacked section

### Chat Requirements

- send all customer messages to `POST /api/conversation/message`
- support typing indicator
- AI replies should feel short, natural, smooth, premium, and human-like
- conversational, not form-like
- the UI should help gather package size, pickup/delivery, city, address, date, time window, rose color, anonymity preference, card message, rush preference, and special instructions through dialogue

### Rose Packages

Fetch live pricing from:

- `GET /api/rose-packages?admin_id={adminId}`

Rules:

- standard packages are fixed: **15, 30, 100, 200**
- display package name, rose count, pickup price, delivery price
- support a `Custom Arrangement` / `200+ Roses — Request Quote` card
- clicking a package should seed the chat naturally
- never hardcode prices

### Special Requests

Treat special requests as a first-class flow.

Examples:

- more than 200 roses
- unusual timing
- rush delivery
- multiple locations
- privacy-sensitive instructions
- outside active city/hours
- anything the AI should not auto-approve

When detected:

- acknowledge elegantly
- do not auto-confirm
- show that concierge review is in progress

Use:

- `GET /api/admin/special-requests`
- `POST /api/admin/special-requests/resolve`

## Checkout Flow

When the conversation reaches checkout:

- show an elegant order summary
- create payment with `POST /api/payment/create-intent`
- support card, Apple Pay, Google Pay, and Cash App Pay where available

Critical rule:

- do not treat redirect as payment confirmation
- after payment, show a confirming state
- poll `GET /api/order/status?order_id={id}`
- only switch to `booking_confirmed` after backend-confirmed success

## Booking Confirmation

Show a calm, premium confirmation screen with:

- concise success message
- order summary
- pickup/delivery info
- city/date/time window
- subtle ambient motion

## Post-Service Followup

Create a lightweight retained state that supports thank-you, review invitation, and reorder-friendly UX.

## Admin Auth

Use Supabase Auth email/password.

Expected client env vars:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_BASE_URL=...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=...
```

## Admin Dashboard

Build a premium operator dashboard, not a generic admin panel.

### Home

Use:

- `GET /api/admin/dashboard`

Show:

- active conversations
- bookings today
- pending special requests
- unresolved alerts
- revenue snapshot
- online/offline status
- active cities

### Conversations

Use:

- `GET /api/admin/conversations`
- `GET /api/admin/conversations/:id`
- `POST /api/admin/takeover`
- `POST /api/admin/release`
- `POST /api/admin/send-message`

Requirements:

- show web and SMS conversations
- transcript view
- classification, channel, last activity, special request flags
- takeover mode with AI suggested replies

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

- editable pickup and delivery pricing for 15, 30, 100, 200
- special package management
- scarcity messaging

### Location

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
- availability hours

### Scheduling

Use:

- `GET /api/scheduling/records`
- `PATCH /api/scheduling/status`
- `GET /api/scheduling/export`

Requirements:

- day/week/list or polished agenda view
- filters, date range, search
- support pickup and delivery records

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

- editable owner profile
- AI bio generation
- publish/unpublish
- version history
- cinematic public owner profile page

### Media

Use:

- `GET /api/admin/media`
- `POST /api/admin/media`
- `DELETE /api/admin/media/:id`
- `PATCH /api/admin/media/reorder`
- `GET /api/media/signed-url?media_id=...`

Requirements:

- media gallery grid
- upload
- filter
- drag-to-reorder
- signed/private image loading

### Notifications

Use:

- `GET /api/admin/notifications`
- `POST /api/admin/notifications`
- `POST /api/admin/notifications/bulk`

### Analytics

Use:

- `GET /api/admin/analytics`
- `GET /api/admin/analytics/upsells`
- `GET /api/admin/analytics/revenue`

### Reviews

Use:

- `GET /api/admin/reviews`
- `GET /api/admin/reviews/stats`

### VIP Vault

Use:

- `GET /api/admin/vault`
- `GET /api/admin/vault/:customerPhone`
- `PATCH /api/admin/vault/:entryId`

Requirements:

- searchable high-value customer records
- preferences, anonymity, spending, notes

## Important Guardrails

- prices must always come from backend APIs
- standard package sizes are only 15, 30, 100, 200
- 200+ roses requires a manual/special-request flow
- pickup and delivery prices are separate
- all payment confirmation must come from backend/webhook-confirmed status
- keep all service framing around lawful floral gifting
- flirtatious tone is okay, but keep UI tasteful and non-explicit
- build the production app first
- do not prioritize demo pages, voice concierge, driver assignment, or speculative extras in this pass

## Responsive QA

Verify at `375px` and `1280px`:

- locked gate
- NDA screen
- unlock transition
- customer chat
- package cards
- special request state
- checkout
- booking confirmation
- admin login
- dashboard and key admin views
- takeover mode
- public owner profile

Do a second responsive pass after API-integrated UI is complete.
