/**
 * Ember Halo — API Server
 * All routes wired. Stripe + Twilio webhooks on raw body paths.
 */

// dotenv fallback for environments where --env-file isn't available
import 'dotenv/config';
import http from 'http';
import { URL } from 'url';

// Routes
import { handleIncomingMessage }         from './api/routes/conversation.js';
import { getLivePricing }                from './api/routes/pricing.js';
import { getOrderStatus, listSchedulingRecords, updateSchedulingStatus, exportSchedulingRecords } from './api/routes/orders.js';
import { logAgreementAccepted }          from './api/routes/agreements.js';
import { createPaymentIntent, createConnectOnboardingLink, createManualPaymentLink } from './api/routes/payments.js';
import { getAdminPackages, updatePackagePrice, createSpecialPackage, updateSpecialPackage, toggleSpecialPackage, listSpecialPackages, setScarcityMessage, getActiveScarcityMessages } from './api/routes/pricing-editor.js';
import { getPublicProfile, getAdminProfile, generateAiBio, saveProfile, publishProfile, restoreProfileVersion, listProfileVersions } from './api/routes/profile.js';
import { submitReview, listAdminReviews, featureReview, hideReview, reportReview, getReviewStats, checkReviewEligibility } from './api/routes/reviews.js';
import { sendCollaborationRequest, respondToCollaboration, revokeCollaboration, listCollaborations } from './api/routes/collaboration.js';
import { browseProviders, bookmarkProvider, removeBookmark, listBookmarkedProviders, submitProviderApplication, listPendingApplications, approveProviderApplication, rejectProviderApplication } from './api/routes/providers.js';
import { getLocationControls, updateLocationControls, setOnlineStatus, updateOperatingHours, getAvailabilityContext } from './api/routes/location.js';
import { getNotificationPreferences, upsertNotificationPreference, bulkUpdateNotificationPreferences } from './api/routes/notifications.js';
import { getVaultEntry, listVaultEntries, updateVaultEntry } from './api/routes/vip-vault.js';
import { getAnalyticsOverview, getUpsellPerformance, getRevenueByDay } from './api/routes/analytics.js';
import { getDashboardSummary, handleAdminTakeover, handleAdminRelease, adminSendMessage, resolveSpecialRequest } from './api/routes/admin.js';
import { getSignedMediaUrl } from './lib/media.js';
import { listConversations, getConversationDetail, listSpecialRequests } from './api/routes/conversations.js';
import { handleMediaUpload, deleteMedia, listAdminMedia, reorderMedia } from './api/routes/media-upload.js';

// Webhooks
import { handleStripeWebhook } from './api/webhooks/stripe.js';
import { handleTwilioSms }     from './api/webhooks/twilio.js';

// ── STARTUP ENV VALIDATION ───────────────────────────────────────
const REQUIRED_ENV = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'ANTHROPIC_API_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'N8N_WEBHOOK_BASE_URL',
] as const;

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`\n[STARTUP] Missing required environment variables:\n  ${missing.join('\n  ')}`);
  console.error('Copy .env.example to .env and fill in all values.\n');
  process.exit(1);
}

if (!process.env.SUPABASE_JWT_SECRET) {
  console.warn('[STARTUP] SUPABASE_JWT_SECRET not set — JWT signatures will NOT be verified. Set for production.');
}

const PORT = process.env.PORT ?? 3000;

// ── RATE LIMITER ──────────────────────────────────────────────────
// In-memory sliding window. Keyed by IP. Resets every WINDOW_MS.
// Public endpoints (conversation, payment) get tighter limits.
// Authenticated admin endpoints are not rate-limited here.
interface RateEntry { count: number; resetAt: number; }
const rateLimitStore = new Map<string, RateEntry>();

const RATE_LIMITS: Record<string, { max: number; windowMs: number }> = {
  '/api/conversation/message':  { max: 30,  windowMs: 60_000 },   // 30 msgs/min per IP
  '/api/payment/create-intent': { max: 10,  windowMs: 60_000 },   // 10 payment starts/min
  '/api/reviews':               { max: 5,   windowMs: 60_000 },   // 5 review submits/min
  '/api/providers/apply':       { max: 3,   windowMs: 60_000 },   // 3 applications/min
  '/api/agreement/accept':      { max: 20,  windowMs: 60_000 },
  DEFAULT:                      { max: 120, windowMs: 60_000 },   // 120 req/min general
};

// Purge stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetAt < now) rateLimitStore.delete(key);
  }
}, 5 * 60_000);

function checkRateLimit(ip: string, path: string): boolean {
  const rule = RATE_LIMITS[path] ?? RATE_LIMITS['DEFAULT'];
  const key  = `${ip}:${path}`;
  const now  = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, { count: 1, resetAt: now + rule.windowMs });
    return true; // allowed
  }
  if (entry.count >= rule.max) return false; // blocked
  entry.count++;
  return true; // allowed
}

const server = http.createServer(async (req, res) => {
  const url    = new URL(req.url ?? '/', `http://localhost`);
  const method = req.method ?? 'GET';
  const path   = url.pathname;

  res.setHeader('Access-Control-Allow-Origin', process.env.APP_URL ?? '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // Rate limit public endpoints (skip webhooks and authenticated admin routes)
  const isPublicPath = !path.startsWith('/api/admin') &&
                       !path.startsWith('/webhooks') &&
                       path !== '/health';
  if (isPublicPath) {
    const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim()
            ?? req.socket.remoteAddress
            ?? 'unknown';
    if (!checkRateLimit(ip, path)) {
      return json(res, 429, { error: 'Too many requests. Please slow down.' });
    }
  }

  try {
    // ── HEALTH ────────────────────────────────────────────────
    if (path === '/health') {
      // Deep health: check Supabase connectivity
      let supabaseOk = false;
      try {
        const { createClient: sc } = await import('@supabase/supabase-js');
        const db = sc(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
        const { error } = await db.schema('ember_halo').from('admins').select('id').limit(1);
        supabaseOk = !error;
      } catch { supabaseOk = false; }

      return json(res, supabaseOk ? 200 : 503, {
        ok: supabaseOk,
        ts: new Date().toISOString(),
        version: '1.0.0',
        services: { supabase: supabaseOk ? 'ok' : 'unreachable' },
      });
    }

    // ── WEBHOOKS (raw body required — before JSON parsing) ────
    if (method === 'POST' && path === '/webhooks/stripe') {
      const raw = await readRawBody(req);
      const sig = req.headers['stripe-signature'] as string;
      const r   = await handleStripeWebhook(raw, sig);
      res.writeHead(r.status, { 'Content-Type': 'text/plain' }); res.end(r.body); return;
    }
    if (method === 'POST' && path === '/webhooks/twilio/sms') {
      const raw = await readRawBody(req);
      const sig = req.headers['x-twilio-signature'] as string;
      const r   = await handleTwilioSms(raw.toString(), sig, req.url ?? '');
      res.writeHead(r.status, { 'Content-Type': 'text/xml' }); res.end(r.twiml); return;
    }

    // All other routes use JSON body
    const body = (method !== 'GET' && method !== 'DELETE') ? await readBody(req) : {};
    const adminId = await extractAdminId(req);

    // ── PRICING (public) ──────────────────────────────────────
    if (method === 'GET' && path === '/api/rose-packages') {
      const aid = url.searchParams.get('admin_id');
      if (!aid) return json(res, 400, { error: 'admin_id required' });
      return json(res, 200, await getLivePricing(aid));
    }

    // ── CONVERSATION ─────────────────────────────────────────
    if (method === 'POST' && path === '/api/conversation/message') {
      const b = body as Record<string, unknown>;
      if (!b.admin_id || typeof b.admin_id !== 'string')
        return json(res, 400, { error: 'admin_id required' });
      if (!b.customer_message || typeof b.customer_message !== 'string')
        return json(res, 400, { error: 'customer_message required' });
      if (typeof b.customer_message === 'string' && b.customer_message.length > 2000)
        return json(res, 400, { error: 'Message too long (max 2000 chars)' });
      if (!b.channel || (b.channel !== 'web' && b.channel !== 'sms'))
        return json(res, 400, { error: 'channel must be "web" or "sms"' });
      return json(res, 200, await handleIncomingMessage(b as unknown as Parameters<typeof handleIncomingMessage>[0]));
    }

    // ── AGREEMENTS ───────────────────────────────────────────
    if (method === 'POST' && path === '/api/agreement/accept') {
      await logAgreementAccepted(body); return json(res, 200, { ok: true });
    }

    // ── ORDER STATUS (poll) ───────────────────────────────────
    if (method === 'GET' && path === '/api/order/status') {
      const oid = url.searchParams.get('order_id');
      if (!oid) return json(res, 400, { error: 'order_id required' });
      return json(res, 200, await getOrderStatus(oid));
    }

    // ── SCHEDULING RECORDS ────────────────────────────────────
    if (method === 'GET' && path === '/api/scheduling/records') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listSchedulingRecords({ admin_id: adminId, ...qsToObj(url) }));
    }
    if (method === 'PATCH' && path === '/api/scheduling/status') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await updateSchedulingStatus({ ...body as Parameters<typeof updateSchedulingStatus>[0], admin_id: adminId }));
    }
    if (method === 'GET' && path === '/api/scheduling/export') {
      requireAuth(adminId, res); if (!adminId) return;
      const from = url.searchParams.get('date_from') ?? '';
      const to   = url.searchParams.get('date_to') ?? '';
      return json(res, 200, await exportSchedulingRecords(adminId, from, to));
    }

    // ── PAYMENTS ─────────────────────────────────────────────
    if (method === 'POST' && path === '/api/payment/create-intent') {
      const b = body as Record<string, unknown>;
      if (!b.order_id || typeof b.order_id !== 'string')
        return json(res, 400, { error: 'order_id required' });
      return json(res, 200, await createPaymentIntent(b as unknown as Parameters<typeof createPaymentIntent>[0]));
    }
    if (method === 'POST' && path === '/api/payment/manual-link') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await createManualPaymentLink(adminId, body as Parameters<typeof createManualPaymentLink>[1]));
    }
    if (method === 'POST' && path === '/api/admin/stripe/onboard') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, { url: await createConnectOnboardingLink(adminId) });
    }

    // ── PRICING EDITOR ────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/packages') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getAdminPackages(adminId));
    }
    if (method === 'PATCH' && path === '/api/admin/packages/price') {
      requireAuth(adminId, res); if (!adminId) return;
      const b = body as Record<string, unknown>;
      if (!b.package_id || typeof b.package_id !== 'string')
        return json(res, 400, { error: 'package_id required' });
      return json(res, 200, await updatePackagePrice({ admin_id: adminId, ...b } as Parameters<typeof updatePackagePrice>[0]));
    }
    if (method === 'GET' && path === '/api/admin/special-packages') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listSpecialPackages(adminId));
    }
    if (method === 'POST' && path === '/api/admin/special-packages') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 201, await createSpecialPackage(adminId, body as Parameters<typeof createSpecialPackage>[1]));
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/special-packages/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const pkgId = path.split('/').pop();
      if (!pkgId) return json(res, 400, { error: 'Package ID required' });
      return json(res, 200, await updateSpecialPackage(adminId, pkgId, body));
    }
    if (method === 'POST' && path.startsWith('/api/admin/special-packages/') && path.endsWith('/toggle')) {
      requireAuth(adminId, res); if (!adminId) return;
      const pkgId = path.split('/')[4];
      return json(res, 200, await toggleSpecialPackage(adminId, pkgId, (body as { active: boolean }).active));
    }
    if (method === 'GET' && path === '/api/admin/scarcity') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getActiveScarcityMessages(adminId));
    }
    if (method === 'POST' && path === '/api/admin/scarcity') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await setScarcityMessage(adminId, body as Parameters<typeof setScarcityMessage>[1]));
    }

    // ── OWNER PROFILE ─────────────────────────────────────────
    if (method === 'GET' && path.startsWith('/api/profile/public/')) {
      const aid = path.split('/').pop();
      if (!aid) return json(res, 400, { error: 'admin_id required' });
      return json(res, 200, await getPublicProfile(aid));
    }
    if (method === 'GET' && path === '/api/admin/profile') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getAdminProfile(adminId));
    }
    if (method === 'POST' && path === '/api/admin/profile/generate-bio') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, { bio: await generateAiBio(adminId, body as Parameters<typeof generateAiBio>[1]) });
    }
    if (method === 'POST' && path === '/api/admin/profile') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await saveProfile(adminId, body as Parameters<typeof saveProfile>[1]));
    }
    if (method === 'POST' && path === '/api/admin/profile/publish') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await publishProfile(adminId, (body as { publish: boolean }).publish));
    }
    if (method === 'GET' && path === '/api/admin/profile/versions') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listProfileVersions(adminId));
    }
    if (method === 'POST' && path === '/api/admin/profile/restore') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await restoreProfileVersion(adminId, (body as { version: number }).version));
    }

    // ── REVIEWS ───────────────────────────────────────────────
    if (method === 'GET' && path === '/api/reviews/eligible') {
      const oid = url.searchParams.get('order_id');
      if (!oid) return json(res, 400, { error: 'order_id required' });
      return json(res, 200, await checkReviewEligibility(oid));
    }
    if (method === 'POST' && path === '/api/reviews')
      return json(res, 201, await submitReview(body as Parameters<typeof submitReview>[0]));
    if (method === 'GET' && path === '/api/admin/reviews') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listAdminReviews(adminId));
    }
    if (method === 'GET' && path === '/api/admin/reviews/stats') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getReviewStats(adminId));
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/reviews/') && path.endsWith('/feature')) {
      requireAuth(adminId, res); if (!adminId) return;
      const rid = path.split('/')[4];
      return json(res, 200, await featureReview(adminId, rid, (body as { featured: boolean }).featured));
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/reviews/') && path.endsWith('/hide')) {
      requireAuth(adminId, res); if (!adminId) return;
      const rid = path.split('/')[4];
      return json(res, 200, await hideReview(adminId, rid, (body as { hidden: boolean }).hidden));
    }
    if (method === 'POST' && path.startsWith('/api/admin/reviews/') && path.endsWith('/report')) {
      requireAuth(adminId, res); if (!adminId) return;
      const rid = path.split('/')[4];
      return json(res, 200, await reportReview(adminId, rid, (body as { reason: string }).reason));
    }

    // ── COLLABORATION ─────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/collaborations') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listCollaborations(adminId));
    }
    if (method === 'POST' && path === '/api/admin/collaborations') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 201, await sendCollaborationRequest({ requester_admin_id: adminId, ...body as object } as Parameters<typeof sendCollaborationRequest>[0]));
    }
    if (method === 'POST' && path.startsWith('/api/admin/collaborations/') && path.endsWith('/respond')) {
      requireAuth(adminId, res); if (!adminId) return;
      const cid = path.split('/')[4];
      return json(res, 200, await respondToCollaboration({ admin_id: adminId, collaboration_id: cid, ...body as object } as Parameters<typeof respondToCollaboration>[0]));
    }
    if (method === 'DELETE' && path.startsWith('/api/admin/collaborations/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const cid = path.split('/').pop();
      if (!cid) return json(res, 400, { error: 'Collaboration ID required' });
      return json(res, 200, await revokeCollaboration(adminId, cid));
    }

    // ── PROVIDER DIRECTORY ────────────────────────────────────
    if (method === 'GET' && path === '/api/providers') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await browseProviders(qsToObj(url)));
    }
    if (method === 'POST' && path === '/api/providers/apply')
      return json(res, 201, await submitProviderApplication(body as Parameters<typeof submitProviderApplication>[0]));
    if (method === 'GET' && path === '/api/admin/providers/bookmarks') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listBookmarkedProviders(adminId));
    }
    if (method === 'POST' && path.startsWith('/api/admin/providers/') && path.endsWith('/bookmark')) {
      requireAuth(adminId, res); if (!adminId) return;
      const pid = path.split('/')[4];
      return json(res, 200, await bookmarkProvider(adminId, pid, (body as { notes?: string }).notes));
    }
    if (method === 'DELETE' && path.startsWith('/api/admin/providers/') && path.endsWith('/bookmark')) {
      requireAuth(adminId, res); if (!adminId) return;
      const pid = path.split('/')[4];
      return json(res, 200, await removeBookmark(adminId, pid));
    }
    if (method === 'GET' && path === '/api/admin/providers/applications') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listPendingApplications());
    }
    if (method === 'POST' && path.startsWith('/api/admin/providers/applications/') && path.endsWith('/approve')) {
      requireAuth(adminId, res); if (!adminId) return;
      const appId = path.split('/')[5];
      return json(res, 200, await approveProviderApplication(adminId, appId));
    }
    if (method === 'POST' && path.startsWith('/api/admin/providers/applications/') && path.endsWith('/reject')) {
      requireAuth(adminId, res); if (!adminId) return;
      const appId = path.split('/')[5];
      return json(res, 200, await rejectProviderApplication(adminId, appId));
    }

    // ── LOCATION & HOURS ──────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/location') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getLocationControls(adminId));
    }
    if (method === 'PATCH' && path === '/api/admin/location') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await updateLocationControls(adminId, body as Parameters<typeof updateLocationControls>[1]));
    }
    if (method === 'POST' && path === '/api/admin/location/online') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await setOnlineStatus(adminId, (body as { online: boolean }).online));
    }
    if (method === 'PATCH' && path === '/api/admin/location/hours') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await updateOperatingHours(adminId, body as Record<string, string>));
    }
    if (method === 'GET' && path === '/api/admin/location/availability') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getAvailabilityContext(adminId));
    }

    // ── NOTIFICATIONS ─────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/notifications') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getNotificationPreferences(adminId));
    }
    if (method === 'POST' && path === '/api/admin/notifications') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await upsertNotificationPreference(adminId, body as Parameters<typeof upsertNotificationPreference>[1]));
    }
    if (method === 'POST' && path === '/api/admin/notifications/bulk') {
      requireAuth(adminId, res); if (!adminId) return;
      const b = body as { prefs: Parameters<typeof bulkUpdateNotificationPreferences>[1]; contact: Parameters<typeof bulkUpdateNotificationPreferences>[2] };
      return json(res, 200, await bulkUpdateNotificationPreferences(adminId, b.prefs, b.contact));
    }

    // ── VIP VAULT ─────────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/vault') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listVaultEntries(adminId, qsToObj(url)));
    }
    if (method === 'GET' && path.startsWith('/api/admin/vault/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const rawPhone = path.split('/').pop();
      if (!rawPhone) return json(res, 400, { error: 'customer phone required' });
      const phone = decodeURIComponent(rawPhone);
      return json(res, 200, await getVaultEntry(adminId, phone));
    }
    if (method === 'PATCH' && path.startsWith('/api/admin/vault/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const entryId = path.split('/').pop();
      if (!entryId) return json(res, 400, { error: 'Entry ID required' });
      return json(res, 200, await updateVaultEntry(adminId, entryId, body as Parameters<typeof updateVaultEntry>[2]));
    }

    // ── ANALYTICS ─────────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/analytics') {
      requireAuth(adminId, res); if (!adminId) return;
      const days = parseInt(url.searchParams.get('days') ?? '30');
      return json(res, 200, await getAnalyticsOverview(adminId, days));
    }
    if (method === 'GET' && path === '/api/admin/analytics/upsells') {
      requireAuth(adminId, res); if (!adminId) return;
      const days = parseInt(url.searchParams.get('days') ?? '30');
      return json(res, 200, await getUpsellPerformance(adminId, days));
    }
    if (method === 'GET' && path === '/api/admin/analytics/revenue') {
      requireAuth(adminId, res); if (!adminId) return;
      const days = parseInt(url.searchParams.get('days') ?? '30');
      return json(res, 200, await getRevenueByDay(adminId, days));
    }

    // ── MEDIA ─────────────────────────────────────────────────
    if (method === 'GET' && path === '/api/media/signed-url') {
      const mediaId = url.searchParams.get('media_id');
      const sessionId = url.searchParams.get('session_id') ?? 'unknown';
      if (!mediaId) return json(res, 400, { error: 'media_id required' });
      return json(res, 200, await getSignedMediaUrl(mediaId, sessionId));
    }

    // ── ADMIN DASHBOARD & TAKEOVER ────────────────────────────
    if (method === 'GET' && path === '/api/admin/dashboard') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await getDashboardSummary(adminId));
    }
    if (method === 'POST' && path === '/api/admin/takeover') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await handleAdminTakeover(adminId, (body as { conversation_id: string }).conversation_id));
    }
    if (method === 'POST' && path === '/api/admin/release') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await handleAdminRelease(adminId, (body as { conversation_id: string }).conversation_id));
    }
    if (method === 'POST' && path === '/api/admin/send-message') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await adminSendMessage({ admin_id: adminId, ...body as object } as Parameters<typeof adminSendMessage>[0]));
    }
    if (method === 'POST' && path === '/api/admin/special-requests/resolve') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await resolveSpecialRequest({ admin_id: adminId, ...body as object } as Parameters<typeof resolveSpecialRequest>[0]));
    }

    // ── CONVERSATIONS ─────────────────────────────────────────
    if (method === 'GET' && path === '/api/admin/conversations') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listConversations(adminId, qsToObj(url) as Parameters<typeof listConversations>[1]));
    }
    if (method === 'GET' && path.startsWith('/api/admin/conversations/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const convId = path.split('/').pop();
      if (!convId) return json(res, 400, { error: 'Conversation ID required' });
      return json(res, 200, await getConversationDetail(adminId, convId));
    }
    if (method === 'GET' && path === '/api/admin/special-requests') {
      requireAuth(adminId, res); if (!adminId) return;
      return json(res, 200, await listSpecialRequests(adminId, qsToObj(url) as Parameters<typeof listSpecialRequests>[1]));
    }

    // ── MEDIA GALLERY ─────────────────────────────────────────
    if (method === 'POST' && path === '/api/admin/media') {
      requireAuth(adminId, res); if (!adminId) return;
      // Pass raw req — multipart parser reads it directly
      return json(res, 201, await handleMediaUpload(req, adminId));
    }
    if (method === 'GET' && path === '/api/admin/media') {
      requireAuth(adminId, res); if (!adminId) return;
      const category = url.searchParams.get('category') ?? undefined;
      return json(res, 200, await listAdminMedia(adminId, category));
    }
    if (method === 'DELETE' && path.startsWith('/api/admin/media/')) {
      requireAuth(adminId, res); if (!adminId) return;
      const mediaId = path.split('/').pop();
      if (!mediaId) return json(res, 400, { error: 'Media ID required' });
      await deleteMedia(adminId, mediaId);
      return json(res, 200, { ok: true });
    }
    if (method === 'PATCH' && path === '/api/admin/media/reorder') {
      requireAuth(adminId, res); if (!adminId) return;
      await reorderMedia(adminId, (body as { ordered_ids: string[] }).ordered_ids);
      return json(res, 200, { ok: true });
    }

    json(res, 404, { error: 'Not found' });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Internal server error';
    console.error(`[${method} ${path}]`, err);
    json(res, 500, { error: msg });
  }
});

server.listen(PORT, () => console.log(`Ember Halo API running on port ${PORT}`));

// ── HELPERS ───────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

async function readRawBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── JWT VERIFICATION ─────────────────────────────────────────────
// Verifies Supabase-issued HS256 JWTs locally (no network round-trip).
// Falls back to unsafe decode if SUPABASE_JWT_SECRET is not set (dev only).
// Token cache prevents redundant crypto work on burst requests.

interface VerifiedPayload { sub: string; exp: number; role: string; }
const jwtCache = new Map<string, { sub: string; expiresAt: number }>();

// Purge expired cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of jwtCache) {
    if (v.expiresAt < now) jwtCache.delete(k);
  }
}, 10 * 60_000);

async function verifyJwt(token: string): Promise<string | null> {
  // Check cache first
  const cached = jwtCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.sub;

  const secret = process.env.SUPABASE_JWT_SECRET;

  if (!secret) {
    // Dev fallback: unsafe decode (logs warning once)
    if (!(verifyJwt as { warned?: boolean }).warned) {
      console.warn('[AUTH] SUPABASE_JWT_SECRET not set — JWT signatures are NOT verified. Set it for production.');
      (verifyJwt as { warned?: boolean }).warned = true;
    }
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as VerifiedPayload;
      if (payload.exp * 1000 < Date.now()) return null; // expired
      return payload.sub ?? null;
    } catch { return null; }
  }

  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    // Import the HMAC key
    const keyData = new TextEncoder().encode(secret);
    const cryptoKey = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );

    // Verify signature
    const signingInput = `${headerB64}.${payloadB64}`;
    const signature = Buffer.from(sigB64, 'base64url');
    const valid = await crypto.subtle.verify(
      'HMAC', cryptoKey, signature, new TextEncoder().encode(signingInput)
    );
    if (!valid) return null;

    // Decode and check expiry
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString()) as VerifiedPayload;
    if (payload.exp * 1000 < Date.now()) return null; // expired
    if (!payload.sub) return null;

    // Cache for remaining token lifetime (cap at 15 min)
    const ttl = Math.min(payload.exp * 1000 - Date.now(), 15 * 60_000);
    jwtCache.set(token, { sub: payload.sub, expiresAt: Date.now() + ttl });

    return payload.sub;
  } catch { return null; }
}

async function extractAdminId(req: http.IncomingMessage): Promise<string | null> {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) return null;
  return verifyJwt(auth.slice(7));
}

function requireAuth(adminId: string | null, res: http.ServerResponse): void {
  if (!adminId) { json(res, 401, { error: 'Unauthorized' }); }
}

function qsToObj(url: URL): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  url.searchParams.forEach((v, k) => { obj[k] = v; });
  return obj;
}
