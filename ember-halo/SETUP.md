# Ember Halo — Setup Guide
# Follow in order. Every step is required before the app can run.

---

## Prerequisites
- Node.js 20+ installed (https://nodejs.org)
- Supabase project: kchtrvfcixnimvxxctkj (schema ember_halo)
- Stripe account with Connect enabled
- Twilio account with a phone number
- Anthropic API key
- n8n instance: https://cpearson0312.app.n8n.cloud

### Fresh Supabase Setup (skip if migrating an existing project)

If setting up a brand-new Supabase project, apply migrations in order via Supabase Dashboard → SQL Editor:

```
supabase/migrations/001_ember_halo_core_schema.sql   ← Full schema (30 tables, RLS)
supabase/migrations/002_ember_halo_stripe_twilio.sql  ← Stripe + Twilio columns (idempotent)
supabase/migrations/003_ember_halo_n8n_columns.sql    ← n8n workflow support columns (idempotent)
```

Then create the Storage bucket: Dashboard → Storage → New bucket → Name: `ember-halo-media` → Public: OFF.

See `supabase/README.md` for full details.

---

## Step 1 — Environment Variables

```
cd C:\Users\USER\Documents\ember-halo
copy .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `SUPABASE_URL` | Already set: https://kchtrvfcixnimvxxctkj.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → Project Settings → API → service_role |
| `SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API → anon/public |
| `SUPABASE_JWT_SECRET` | Supabase dashboard → Project Settings → API → JWT Secret |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com |
| `STRIPE_SECRET_KEY` | Stripe dashboard → Developers → API keys |
| `STRIPE_PUBLISHABLE_KEY` | Stripe dashboard → Developers → API keys |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Developers → Webhooks → signing secret |
| `TWILIO_ACCOUNT_SID` | Twilio console → Account info |
| `TWILIO_AUTH_TOKEN` | Twilio console → Account info |
| `TWILIO_PHONE_NUMBER` | Twilio console → Phone Numbers |
| `N8N_WEBHOOK_BASE_URL` | https://cpearson0312.app.n8n.cloud/webhook |
| `APP_URL` | Your deployed backend URL (or http://localhost:3000 for local) |

---

## Step 2 — Install Dependencies

```
cd C:\Users\USER\Documents\ember-halo
npm install
```

---

## Step 3 — Seed First Admin

Set `FIRST_ADMIN_EMAIL` in `.env` to your admin email, then:

```
npm run seed
```

This creates:
- Admin record (role: owner, city: Charlotte)
- Persona "Nyla" (sophisticated, medium flirtation, ["baby","handsome"])
- 5 standard packages (15/30/100/200/200+ roses) with placeholder prices
- Default notification preferences

Save the Admin ID printed to console — you'll need it.

---

## Step 4 — Create Supabase Auth User

In Supabase dashboard → Authentication → Users → Add user:
- Email: same as `FIRST_ADMIN_EMAIL`
- Password: set securely

Then link the auth user to your admin record via SQL:

```sql
UPDATE ember_halo.admins
SET auth_user_id = '<auth_user_id_from_supabase>'
WHERE role = 'owner';
```

---

## Step 5 — Stripe Connect Onboarding

Start the backend locally first:
```
npm run dev
```

Then open or POST to:
```
POST http://localhost:3000/api/admin/stripe/onboard
Authorization: Bearer <your_supabase_jwt>
```

Complete the Stripe Express onboarding flow. After completion, `stripe_onboarded` becomes `true` on your admin record.

---

## Step 6 — Twilio Phone Number Setup

1. In Twilio console, provision a local phone number
2. Set the inbound SMS webhook URL on that number to your n8n webhook:
   `https://cpearson0312.app.n8n.cloud/webhook/ember-halo/sms-inbound`
3. Update your admin record with the Twilio number:

```sql
UPDATE ember_halo.admins
SET twilio_phone_number = '+1XXXXXXXXXX'
WHERE role = 'owner';
```

---

## Step 7 — Stripe Webhook

In Stripe dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://your-backend-url.com/webhooks/stripe`
- Events to listen for:
  - `payment_intent.succeeded`
  - `payment_intent.payment_failed`
  - `payment_intent.canceled`
  - `account.updated`

Copy the signing secret into `STRIPE_WEBHOOK_SECRET` in `.env`.

---

## Step 8 — Import n8n Workflows

All 7 workflows are ready to import as JSON files. See `n8n-workflows/HOW-TO-IMPORT.md` for step-by-step instructions.

Quick import:
1. Open n8n at https://cpearson0312.app.n8n.cloud
2. New workflow → ⋮ menu → Import from JSON
3. Import each file in order:

| File | Event |
|---|---|
| `01-conversation-started.json` | New customer session |
| `02-special-request-created.json` | Special request detected |
| `03-booking-confirmed.json` | Payment webhook confirmed |
| `04-payment-failed.json` | Payment failure retry |
| `05-sms-inbound.json` | Inbound SMS relay |
| `06-schedule-changed.json` | Out-for-delivery customer notification |
| `07-post-service-followup.json` | 2hr post-delivery follow-up |

4. In each workflow: update the `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `EMBER_HALO_API_BASE` credential nodes
5. Activate each workflow after verifying credentials

---

## Step 9 — Lovable Frontend

Open `LOVABLE_PROMPT.md` and paste the entire contents into Lovable as a new project prompt.

After Lovable generates the frontend, set these environment variables in your Lovable project:
```
VITE_API_BASE_URL=https://your-backend-url.com
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_SUPABASE_URL=https://kchtrvfcixnimvxxctkj.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
```

---

## Step 10 — Update Admin Prices

Once running, log into the admin dashboard and update the placeholder package prices:
- 15 roses pickup / delivery
- 30 roses pickup / delivery
- 100 roses pickup / delivery
- 200 roses pickup / delivery

Then update your persona name, city, hours, and notification contact info.

---

## Step 11 — Deploy (or Run Locally)

### Option A — Railway (Recommended)

1. Push this repo to GitHub
2. Go to https://railway.app → New Project → Deploy from GitHub
3. Select your repo
4. Railway auto-detects the Dockerfile
5. Go to **Variables** tab and add all keys from `.env.example`
6. After deploy, copy the Railway URL → set as `APP_URL` in variables
7. Health check: `https://your-app.railway.app/health`

The `railway.json` config is already wired with healthcheck at `/health`.

### Option B — Render

1. Push repo to GitHub
2. Go to https://render.com → New Web Service → connect GitHub repo
3. Render detects `render.yaml` automatically
4. Add secret env vars in the Render dashboard
5. Deploy

### Option C — Run Locally

```
npm run dev
```

Backend runs on `http://localhost:3000`

Health check: `GET http://localhost:3000/health`

> **Important:** Stripe webhooks and Twilio callbacks require a publicly accessible URL.
> For local dev, use [ngrok](https://ngrok.com): `ngrok http 3000`
> Then set your Stripe webhook URL and Twilio SMS URL to the ngrok HTTPS address.

---

## API Endpoint Reference

| Route | Method | Auth | Purpose |
|---|---|---|---|
| /health | GET | No | Health check |
| /api/rose-packages | GET | No | Live pricing |
| /api/conversation/message | POST | No | Customer message → AI reply |
| /api/agreement/accept | POST | No | Log NDA acceptance |
| /api/order/status | GET | No | Poll order status after payment |
| /api/reviews | POST | No | Submit verified review |
| /api/reviews/eligible | GET | No | Check review eligibility |
| /api/providers/apply | POST | No | Provider application |
| /api/profile/public/:admin_id | GET | No | Public owner profile |
| /api/payment/create-intent | POST | No | Create Stripe PaymentIntent |
| /api/admin/dashboard | GET | JWT | Dashboard summary |
| /api/admin/packages | GET | JWT | List packages |
| /api/admin/packages/price | PATCH | JWT | Update prices |
| /api/admin/special-packages | GET/POST | JWT | Special packages |
| /api/admin/profile | GET/POST | JWT | Owner profile |
| /api/admin/profile/generate-bio | POST | JWT | AI bio generation |
| /api/admin/location | GET/PATCH | JWT | Location controls |
| /api/admin/location/online | POST | JWT | Toggle online status |
| /api/admin/location/hours | PATCH | JWT | Update hours |
| /api/scheduling/records | GET | JWT | Scheduling records |
| /api/scheduling/status | PATCH | JWT | Update order status |
| /api/admin/takeover | POST | JWT | Concierge takeover |
| /api/admin/release | POST | JWT | Release takeover |
| /api/admin/send-message | POST | JWT | Send message in takeover |
| /api/admin/reviews | GET | JWT | List reviews |
| /api/admin/analytics | GET | JWT | Analytics overview |
| /api/admin/vault | GET | JWT | VIP client vault |
| /api/admin/notifications | GET/POST | JWT | Notification prefs |
| /api/admin/collaborations | GET/POST | JWT | Admin collaborations |
| /api/providers | GET | JWT | Browse provider directory |
| /api/admin/stripe/onboard | POST | JWT | Stripe Connect onboarding |
| /api/admin/conversations | GET | JWT | List conversations with filters |
| /api/admin/conversations/:id | GET | JWT | Conversation detail + messages |
| /api/admin/special-requests | GET | JWT | Special requests queue |
| /api/admin/media | GET/POST | JWT | Media gallery list / upload |
| /api/admin/media/:id | DELETE | JWT | Soft-delete media |
| /api/admin/media/reorder | PATCH | JWT | Reorder gallery |
| /api/media/signed-url | GET | No | 5-min expiring signed URL |
| /webhooks/stripe | POST | Stripe sig | Stripe webhook (source of truth) |
| /webhooks/twilio/sms | POST | Twilio sig | Inbound SMS (direct — used when bypassing n8n) |

---

## Demo System (Build Last)

Per blueprint: demo pages are built AFTER production flows are verified end-to-end.
Do not build demos until all 11 steps above are complete and at least one real test booking has been confirmed via webhook.
