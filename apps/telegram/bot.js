import fs from 'node:fs';
import path from 'node:path';
import { TELEGRAM_ALLOWED_USERS, ADMIN_TOKEN, PUBLIC_BASE_URL, ATTACHMENTS_DIR, ALLOW_BEARER_AUTH } from '../../packages/shared/config.js';
import { escapeMarkdown, redact, id } from '../../packages/shared/util.js';
import { rateLimit } from '../../packages/shared/security.js';
import { transcribeVoice } from '../../packages/shared/transcription.js';
import { recordAttachment } from '../../packages/task-engine/attachments.js';
import { audit } from '../../packages/task-engine/tasks.js';
import { createUnifiedInput, getConversation, channelCanAccessConversation, channelCanAccessTask, cancelFromChannel } from '../../packages/unified-input/unified.js';

const MIME_EXTENSIONS = { 'text/plain': '.txt', 'text/markdown': '.md', 'application/json': '.json', 'audio/ogg': '.oga', 'audio/mpeg': '.mp3' };
const ALLOWED_MIME_TYPES = Object.keys(MIME_EXTENSIONS);
const TEXT_MIME_TYPES = new Set(['text/plain', 'text/markdown', 'application/json']);

const DEFAULT_TELEGRAM_TIMEOUT_MS = 15_000;
const DEFAULT_TELEGRAM_MAX_ATTEMPTS = 3;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function retryDelay(attempt, retryAfter) {
  const serverDelay = Number(retryAfter);
  if (Number.isFinite(serverDelay) && serverDelay >= 0) return Math.min(serverDelay * 1000, 30_000);
  return Math.min(250 * (2 ** (attempt - 1)), 2_000);
}

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function telegramError(method, body, status) {
  const description = redact(body?.description || `HTTP ${status}`);
  const error = new Error(`Telegram ${method} failed: ${description}`);
  error.retryable = status === 429 || status >= 500 || Number(body?.error_code) === 429 || Number(body?.error_code) >= 500;
  error.retryAfter = body?.parameters?.retry_after;
  return error;
}

export async function telegramRequest(method, token, { query = '', init, timeoutMs, maxAttempts, fetchImpl = fetch, wait = delay } = {}) {
  const attempts = positiveInteger(maxAttempts ?? process.env.TELEGRAM_MAX_ATTEMPTS, DEFAULT_TELEGRAM_MAX_ATTEMPTS);
  const timeout = positiveInteger(timeoutMs ?? process.env.TELEGRAM_REQUEST_TIMEOUT_MS, DEFAULT_TELEGRAM_TIMEOUT_MS);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}${query}`, { ...init, signal: AbortSignal.timeout(timeout) });
      let body;
      try { body = await response.json(); } catch { throw telegramError(method, null, response.status); }
      if (!response.ok || body?.ok !== true) throw telegramError(method, body, response.status);
      return body;
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable || error?.name === 'AbortError' || error?.name === 'TimeoutError' || error instanceof TypeError;
      if (!retryable || attempt === attempts) throw error;
      await wait(retryDelay(attempt, error.retryAfter));
    }
  }
  throw lastError;
}

const sessions = new Map();
const conversations = new Map();
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

  if (text.startsWith('/start') || text.startsWith('/help')) return send('Blackspire Command online. Use /task <request>, /conversation <id>, /tasks, /workspaces, /status, or /cancel <task-id>. Privileged actions require authenticated Jarvis.');
  if (text.startsWith('/status') || text.startsWith('/health')) return send(JSON.stringify(await get('/health', apiBase)));
  if (text.startsWith('/workspaces')) return send((await get('/api/workspaces', apiBase)).workspaces.map((w) => `${w.id}: ${w.name}`).join('\n'));
  if (text.startsWith('/use ')) {
    sessions.set(from.id, text.slice(5).trim());
    return send(`Workspace set to ${sessions.get(from.id)}`);
  }
  if (text.startsWith('/conversation ')) {
    const conversationId = text.slice(14).trim();
    if (!channelCanAccessConversation('telegram', String(chatId), conversationId)) return send('Conversation not found or not available to this Telegram chat.');
    conversations.set(from.id, conversationId);
    return send(`Conversation set to ${conversationId}`);
  }
  if (text.startsWith('/task ')) {
    const result = createUnifiedInput({ channel: 'telegram', actorId: String(from.id), channelKey: String(chatId), conversationId: conversations.get(from.id) || null, workspaceId: sessions.get(from.id) || 'blackspire-command', text: text.slice(6), idempotencyKey: `telegram:${update.update_id}`, metadata: { chatId }, authority: 'telegram' });
    if (result.conversationId) conversations.set(from.id, result.conversationId);
    return send(result.taskId ? `${result.denied ? 'Denied' : 'Queued'} conversation ${result.conversationId} task ${result.taskId}${result.error ? `: ${result.error}` : ''}` : `Task rejected: ${result.error || 'unknown error'}`);
  }
  if (text.startsWith('/tasks')) {
    const conversation = getConversation(conversations.get(from.id));
    return send((conversation?.tasks || []).map((t) => `${t.id} ${t.status} ${t.request}`).join('\n') || 'No tasks in this conversation');
  }
  if (text.startsWith('/export ')) {
    const taskId = text.slice(8).trim();
    if (!channelCanAccessTask('telegram', String(chatId), taskId)) return send('Task not found for this Telegram conversation.');
    const bundle = await get(`/api/tasks/${taskId}/export.json`, apiBase);
    audit(taskId, 'telegram', 'evidence.delivery_requested', { chatId });
    return deliverPayload(chatId, bundle, `${taskId}-evidence.json`, send);
  }
  const one = text.match(/^\/(task_status|logs|approve|reject|pause|resume|cancel)\s+(\S+)/);
  if (one) {
    const [, cmd, taskId] = one;
    if (['approve', 'reject', 'pause', 'resume'].includes(cmd)) return send('Privileged task actions require an authenticated Jarvis session.');
    if (!channelCanAccessTask('telegram', String(chatId), taskId)) return send('Task not found for this Telegram conversation.');
    if (cmd === 'cancel') return send(JSON.stringify(cancelFromChannel('telegram', String(chatId), taskId)));
    if (cmd === 'logs') {
      const result = await get(`/api/tasks/${taskId}/logs`, apiBase);
      return deliverPayload(chatId, result, `${taskId}-logs.json`, send);
    }
    const route = `/api/tasks/${taskId}`;
    const result = await get(route, apiBase);
    return send(JSON.stringify(result).slice(0, 3500));
  }
  if (/^\/(stop|approve|reject|deploy|merge|reset|secrets?|credentials?|trade|trading|create[_-]?repo(?:sitory)?)(?:\s|$)/i.test(text)) return send('Telegram cannot perform privileged actions. Use authenticated Jarvis.');
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
  return (await telegramRequest('getFile', token, { query: `?file_id=${encodeURIComponent(fileId)}` })).result;
}

export async function telegramDownloadFile(token, filePath) {
  const attempts = positiveInteger(process.env.TELEGRAM_MAX_ATTEMPTS, DEFAULT_TELEGRAM_MAX_ATTEMPTS);
  const timeout = positiveInteger(process.env.TELEGRAM_REQUEST_TIMEOUT_MS, DEFAULT_TELEGRAM_TIMEOUT_MS);
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`, { signal: AbortSignal.timeout(timeout) });
      if (!response.ok) {
        const error = new Error(`Telegram file download failed with status ${response.status}`);
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      const retryable = error?.retryable || error?.name === 'AbortError' || error?.name === 'TimeoutError' || error instanceof TypeError;
      if (!retryable || attempt === attempts) throw error;
      await delay(retryDelay(attempt));
    }
  }
  throw lastError;
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
  const result = createUnifiedInput({ channel: 'telegram', actorId: String(chatId), channelKey: String(chatId), workspaceId, text: request, idempotencyKey: `telegram:file:${chatId}:${file.file_id}`, metadata: { chatId, attachment: true }, authority: 'telegram' });
  const attachmentId = recordAttachment({ taskId: result.taskId || null, workspaceId, chatId, fileId: file.file_id, fileName: safeName, mimeType: mime, sizeBytes: buffer.length, kind: 'document', storedPath, textExcerpt });
  audit(result.taskId || null, 'telegram', 'attachment.received', { attachmentId, kind: 'document', mimeType: mime, sizeBytes: buffer.length });
  return send(result.taskId ? `${result.denied ? 'Attachment denied' : 'Attachment stored and task queued'} ${result.taskId}${result.error ? `: ${result.error}` : ''}` : `Attachment rejected: ${result.error}`);
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
  const result = createUnifiedInput({ channel: 'telegram', actorId: String(chatId), channelKey: String(chatId), workspaceId, text: transcription.text, idempotencyKey: `telegram:voice:${chatId}:${file.file_id}`, metadata: { chatId, attachment: true }, authority: 'telegram' });
  const attachmentId = recordAttachment({ taskId: result.taskId || null, workspaceId, chatId, fileId: file.file_id, fileName: `${file.file_id}.oga`, mimeType: mime, sizeBytes: buffer.length, kind: 'voice', storedPath, textExcerpt: transcription.text, transcriptionStatus: 'ok' });
  audit(result.taskId || null, 'telegram', 'attachment.voice_transcribed', { attachmentId });
  return send(result.taskId ? `${result.denied ? 'Voice task denied' : 'Voice task queued'} ${result.taskId}${result.denied ? `: ${result.error}` : `: ${transcription.text}`}` : `Voice task rejected: ${result.error}`);
}

export async function sendTelegramDocument(token, chatId, filePath, caption = '') {
  const body = new FormData();
  body.append('chat_id', String(chatId));
  body.append('caption', caption);
  body.append('document', new Blob([fs.readFileSync(filePath)]), path.basename(filePath));
  return telegramRequest('sendDocument', token, { init: { method: 'POST', body } });
}

export async function sendTelegramMessage(token, chatId, text, extra = {}) {
  const chunks = chunk(text);
  const sent = [];
  for (const part of chunks) {
    sent.push(await telegramRequest('sendMessage', token, { init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, parse_mode: 'MarkdownV2', ...extra }),
    } }));
  }
  return sent;
}

// Live Telegram transport (getUpdates/sendMessage/sendDocument/getFile against api.telegram.org) is
// UNVERIFIED in this environment: it has only been exercised against a mocked fetch in tests. It becomes
// verified only once a real TELEGRAM_BOT_TOKEN is configured and a human confirms delivery end-to-end.
export async function dispatchReply(token, reply) {
  if (!reply || reply.ignored) return { sent: false, reason: 'ignored' };
  if (process.env.TELEGRAM_MODE === 'mock') return { sent: true, mode: 'mock', result: { fixture: true } };
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
      const updates = (await telegramRequest('getUpdates', token, { query: `?timeout=10&offset=${offset}` })).result;
      if (!Array.isArray(updates)) throw new TypeError('Telegram getUpdates result must be an array');
      for (const update of [...updates].sort((a, b) => Number(a.update_id) - Number(b.update_id))) {
        if (!Number.isSafeInteger(update?.update_id) || update.update_id < offset) continue;
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
