import fs from 'node:fs';
import { redact } from './util.js';

// Adapter is selected by env so voice transcription can be swapped without code changes:
//   'disabled' (default) - explicitly unavailable, no external call is made.
//   'mock'               - returns TRANSCRIPTION_MOCK_TEXT, for tests and local dry-runs.
//   'http'               - posts the audio bytes to TRANSCRIPTION_HTTP_ENDPOINT and expects { text }.
// Every path returns a status so the caller can never silently drop the voice note: 'ok' | 'unavailable' | 'failed'.
export async function transcribeVoice(filePath, mimeType) {
  const mode = process.env.TRANSCRIPTION_ADAPTER || (process.env.TRANSCRIPTION_ADAPTER_ENABLED ? 'mock' : 'disabled');
  if (mode === 'disabled') return { status: 'unavailable', reason: 'No transcription adapter is configured.' };
  if (mode === 'mock') return { status: 'ok', text: process.env.TRANSCRIPTION_MOCK_TEXT || 'Transcribed Telegram voice task' };
  if (mode === 'http') {
    const endpoint = process.env.TRANSCRIPTION_HTTP_ENDPOINT;
    if (!endpoint) return { status: 'unavailable', reason: 'TRANSCRIPTION_HTTP_ENDPOINT is not set.' };
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'content-type': mimeType || 'application/octet-stream' }, body: fs.readFileSync(filePath) });
      if (!response.ok) return { status: 'failed', reason: `Transcription endpoint returned ${response.status}.` };
      const body = await response.json().catch(() => ({}));
      if (!body.text) return { status: 'failed', reason: 'Transcription endpoint returned no text.' };
      return { status: 'ok', text: body.text };
    } catch (error) {
      return { status: 'failed', reason: redact(error.message) };
    }
  }
  return { status: 'unavailable', reason: `Unknown TRANSCRIPTION_ADAPTER "${mode}".` };
}
