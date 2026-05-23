# Ember Halo — n8n Workflow Specifications
# Build these in your n8n instance at https://cpearson0312.app.n8n.cloud

All webhooks use path prefix: /webhook/ember-halo/{event_type}

---

## WORKFLOW 1: conversation_started

**Trigger:** Webhook POST `/webhook/ember-halo/conversation_started`

**Payload:**
```json
{
  "event": "conversation_started",
  "conversation_id": "...",
  "admin_id": "...",
  "channel": "web | sms",
  "timestamp": "..."
}
```

**Steps:**
1. Receive webhook
2. Query Supabase `ember_halo.admins` + `ember_halo.notification_preferences` for admin_id
3. Check if admin has notifications enabled for event type `conversation_started`
4. If SMS enabled → Send Twilio SMS to admin notify_phone:
   `"New rose conversation started on [channel]. Active: [city]. View in dashboard."`
5. If email enabled → Send email to admin notify_email with same summary
6. Log to `ember_halo.notification_log`

**Never include sensitive customer data in SMS/email preview.**

---

## WORKFLOW 2: special_request_created

**Trigger:** Webhook POST `/webhook/ember-halo/special_request_created`

**Payload:**
```json
{
  "event": "special_request_created",
  "conversation_id": "...",
  "admin_id": "...",
  "channel": "web | sms",
  "request_summary": "...",
  "timestamp": "..."
}
```

**Steps:**
1. Receive webhook
2. Look up admin contact info and notification preferences
3. Mark special request as high-priority in `ember_halo.special_requests`
4. SMS admin: `"SPECIAL REQUEST — Customer needs personal attention. Channel: [channel]. City: [city]. View dashboard now."`
5. Email admin: Subject: `"Special Request Needs Attention — Ember Halo"` Body: safe summary + dashboard link
6. Log notification

**This is the highest-priority workflow. SMS fires first, email second.**

---

## WORKFLOW 3: booking_confirmed

**Trigger:** Webhook POST `/webhook/ember-halo/booking_confirmed`

**Payload:**
```json
{
  "event": "booking_confirmed",
  "order_id": "...",
  "admin_id": "...",
  "stripe_payment_id": "...",
  "amount": 150.00,
  "currency": "usd",
  "timestamp": "..."
}
```

**Steps:**
1. Receive webhook
2. Query order details from `ember_halo.orders` + `ember_halo.scheduling_records`
3. Create/update internal scheduling record status to `confirmed`
4. If admin has Google Calendar sync enabled → Create Google Calendar event titled `"Rose Delivery Appointment"` (never customer name in title)
5. SMS admin: `"Booking confirmed: [rose_count] roses. [pickup|delivery]. [date] [time_window]. [city]. $[amount] paid."`
6. Email admin: Full booking summary + dashboard link
7. Log notification

---

## WORKFLOW 4: payment_failed

**Trigger:** Webhook POST `/webhook/ember-halo/payment_failed`

**Payload:**
```json
{
  "event": "payment_failed",
  "order_id": "...",
  "admin_id": "...",
  "stripe_payment_id": "...",
  "failure_message": "...",
  "timestamp": "..."
}
```

**Steps:**
1. Receive webhook
2. Look up conversation linked to this order
3. Send AI follow-up message via conversation API:
   `POST /api/conversation/message` with system-generated graceful follow-up
4. SMS admin: `"Payment issue on order [id]. Customer may need assistance. Check dashboard."`
5. Log notification

---

## WORKFLOW 5: sms_inbound (Twilio → AI)

**Trigger:** Twilio inbound SMS webhook

**Steps:**
1. Receive Twilio webhook with `From`, `Body`, `To`
2. Check if `Body` is "STOP" → log opt-out, send Twilio `"You have been unsubscribed."`, stop workflow
3. Look up existing active conversation by `customer_phone` + `admin_id` (resolved from Twilio To number)
4. If no conversation → create new via `POST /api/conversation/message` with `channel: sms`
5. Call `POST /api/conversation/message` with customer message
6. Receive AI reply from backend
7. Send AI reply via Twilio to customer phone number
8. If `special_request_detected = true` in response → trigger special_request workflow
9. Log full exchange to `ember_halo.messages` (backend handles this, n8n just needs to route)

---

## WORKFLOW 6: schedule_changed

**Trigger:** Webhook POST `/webhook/ember-halo/schedule_changed`

**Payload:**
```json
{
  "event": "schedule_changed",
  "scheduling_record_id": "...",
  "admin_id": "...",
  "previous_status": "...",
  "new_status": "...",
  "timestamp": "..."
}
```

**Steps:**
1. Receive webhook
2. If Google Calendar sync enabled → Update or delete Google Calendar event
3. If new_status = `out_for_delivery` → optionally send customer notification via SMS relay
4. Log notification

---

## WORKFLOW 7: post_service_followup

**Trigger:** Webhook POST `/webhook/ember-halo/post_service_followup`
OR: Scheduled trigger (e.g., 2 hours after `delivered` status set)

**Steps:**
1. Receive event or scheduled trigger
2. Load order + conversation context
3. Send AI post-service retention message via conversation API
4. If customer responds positively → queue review invite message (1 message, not repeated)
5. Log follow-up sent in audit log

---

## Environment Variables for n8n

Set these in n8n credentials/environment:
- `SUPABASE_URL`: https://kchtrvfcixnimvxxctkj.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY`: (from Supabase dashboard)
- `EMBER_HALO_API_BASE`: https://your-backend-url.com
- `TWILIO_ACCOUNT_SID`: (from Twilio)
- `TWILIO_AUTH_TOKEN`: (from Twilio)
- `TWILIO_FROM_NUMBER`: (your Twilio number)
- `GMAIL_OR_SMTP_CREDENTIALS`: (for admin email alerts)

---

## Workflow Safety Rules

- Every workflow must log success/failure to `ember_halo.notification_log`
- If SMS fails → fall back to email
- If email fails → create dashboard alert via Supabase insert
- Never retry more than 3 times on webhook delivery failure
- All workflows have separate test-mode branches (check `NODE_ENV` or use a test flag in payload)
- Test workflows send to developer contact only, never real customers
