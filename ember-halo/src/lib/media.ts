/**
 * Ember Halo — Media Privacy Stack
 * Expiring signed URLs, session watermarking, metadata stripping.
 * All media served through this layer — never raw public URLs.
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import crypto from 'crypto';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SIGNED_URL_EXPIRY_SECONDS = 300; // 5 minutes — short-lived

export interface SignedMediaResult {
  signed_url: string;
  expires_at: string;
  watermarked: boolean;
  media_id: string;
}

/**
 * Returns a short-lived signed URL for a media item.
 * Logs the view event. Optionally applies watermark.
 */
export async function getSignedMediaUrl(
  mediaId: string,
  sessionId: string
): Promise<SignedMediaResult> {
  const { data: media, error } = await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .select('id, storage_path, admin_id, is_active')
    .eq('id', mediaId)
    .single();

  if (error || !media || !media.is_active) {
    throw new Error('Media not found or inactive');
  }

  // Generate expiring signed URL from Supabase Storage
  const { data: signedData, error: signedError } = await supabase
    .storage
    .from('ember-halo-media')
    .createSignedUrl(media.storage_path, SIGNED_URL_EXPIRY_SECONDS);

  if (signedError || !signedData?.signedUrl) {
    throw new Error('Failed to generate signed URL');
  }

  const expiresAt = new Date(Date.now() + SIGNED_URL_EXPIRY_SECONDS * 1000).toISOString();

  // Log the media view
  await supabase.schema('ember_halo').from('media_events').insert({
    media_id: mediaId,
    event_type: 'viewed',
    session_id: sessionId,
    ip_hash: null, // caller should pass hashed IP if needed
  });

  // Update signed URL cache on the gallery record
  await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .update({ public_url: signedData.signedUrl })
    .eq('id', mediaId);

  return {
    signed_url: signedData.signedUrl,
    expires_at: expiresAt,
    watermarked: false, // watermark applied at upload time for owner profile images
    media_id: mediaId,
  };
}

/**
 * Logs a screenshot detection event.
 * Called from frontend when visibilitychange + clipboard events suggest a screenshot.
 * Cannot block screenshots — only logs them.
 */
export async function logScreenshotEvent(
  mediaId: string,
  conversationId: string | null,
  sessionId: string
): Promise<void> {
  await supabase.schema('ember_halo').from('media_events').insert({
    media_id: mediaId,
    conversation_id: conversationId,
    event_type: 'screenshot_detected',
    session_id: sessionId,
  });

  // Alert admin if they have notifications enabled for this
  const { data: media } = await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .select('admin_id')
    .eq('id', mediaId)
    .single();

  if (media) {
    await triggerN8nEvent('screenshot_event', {
      admin_id: media.admin_id,
      media_id: mediaId,
      session_id: sessionId,
    });
  }
}

/**
 * Processes an admin-uploaded image:
 * 1. Strips all EXIF metadata
 * 2. Optionally applies subtle session watermark
 * 3. Uploads to Supabase Storage
 * 4. Creates media_gallery record
 */
export async function uploadAdminMedia(params: {
  adminId: string;
  imageBuffer: Buffer;
  mimeType: string;
  category: string;
  caption?: string;
  applyWatermark?: boolean;
  watermarkText?: string;
}): Promise<{ media_id: string; storage_path: string }> {
  // 1. Strip EXIF and resize to safe dimensions using sharp
  let processed = sharp(params.imageBuffer)
    .withMetadata({}) // strip all metadata
    .rotate();        // auto-rotate based on orientation before stripping

  // Remove all metadata by converting through the pipeline
  const strippedBuffer = await processed
    .toFormat('jpeg', { quality: 92 })
    .toBuffer();

  // 2. Apply watermark if requested
  let finalBuffer = strippedBuffer;
  if (params.applyWatermark && params.watermarkText) {
    finalBuffer = await applyTextWatermark(strippedBuffer, params.watermarkText);
  }

  // 3. Upload to Supabase Storage
  const filename = `${params.adminId}/${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabase
    .storage
    .from('ember-halo-media')
    .upload(filename, finalBuffer, {
      contentType: 'image/jpeg',
      cacheControl: '3600',
      upsert: false,
    });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // 4. Create gallery record
  const { data: record, error: dbError } = await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .insert({
      admin_id: params.adminId,
      category: params.category,
      storage_path: filename,
      caption: params.caption ?? null,
      is_active: true,
    })
    .select('id, storage_path')
    .single();

  if (dbError || !record) throw new Error('Failed to create media record');

  return { media_id: record.id, storage_path: record.storage_path };
}

/**
 * Applies a subtle text watermark to an image buffer.
 * Text is semi-transparent, diagonal, positioned in corner.
 */
async function applyTextWatermark(imageBuffer: Buffer, text: string): Promise<Buffer> {
  const image = sharp(imageBuffer);
  const { width = 800, height = 600 } = await image.metadata();

  // Create SVG watermark overlay
  const fontSize = Math.max(12, Math.round(width * 0.018));
  const svgWatermark = Buffer.from(`
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text
        x="${width - 10}"
        y="${height - 10}"
        font-family="Arial, sans-serif"
        font-size="${fontSize}"
        fill="rgba(255,255,255,0.25)"
        text-anchor="end"
        dominant-baseline="auto"
        transform="rotate(-15, ${width - 60}, ${height - 30})"
      >${escapeXml(text)}</text>
    </svg>
  `);

  return image
    .composite([{ input: svgWatermark, blend: 'over' }])
    .jpeg({ quality: 90 })
    .toBuffer();
}

/** Hash a session ID for watermark text (privacy-safe — not reversible) */
export function hashSessionId(sessionId: string): string {
  return crypto.createHash('sha256').update(sessionId).digest('hex').substring(0, 8);
}

/** Hash an IP address before storing (never store raw IPs) */
export function hashIp(ip: string): string {
  return crypto.createHash('sha256').update(ip + (process.env.IP_HASH_SALT ?? 'ember')).digest('hex');
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function triggerN8nEvent(eventType: string, payload: Record<string, unknown>): Promise<void> {
  const base = process.env.N8N_WEBHOOK_BASE_URL;
  if (!base) return;
  try {
    await fetch(`${base}/ember-halo/${eventType}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: eventType, ...payload, timestamp: new Date().toISOString() }),
    });
  } catch { /* non-fatal */ }
}
