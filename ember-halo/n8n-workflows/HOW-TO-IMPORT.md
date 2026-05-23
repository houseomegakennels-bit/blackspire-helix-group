# Ember Halo — n8n Workflow Import Guide

## Prerequisites
- n8n instance running at https://cpearson0312.app.n8n.cloud
- All 7 JSON files in this directory

---

## Step 1 — Set Environment Variables in n8n

In n8n: **Settings → n8n API → Environment Variables** (or via `.env` if self-hosted):

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://kchtrvfcixnimvxxctkj.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | From Supabase dashboard → Project Settings → API |
| `EMBER_HALO_API_BASE` | Your deployed backend URL (e.g. `https://your-api.com`) |
| `TWILIO_FROM_NUMBER` | Your Twilio number (e.g. `+12345678901`) |

---

## Step 2 — Create Credentials in n8n

Before importing, create these credentials in **n8n → Credentials**:

### Twilio
- Name: `Twilio`
- Account SID: from Twilio console
- Auth Token: from Twilio console

### SMTP (for admin email alerts)
- Name: `SMTP`
- Host: your SMTP server (e.g. smtp.gmail.com)
- Port: 587
- Username/Password: your email credentials

---

## Step 3 — Import Each Workflow

For each file:
1. Open n8n → **Workflows → Add Workflow → Import from File**
2. Select the JSON file
3. Save the workflow
4. Verify credentials are linked (yellow warning icons = credential not yet assigned)
5. Activate the workflow (toggle at top right)

Import order:
1. `01-conversation-started.json`
2. `02-special-request-created.json`
3. `03-booking-confirmed.json`
4. `04-payment-failed.json`
5. `05-sms-inbound.json`
6. `06-schedule-changed.json`
7. `07-post-service-followup.json`

---

## Step 4 — Verify Webhook URLs

After import, each workflow's webhook URL will be:
```
https://cpearson0312.app.n8n.cloud/webhook/ember-halo/{event}
```

| Workflow | Webhook Path |
|---|---|
| conversation_started | `/webhook/ember-halo/conversation_started` |
| special_request_created | `/webhook/ember-halo/special_request_created` |
| booking_confirmed | `/webhook/ember-halo/booking_confirmed` |
| payment_failed | `/webhook/ember-halo/payment_failed` |
| sms_inbound | `/webhook/ember-halo/sms-inbound` |
| schedule_changed | `/webhook/ember-halo/schedule_changed` |
| post_service_followup | `/webhook/ember-halo/post_service_followup` |

These match exactly what the backend sends to `N8N_WEBHOOK_BASE_URL` in `.env`.

---

## Step 5 — Point Twilio at WF 05

In Twilio console → Phone Numbers → your number → Messaging:
- **Webhook URL**: `https://cpearson0312.app.n8n.cloud/webhook/ember-halo/sms-inbound`
- **HTTP Method**: POST

---

## Step 6 — Workflow 07 Scheduled Trigger

Workflow 07 (post_service_followup) has a built-in 8pm daily schedule trigger.
After import, activate it — n8n will fire it automatically every evening.
It can also be triggered manually via webhook for immediate follow-ups.

---

## Notes on `post_followup_sent` Column

Workflow 07 checks `scheduling_records.post_followup_sent = false` and sets it to `true` after sending.
If this column doesn't exist in your schema, add it:
```sql
ALTER TABLE ember_halo.scheduling_records
  ADD COLUMN IF NOT EXISTS post_followup_sent boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS post_followup_at timestamptz;
```

---

## Testing Workflows

Send a test POST to any webhook URL with a sample payload.
All workflows are imported as **inactive** — activate only when ready for production.
Test mode: set `NODE_ENV=test` in the webhook payload to route notifications to dev contacts only.
