// Hermes provider adapter boundary (Milestone 2).
//
// The shared shape and guards every real/mock adapter returns. Adapters are pure request→response:
// they NEVER execute shell, touch the filesystem, or spawn processes. Size limits, redaction, and
// structured errors are enforced here so no adapter can bypass them.
import { redactString } from '../redaction.js';

/**
 * @typedef {Object} AdapterUsage
 * @property {number|null} inputTokens   null when the provider does not report it
 * @property {number|null} outputTokens
 * @property {number|null} costCents     null when pricing is not configured/available
 */

/**
 * @typedef {Object} AdapterResult
 * @property {boolean} ok
 * @property {string} provider
 * @property {string} adapterType
 * @property {string|null} model
 * @property {'real'|'mock'} mode
 * @property {string} summary            redacted
 * @property {Array<{path:string,content:string}>} artifacts
 * @property {AdapterUsage} usage
 * @property {number} inputBytes
 * @property {number} outputBytes
 * @property {boolean} timedOut
 * @property {boolean} cancelled
 * @property {string|null} error         redacted, human-readable
 * @property {{code:string,message:string}|null} structuredError
 */

export function nullUsage() {
  return { inputTokens: null, outputTokens: null, costCents: null };
}

/** Build a structured, redacted failure result. */
export function adapterFailure(provider, adapterType, code, message, extra = {}) {
  return {
    ok: false, provider, adapterType, model: extra.model ?? null, mode: extra.mode || 'real',
    summary: '', artifacts: [], usage: extra.usage || nullUsage(),
    inputBytes: extra.inputBytes || 0, outputBytes: extra.outputBytes || 0,
    timedOut: Boolean(extra.timedOut), cancelled: Boolean(extra.cancelled),
    error: redactString(message), structuredError: { code, message: redactString(message) },
  };
}

/** Enforce an input-size ceiling before an adapter is allowed to send anything. */
export function enforceInputLimit(text, maxInputBytes) {
  const bytes = Buffer.byteLength(String(text ?? ''), 'utf8');
  if (bytes > maxInputBytes) return { ok: false, bytes, reason: `input exceeds ${maxInputBytes} bytes` };
  return { ok: true, bytes };
}

/** Truncate provider output to the ceiling and report the real byte size. */
export function clampOutput(text, maxOutputBytes) {
  const s = String(text ?? '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes <= maxOutputBytes) return { text: s, bytes, truncated: false };
  // Truncate on a byte boundary safely; report the RESULTING (clamped) byte length.
  const buf = Buffer.from(s, 'utf8').subarray(0, maxOutputBytes);
  const truncatedText = buf.toString('utf8');
  return { text: truncatedText, bytes: Buffer.byteLength(truncatedText, 'utf8'), truncated: true };
}
