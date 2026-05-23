# Ember Halo — Deployment Guide

Choose one platform. Railway is the fastest path.

---

## Option A — Railway (Fastest)

### Prerequisites
- GitHub repo with this code pushed
- Railway account (railway.app)

### Steps

1. **Push to GitHub**
   ```
   git init
   git add .
   git commit -m "Initial Ember Halo backend"
   git remote add origin https://github.com/YOUR_USERNAME/ember-halo.git
   git push -u origin main
   ```

2. **Create Railway project**
   - Go to railway.app → New Project → Deploy from GitHub repo
   - Select your repo
   - Railway detects the Dockerfile automatically

3. **Set environment variables** (Railway dashboard → Variables tab)
   ```
   SUPABASE_URL=https://kchtrvfcixnimvxxctkj.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   SUPABASE_ANON_KEY=...
   SUPABASE_JWT_SECRET=...
   ANTHROPIC_API_KEY=...
   STRIPE_SECRET_KEY=...
   STRIPE_PUBLISHABLE_KEY=...
   STRIPE_WEBHOOK_SECRET=...
   TWILIO_ACCOUNT_SID=...
   TWILIO_AUTH_TOKEN=...
   TWILIO_PHONE_NUMBER=...
   N8N_WEBHOOK_BASE_URL=https://cpearson0312.app.n8n.cloud/webhook
   NODE_ENV=production
   ```

4. **After deploy, copy your Railway URL** (e.g. `https://ember-halo-api.up.railway.app`)
   - Set `APP_URL` in Railway variables to that URL
   - Trigger a redeploy

5. **Verify:** `curl https://your-app.railway.app/health`

---

## Option B — Render

1. Push repo to GitHub (same as above)
2. Go to render.com → New → Web Service → Connect GitHub
3. Render auto-detects `render.yaml`
4. In Render dashboard, add the same env vars listed above (marked `sync: false` in render.yaml = must be set manually)
5. Deploy

---

## Option C — Fly.io

### Prerequisites
- [flyctl installed](https://fly.io/docs/hands-on/install-flyctl/)
- Fly.io account

### Steps

```bash
# 1. Authenticate
fly auth login

# 2. Create app (skip deploy for now)
fly launch --no-deploy

# 3. Set all secrets at once
fly secrets set \
  SUPABASE_URL="https://kchtrvfcixnimvxxctkj.supabase.co" \
  SUPABASE_SERVICE_ROLE_KEY="..." \
  SUPABASE_ANON_KEY="..." \
  SUPABASE_JWT_SECRET="..." \
  ANTHROPIC_API_KEY="..." \
  STRIPE_SECRET_KEY="..." \
  STRIPE_PUBLISHABLE_KEY="..." \
  STRIPE_WEBHOOK_SECRET="..." \
  TWILIO_ACCOUNT_SID="..." \
  TWILIO_AUTH_TOKEN="..." \
  TWILIO_PHONE_NUMBER="..." \
  N8N_WEBHOOK_BASE_URL="https://cpearson0312.app.n8n.cloud/webhook" \
  NODE_ENV="production" \
  APP_URL="https://ember-halo-api.fly.dev"

# 4. Deploy
fly deploy

# 5. Verify
curl https://ember-halo-api.fly.dev/health
```

---

## After Deployment — Update These URLs

Once you have a live public URL, update the following:

### Stripe Webhook
Dashboard → Developers → Webhooks → Add endpoint:
- URL: `https://YOUR_URL/webhooks/stripe`
- Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `account.updated`

### Twilio SMS Webhook (if using backend direct — not n8n)
Console → Phone Numbers → your number → Messaging webhook:
- URL: `https://YOUR_URL/webhooks/twilio/sms`

### Twilio → n8n (recommended)
Console → Phone Numbers → your number → Messaging webhook:
- URL: `https://cpearson0312.app.n8n.cloud/webhook/ember-halo/sms-inbound`

### n8n EMBER_HALO_API_BASE variable
In n8n Settings → Environment:
- `EMBER_HALO_API_BASE` = `https://YOUR_URL`

### Lovable Frontend
In Lovable project env:
- `VITE_API_BASE_URL` = `https://YOUR_URL`

---

## Local Dev with Public Tunneling

For testing Stripe webhooks and Twilio locally:

```bash
# Install ngrok: https://ngrok.com
ngrok http 3000
```

Use the ngrok HTTPS URL as your webhook destination.
The free tier URL changes on each restart — use a paid ngrok account for a stable subdomain.
