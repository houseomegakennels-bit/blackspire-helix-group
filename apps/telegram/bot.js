import fs from 'node:fs';
import path from 'node:path';
import { TELEGRAM_ALLOWED_USERS, ADMIN_TOKEN, PUBLIC_BASE_URL, ATTACHMENTS_DIR, ALLOW_BEARER_AUTH } from '../../packages/shared/config.js';
import { escapeMarkdown, redact, id } from '../../packages/shared/util.js';
import { rateLimit } from '../../packages/shared/security.js';
import { transcribeVoice } from '../../packages/shared/transcription.js';
import { recordAttachment } from '../../packages/task-engine/attachments.js';
import { audit } from '../../packages/task-engine/tasks.js';

const MIME_EXTENSIONS = { 'text/plain': '.txt', 'text/markdown': '.md', 'application/json': '.json', 'audio/ogg': '.oga', 'audio/mpeg': '.mp3' };
const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS);
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/json']);

const sessions = new Map();
const seen = new Set();

export async function handleTelegramUpdate(update, apiBase = PUBLIC_BASE_URL) {
  if (seen.has(update.update_id)) return { ignored: true, reason: 'duplicate' };
  seen.add(update.update_id);
  const msg = update.message || update.callback_query?.message;
  const from = update.message?.from || update.callback_query?.from || {};
  if (!TELEGRAM_ALLOWED_USERS.includes(Number(from.id))) return { ignored: true };
  const limit = rateLimit(`telegram:${from.id}`, { limit: Number(process.env.TELEGRAM_RATE_LIMIT || 30), windowMs: 60000 });
  if (!limit.allowed) return { chatId: msg?.chat?.id, text: chunk(escapeMarkdown(`Rate limit exceeded. Retry after ${limit.retryAfter}s`)) };
  const text = update.message?.text || update.callback_query?.data || '';
  const chatId = msg?.chat?.id;
  const send = (message, extra = {}) => ({ chatId, text: chunk(escapeMarkdown(message)), ...extra });

  if (text.startsWith('/start') || text.startsWith('/help')) return send('Blackspire Command online. Use /task <request>, /tasks, /workspaces, /status, /export <id>, /stop.');
  if (text.startsWith('/status') || text.startsWith('/health')) return send(JSON.stringify(await get('/health', apiBase)));
  if (text.startsWith('/workspaces')) return send((await get('/api/workspaces', apiBase)).workspaces.map((w) => `${w.id}: ${w.name}`).join('\n'));
  if (text.startsWith('/use ')) {
    sessions.set(from.id, text.slice(5).trim());
    return send(`Workspace set to ${sessions.get(from.id)}`);
  }
  if (text.startsWith('/task ')) {
    const body = { request: text.slice(6), workspaceId: sessions.get(from.id) || 'blackspire-command' };
    const result = await post('/api/tasks', body, apiBase);
    return send(result.task ? `Queued ${result.task.id}: ${result.task.request}` : `Task rejected: ${result.error || 'unknown error'}`);
  }
  if (text.startsWith('/tasks')) return send((await get('/api/tasks', apiBase)).tasks.map((t) => `${t.id} ${t.status} ${t.request}`).join('\n') || 'No tasks');
  if (text.startsWith('/export ')) {
    const taskId = text.slice(8).trim();
    const bundle = await get(`/api/tasks/${taskId}/export.json`, apiBase);
    audit(taskId, 'telegram', 'evidence.delivery_requested', { chatId });
    return deliverPayload(chatId, bundle, `${taskId}-evidence.json`, send);
  }
  const one = text.match(/^\/(task_status|logs|approve|reject|pause|resume|cancel)\s+(\S+)/);
  if (one) {
    const [, cmd, taskId] = one;
    if (cmd === 'logs') {
      const result = await get(`/api/tasks/${taskId}/logs`, apiBase);
      return deliverPayload(chatId, result, `${taskId}-logs.json`, send);
    }
    const route = cmd === 'task_status' ? `/api/tasks/${taskId}` : `/api/tasks/${taskId}/${cmd}`;
    const result = cmd === 'task_status' ? await get(route, apiBase) : await post(route, {}, apiBase);
    return send(JSON.stringify(result).slice(0, 3500));
  }
  if (text.startsWith('/stop')) return send(JSON.stringify(await post('/api/stop', {}, apiBase)));
  if (update.message?.document || update.message?.voice) return handleTelegramAttachment(update, apiBase, send);
  return send('Unknown command. Use /help.');
}

// If the serialized payload fits in one Telegram message, send it as escaped text like everything else.
// Otherwise write it to a temp file and hand back a "document" reply so dispatchReply can sendDocument
// instead of silently truncating evidence bundles or long log histories.
function deliverPayload(chatId, payload, filename, send) {
  const serialized = JSON.stringify(payload, null, 2);
  if (serialized.length <= Number(process.env.TELEGRAM_INLINE_MAX_CHARS || 3500)) return send(serialized);
  const dir = path.resolve(ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, `${Date.now()}-${filename.replace(/[^A-Za-z0-9._-]/g, '_')}`);
  fs.writeFileSync(filePath, serialized);
  return { chatId, document: { path: filePath, caption: filename } };
}

export async function telegramGetFile(token, fileId) {
  const response = await fetch(`https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const body = await response.json();
  if (!body.ok) throw new Error(`Telegram getFile failed: ${body.description || 'unknown error'}`);
  return body.result;
}

export async function telegramDownloadFile(token, filePath) {
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!response.ok) throw new Error(`Telegram file download failed with status ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function safeFileName(file, mime) {
  const base = file.file_name ? path.basename(file.file_name) : `${file.file_id}${MIME_EXTENSIONS[mime] || '.bin'}`;
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '') || `${id('file')}.bin`;
  return `${Date.now()}-${sanitized}`;
}

function cleanupTelegramFile(filePath) {
  try { fs.rmSync(filePath, { force: true }); } catch { /* already gone */ }
}

export async function handleTelegramAttachment(update, apiBase = PUBLIC_BASE_URL, send = (message) => ({ text: chunk(escapeMarkdown(message)) })) {
  const message = update.message || {};
  const file = message.document || message.voice;
  const kind = message.voice ? 'voice' : 'document';
  const declaredSize = Number(file?.file_size || 0);
  const mime = file?.mime_type || (kind === 'voice' ? 'audio/ogg' : 'application/octet-stream');
  const maxBytes = Number(process.env.TELEGRAM_FILE_MAX_BYTES || 2_000_000);
  const chatId = message.chat?.id;
  const workspaceId = sessions.get(message.from?.id) || 'blackspire-command';

  if (declaredSize > maxBytes) return send('Attachment rejected: file too large.');
  if (!ALLOWED_MIME_TYPES.includes(mime)) return send(`Attachment rejected: MIME ${mime} is not allowlisted.`);

  const token = process.env.TELEGRAM_BOT_TOKEN || 'test-token';
  let buffer;
  try {
    const fileInfo = await telegramGetFile(token, file.file_id);
    buffer = await telegramDownloadFile(token, fileInfo.file_path);
  } catch (error) {
    return send(`Attachment download failed: ${redact(error.message)}`);
  }
  if (buffer.length > maxBytes) return send('Attachment rejected: downloaded file exceeds the size limit.');

  const dir = path.resolve(ATTACHMENTS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = safeFileName(file, mime);
  const storedPath = path.join(dir, safeName);
  fs.writeFileSync(storedPath, buffer);

  try {
    if (kind === 'voice') return await handleVoiceNote({ file, mime, buffer, storedPath, chatId, workspaceId, apiBase, send });
    return await handleDocument({ file, mime, buffer, storedPath, safeName, chatId, workspaceId, apiBase, send });
  } finally {
    cleanupTelegramFile(storedPath);
  }
}

async function handleDocument({ file, mime, buffer, storedPath, safeName, chatId, workspaceId, apiBase, send }) {
  const textExcerpt = TEXT_MIME_TYPES.has(mime) ? buffer.toString('utf8').slice(0, 2000) : null;
  const request = textExcerpt ? `Process uploaded attachment ${safeName}:\n\n${textExcerpt}` : `Process uploaded attachment ${safeName}`;
  const result = await post('/api/tasks', { request, workspaceId }, apiBase);
  const attachmentId = recordAttachment({ taskId: result.task?.id || null, workspaceId, chatId, fileId: file.file_id, fileName: safeName, mimeType: mime, sizeBytes: buffer.length, kind: 'document', storedPath, textExcerpt });
  audit(result.task?.id || null, 'telegram', 'attachment.received', { attachmentId, kind: 'document', mimeType: mime, sizeBytes: buffer.length });
  return send(result.task ? `Attachment stored and task queued ${result.task.id}` : `Attachment rejected: ${result.error}`);
}

async function handleVoiceNote({ file, mime, buffer, storedPath, chatId, workspaceId, apiBase, send }) {
  const transcription = await transcribeVoice(storedPath, mime);
  if (transcription.status === 'unavailable') {
    const attachmentId = recordAttachment({ workspaceId, chatId, fileId: file.file_id, fileName: `${file.file_id}.oga`, mimeType: mime, sizeBytes: buffer.length, kind: 'voice', storedPath, transcriptionStatus: 'unavailable' });
    audit(null, 'telegram', 'attachment.voice_unavailable', { attachmentId, reason: transcription.reason });
    return send(`Voice note received but transcription is unavailable: ${transcription.reason}`);
  }
  if (transcription.status === 'failed') {
    const attachmentId = recordAttachment({ workspaceId, chatId, fileId: file.file_id, fileName: `${file.file_id}.oga`, mimeType: mime, sizeBytes: buffer.length, kind: 'voice', storedPath, transcriptionStatus: 'failed' });
    audit(null, 'telegram', 'attachment.voice_transcription_failed', { attachmentId, reason: transcription.reason });
    return send(`Voice note transcription failed: ${transcription.reason}. The failure was recorded for administrator follow-up.`);
  }
  const result = await post('/api/tasks', { request: transcription.text, workspaceId }, apiBase);
  const attachmentId = recordAttachment({ taskId: result.task?.id || null, workspaceId, chatId, fileId: file.file_id, fileName: `${file.file_id}.oga`, mimeType: mime, sizeBytes: buffer.length, kind: 'voice', storedPath, textExcerpt: transcription.text, transcriptionStatus: 'ok' });
  audit(result.task?.id || null, 'telegram', 'attachment.voice_transcribed', { attachmentId });
  return send(result.task ? `Voice task queued ${result.task.id}: ${transcription.text}` : `Voice task rejected: ${result.error}`);
}

export async function sendTelegramDocument(token, chatId, filePath, caption = '') {
  const body = new FormData();
  body.append('chat_id', String(chatId));
  body.append('caption', caption);
  body.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  const response = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: 'POST', body });
  return response.json();
}

export async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const chunks = chunk(text);
  const sent = [];
  for (const part of chunks) {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'MarkdownV2', ...extra }),
    });
    sent.push(await response.json());
  }
  return sent;
}

// Live Telegram transport (getUpdates/sendMessage/sendDocument/getFile against api.telegram.org) is
// UNVERIFIED in this environment: it has only been exercised against a mocked fetch in tests. It becomes
// verified only once a real TELEGRAM_BOT_TOKEN is configured and a human confirms delivery end-to-end.
export async function dispatchReply(token, reply) {
  if (!reply || reply.ignored) return { sent: false, reason: 'ignored' };
  if (!token) return { sent: false, reason: 'no bot token configured (dry-run)' };
  if (reply.document) {
    const result = await sendTelegramDocument(token, reply.chatId, reply.document.path, reply.document.caption || '');
    cleanupTelegramFile(reply.document.path);
    return { sent: true, mode: 'document', result };
  }
  const result = [];
  for (const text of reply.text || []) result.push(await sendTelegramMessage(token, reply.chatId, text, reply.extra || {}));
  return { sent: true, mode: 'text', result };
}

export async function runPolling({ token = process.env.TELEGRAM_BOT_TOKEN, apiBase = PUBLIC_BASE_URL, pollMs = 1500 } = {}) {
  if (!token) {
    console.log(JSON.stringify({ service: 'telegram', mode: 'dry-run', reason: 'TELEGRAM_BOT_TOKEN not configured' }));
    return { stop: () => undefined, mode: 'dry-run' };
  }
  let offset = 0;
  let stopped = false;
  async function poll() {
    if (stopped) return;
    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/getUpdates?timeout=10&offset=${offset}`);
      const payload = await response.json();
      for (const update of payload.result || []) {
        offset = Math.max(offset, update.update_id + 1);
        const reply = await handleTelegramUpdate(update, apiBase);
        await dispatchReply(token, reply);
      }
    } catch (error) {
      console.error(JSON.stringify({ service: 'telegram', error: redact(error.message) }));
    } finally {
      if (!stopped) setTimeout(poll, pollMs).unref();
    }
  }
  poll();
  console.log(JSON.stringify({ service: 'telegram', mode: 'polling' }));
  return { stop: () => { stopped = true; }, mode: 'polling' };
}

function chunk(value) {
  const source = String(value || '');
  const output = [];
  for (let i = 0; i < source.length || i === 0; i += 3900) output.push(source.slice(i, i + 3900));
  return output;
}

async function get(path, base) {
  const headers = ALLOW_BEARER_AUTH ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
  const response = await fetch(base + path, { headers });
  return response.json();
}

async function post(path, body, base) {
  const headers = { 'content-type': 'application/json', ...(ALLOW_BEARER_AUTH ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {}) };
  const response = await fetch(base + path, { method: 'POST', headers, body: JSON.stringify(body) });
  return response.json();
}

if (import.meta.url === `file://${process.argv[1]}`) runPolling();
