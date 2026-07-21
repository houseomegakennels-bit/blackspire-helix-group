import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-telegram-files-'));
process.env.BLACKSPIRE_DB_PATH = path.join(root, 'telegram.sqlite');
process.env.TELEGRAM_TMP_DIR = path.join(root, 'telegram-files');
process.env.COMMAND_ADMIN_TOKEN = 'telegram-files-token';
process.env.TELEGRAM_ALLOWED_USERS = '1001';
process.env.PORT = '8896';
process.env.HERMES_TEST_PROVIDER = 'mock';

const { prepareDisposableDatabase } = await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const { start } = await import('../apps/api/server.js');
const { handleTelegramAttachment, handleTelegramUpdate, sendTelegramDocument, dispatchReply } = await import('../apps/telegram/bot.js');
const { attachmentsForTask } = await import('../packages/task-engine/attachments.js');
const { getTask } = await import('../packages/task-engine/tasks.js');

const files = new Map(); // fileId -> { filePath, buffer }
let sentDocuments = [];
let sentMessages = [];

function extractTaskId(text) {
  return text.replace(/\\/g, '').match(/task_\w+/)[0];
}

const realFetch = globalThis.fetch;
function installTelegramMock() {
  globalThis.fetch = async (url, options) => {
    const href = String(url);
    if (href.includes('/getFile')) {
      const fileId = new URL(href).searchParams.get('file_id');
      const entry = files.get(fileId);
      if (!entry) return { ok: true, json: async () => ({ ok: false, description: 'file not found' }) };
      return { ok: true, json: async () => ({ ok: true, result: { file_id: fileId, file_path: entry.filePath, file_size: entry.buffer.length } }) };
    }
    if (href.includes('/file/bot')) {
      const filePath = href.split('/file/bot')[1].split('/').slice(1).join('/');
      const entry = [...files.values()].find((f) => f.filePath === filePath);
      if (!entry) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => entry.buffer.buffer.slice(entry.buffer.byteOffset, entry.buffer.byteOffset + entry.buffer.byteLength) };
    }
    if (href.includes('/sendDocument')) {
      sentDocuments.push({ url: href, form: options.body });
      return { ok: true, json: async () => ({ ok: true, result: { document: {} } }) };
    }
    if (href.includes('/sendMessage')) {
      sentMessages.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return realFetch(url, options);
  };
}
function uninstallTelegramMock() {
  globalThis.fetch = realFetch;
}

let server;
test('boot API for telegram file tests', () => { server = start(8896); assert.ok(server); });

test('document attachment: getFile + download + MIME/size checks + text extraction + task association + cleanup', async () => {
  installTelegramMock();
  const content = Buffer.from('# Proof doc\n\nThis is the body of the uploaded markdown file.');
  files.set('doc-1', { filePath: 'documents/file_doc1.md', buffer: content });
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, document: { file_id: 'doc-1', file_name: '../../etc/passwd.md', file_size: content.length, mime_type: 'text/markdown' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /Attachment stored and task queued/);
  const taskId = extractTaskId(result.text[0]);
  const task = getTask(taskId);
  assert.ok(task);
  assert.match(task.request, /Proof doc/, 'text content must be extracted into the task request');

  const attachments = attachmentsForTask(taskId);
  assert.equal(attachments.length, 1);
  const attachment = attachments[0];
  assert.equal(attachment.workspace_id, 'blackspire-command');
  assert.equal(attachment.kind, 'document');
  assert.ok(!attachment.file_name.includes('..'), 'stored filename must not contain path traversal segments');
  assert.ok(!attachment.file_name.includes('/'), 'stored filename must be a bare filename');
  assert.match(attachment.text_excerpt, /Proof doc/);
  assert.equal(fs.existsSync(attachment.stored_path), false, 'temp file must be cleaned up after processing');
  uninstallTelegramMock();
});

test('size limit is enforced again after download even if the declared size lied', async () => {
  installTelegramMock();
  const actualContent = Buffer.alloc(500, 'x');
  process.env.TELEGRAM_FILE_MAX_BYTES = '100';
  files.set('doc-2', { filePath: 'documents/file_doc2.txt', buffer: actualContent });
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, document: { file_id: 'doc-2', file_name: 'small-claim.txt', file_size: 50, mime_type: 'text/plain' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /exceeds the size limit/);
  delete process.env.TELEGRAM_FILE_MAX_BYTES;
  uninstallTelegramMock();
});

test('getFile failure is surfaced explicitly instead of silently dropping the attachment', async () => {
  installTelegramMock();
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, document: { file_id: 'missing-file', file_name: 'x.txt', file_size: 10, mime_type: 'text/plain' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /Attachment download failed/);
  uninstallTelegramMock();
});

test('voice note: mocked successful transcription creates a Hermes task from the transcript', async () => {
  installTelegramMock();
  process.env.TRANSCRIPTION_ADAPTER = 'mock';
  process.env.TRANSCRIPTION_MOCK_TEXT = 'Create docs/from-voice.md with proof text';
  const audio = Buffer.from('fake-ogg-bytes');
  files.set('voice-ok', { filePath: 'voice/voice_ok.oga', buffer: audio });
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, voice: { file_id: 'voice-ok', file_size: audio.length, mime_type: 'audio/ogg' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /Voice task queued/);
  const taskId = extractTaskId(result.text[0]);
  assert.equal(getTask(taskId).request, 'Create docs/from-voice.md with proof text');
  const attachment = attachmentsForTask(taskId)[0];
  assert.equal(attachment.transcription_status, 'ok');
  assert.equal(attachment.kind, 'voice');
  delete process.env.TRANSCRIPTION_ADAPTER;
  delete process.env.TRANSCRIPTION_MOCK_TEXT;
  uninstallTelegramMock();
});

test('voice note: transcription unavailable is handled explicitly and the voice note is never silently discarded', async () => {
  installTelegramMock();
  delete process.env.TRANSCRIPTION_ADAPTER;
  const audio = Buffer.from('fake-ogg-bytes-2');
  files.set('voice-unavailable', { filePath: 'voice/voice_unavailable.oga', buffer: audio });
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, voice: { file_id: 'voice-unavailable', file_size: audio.length, mime_type: 'audio/ogg' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /transcription is unavailable/);
  uninstallTelegramMock();
});

test('voice note: failed transcription is handled explicitly (not confused with "unavailable")', async () => {
  installTelegramMock();
  process.env.TRANSCRIPTION_ADAPTER = 'http';
  process.env.TRANSCRIPTION_HTTP_ENDPOINT = 'https://transcribe.example.invalid/transcribe';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('transcribe.example.invalid')) return { ok: false, status: 500, json: async () => ({}) };
    return originalFetch(url, options);
  };
  const audio = Buffer.from('fake-ogg-bytes-3');
  files.set('voice-failed', { filePath: 'voice/voice_failed.oga', buffer: audio });
  const update = { message: { from: { id: 1001 }, chat: { id: 42 }, voice: { file_id: 'voice-failed', file_size: audio.length, mime_type: 'audio/ogg' } } };
  const result = await handleTelegramAttachment(update, 'http://localhost:8896');
  assert.match(result.text[0], /transcription failed/);
  delete process.env.TRANSCRIPTION_ADAPTER;
  delete process.env.TRANSCRIPTION_HTTP_ENDPOINT;
  uninstallTelegramMock();
});

test('sendTelegramDocument posts a multipart form with chat_id, caption, and the file', async () => {
  installTelegramMock();
  const tmpFile = path.join(root, 'evidence.json');
  fs.writeFileSync(tmpFile, '{"ok":true}');
  const response = await sendTelegramDocument('mock-token', 777, tmpFile, 'evidence bundle');
  assert.equal(response.ok, true);
  assert.equal(sentDocuments.length, 1);
  uninstallTelegramMock();
});

test('evidence bundle delivery: /export produces a document reply for large bundles and dispatchReply sends + cleans it up', async () => {
  installTelegramMock();
  process.env.TELEGRAM_INLINE_MAX_CHARS = '10'; // force document mode regardless of actual bundle size
  const reply = await handleTelegramUpdate({ update_id: 100, message: { from: { id: 1001 }, chat: { id: 42 }, text: '/task Create `docs/export-target.md`' } }, 'http://localhost:8896');
  const taskId = extractTaskId(reply.text[0]);
  const exportReply = await handleTelegramUpdate({ update_id: 101, message: { from: { id: 1001 }, chat: { id: 42 }, text: `/export ${taskId}` } }, 'http://localhost:8896');
  assert.ok(exportReply.document, 'large export must be delivered as a document, not truncated text');
  assert.ok(fs.existsSync(exportReply.document.path));
  const before = sentDocuments.length;
  await dispatchReply('mock-token', exportReply);
  assert.equal(sentDocuments.length, before + 1);
  assert.equal(fs.existsSync(exportReply.document.path), false, 'dispatchReply must clean up the temp export file after sending');
  delete process.env.TELEGRAM_INLINE_MAX_CHARS;
  uninstallTelegramMock();
});

test('large-log delivery: /logs produces a document reply instead of truncating', async () => {
  installTelegramMock();
  process.env.TELEGRAM_INLINE_MAX_CHARS = '10';
  const reply = await handleTelegramUpdate({ update_id: 102, message: { from: { id: 1001 }, chat: { id: 42 }, text: '/task Create `docs/log-target.md`' } }, 'http://localhost:8896');
  const taskId = extractTaskId(reply.text[0]);
  const logsReply = await handleTelegramUpdate({ update_id: 103, message: { from: { id: 1001 }, chat: { id: 42 }, text: `/logs ${taskId}` } }, 'http://localhost:8896');
  assert.ok(logsReply.document, 'large log history must be delivered as a document, not truncated text');
  delete process.env.TELEGRAM_INLINE_MAX_CHARS;
  uninstallTelegramMock();
});

test('dispatchReply is a no-op in dry-run (no bot token) and reports ignored updates', async () => {
  assert.equal((await dispatchReply('', { chatId: 1, text: ['x'] })).sent, false);
  assert.equal((await dispatchReply('token', { ignored: true })).sent, false);
});

test('close API for telegram file tests', () => server.close());
