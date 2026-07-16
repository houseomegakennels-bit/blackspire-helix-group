import { run, all, migrate } from './db.js';
import { id, now } from '../shared/util.js';

migrate();

export function recordAttachment({ taskId = null, workspaceId = null, chatId, fileId, fileName, mimeType, sizeBytes, kind, storedPath, textExcerpt = null, transcriptionStatus = null }) {
  const attachmentId = id('attach');
  run(
    `INSERT INTO telegram_attachments (id, task_id, workspace_id, chat_id, file_id, file_name, mime_type, size_bytes, kind, stored_path, text_excerpt, transcription_status, created_at)
     VALUES (:id, :taskId, :workspaceId, :chatId, :fileId, :fileName, :mimeType, :sizeBytes, :kind, :storedPath, :textExcerpt, :transcriptionStatus, :createdAt);`,
    { id: attachmentId, taskId, workspaceId, chatId: String(chatId ?? ''), fileId, fileName, mimeType, sizeBytes: Number(sizeBytes || 0), kind, storedPath, textExcerpt, transcriptionStatus, createdAt: now() },
  );
  return attachmentId;
}

export function attachmentsForTask(taskId) {
  return all('SELECT * FROM telegram_attachments WHERE task_id=? ORDER BY created_at;', [taskId]);
}
