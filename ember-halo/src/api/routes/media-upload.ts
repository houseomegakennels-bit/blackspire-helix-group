/**
 * Ember Halo — Media Upload Route
 * Handles multipart form upload, strips EXIF, stores to Supabase Storage.
 * Returns media_id for use in gallery, profiles, and special packages.
 */

import http from 'http';
import { createClient } from '@supabase/supabase-js';
import { uploadAdminMedia } from '../../lib/media.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

export interface UploadResult {
  media_id: string;
  storage_path: string;
  category: string;
}

/**
 * Parses a multipart/form-data request and extracts the image buffer.
 * Simple boundary-based parser — no external dependency needed.
 */
export async function handleMediaUpload(
  req: http.IncomingMessage,
  adminId: string
): Promise<UploadResult> {
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('multipart/form-data')) {
    throw new Error('Expected multipart/form-data');
  }

  const boundary = contentType.split('boundary=')[1];
  if (!boundary) throw new Error('Missing multipart boundary');

  const raw = await readFullBody(req);
  const { imageBuffer, mimeType, category, caption, applyWatermark } =
    parseMultipart(raw, boundary);

  if (!imageBuffer || imageBuffer.length === 0) throw new Error('No image data found');
  if (!ALLOWED_TYPES.has(mimeType)) throw new Error(`Unsupported type: ${mimeType}`);
  if (imageBuffer.length > MAX_FILE_SIZE) throw new Error('File too large (max 10MB)');

  const result = await uploadAdminMedia({
    adminId,
    imageBuffer,
    mimeType,
    category: category ?? 'luxury_roses',
    caption: caption ?? undefined,
    applyWatermark: applyWatermark === 'true',
    watermarkText: applyWatermark === 'true' ? `eh-${adminId.substring(0, 6)}` : undefined,
  });

  return { ...result, category: category ?? 'luxury_roses' };
}

export async function deleteMedia(adminId: string, mediaId: string): Promise<void> {
  const { data, error } = await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .select('storage_path, admin_id')
    .eq('id', mediaId)
    .single();

  if (error || !data) throw new Error('Media not found');
  if (data.admin_id !== adminId) throw new Error('Unauthorized');

  // Soft delete — set inactive
  await supabase
    .schema('ember_halo')
    .from('media_gallery')
    .update({ is_active: false })
    .eq('id', mediaId);
}

export async function listAdminMedia(adminId: string, category?: string) {
  let query = supabase
    .schema('ember_halo')
    .from('media_gallery')
    .select('id, category, caption, sort_order, uploaded_at')
    .eq('admin_id', adminId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('uploaded_at', { ascending: false });

  if (category) query = query.eq('category', category);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function reorderMedia(adminId: string, orderedIds: string[]): Promise<void> {
  const updates = orderedIds.map((id, index) =>
    supabase.schema('ember_halo').from('media_gallery')
      .update({ sort_order: index })
      .eq('id', id)
      .eq('admin_id', adminId)
  );
  await Promise.all(updates);
}

// ── MULTIPART PARSER ──────────────────────────────────────────

function parseMultipart(body: Buffer, boundary: string): {
  imageBuffer: Buffer | null;
  mimeType: string;
  category: string | null;
  caption: string | null;
  applyWatermark: string | null;
} {
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(body, delimiter);

  let imageBuffer: Buffer | null = null;
  let mimeType = 'image/jpeg';
  let category: string | null = null;
  let caption: string | null = null;
  let applyWatermark: string | null = null;

  for (const part of parts) {
    if (part.length < 4) continue;

    const headerEnd = indexOfSequence(part, Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerStr = part.slice(0, headerEnd).toString('utf8');
    const partBody  = part.slice(headerEnd + 4);

    // Strip trailing \r\n
    const cleanBody = partBody.slice(0, partBody.length - 2);

    if (headerStr.includes('filename=')) {
      const ctMatch = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);
      if (ctMatch) mimeType = ctMatch[1].trim();
      imageBuffer = cleanBody;
    } else {
      const nameMatch = headerStr.match(/name="([^"]+)"/);
      if (!nameMatch) continue;
      const fieldName = nameMatch[1];
      const value = cleanBody.toString('utf8');

      if (fieldName === 'category') category = value;
      else if (fieldName === 'caption') caption = value;
      else if (fieldName === 'apply_watermark') applyWatermark = value;
    }
  }

  return { imageBuffer, mimeType, category, caption, applyWatermark };
}

function splitBuffer(buf: Buffer, delimiter: Buffer): Buffer[] {
  const parts: Buffer[] = [];
  let start = 0;
  while (start < buf.length) {
    const idx = indexOfSequence(buf, delimiter, start);
    if (idx === -1) break;
    if (idx > start) parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
    // skip CRLF after boundary
    if (buf[start] === 0x0d && buf[start + 1] === 0x0a) start += 2;
  }
  return parts.filter(p => p.length > 0);
}

function indexOfSequence(buf: Buffer, seq: Buffer, start = 0): number {
  for (let i = start; i <= buf.length - seq.length; i++) {
    if (buf.slice(i, i + seq.length).equals(seq)) return i;
  }
  return -1;
}

async function readFullBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_FILE_SIZE + 4096) reject(new Error('Upload too large'));
      else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
