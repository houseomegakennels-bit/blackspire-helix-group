// Hermes redaction layer (Milestone 1).
//
// Every value Hermes persists (workflow payloads, routing rationale, verification detail, memory
// lessons) passes through here first. It reuses the reviewed string redactor in
// packages/shared/util.js and extends it to walk nested structures, so a secret buried inside an
// object or array is redacted just like a top-level string. Requirement #12 of the Hermes charter:
// never store secrets, credentials, tokens, private keys, or raw environment values in memory or
// logs.
import { redact } from '../shared/util.js';

// Keys whose values are dropped entirely rather than pattern-redacted. Matching is case-insensitive
// and substring-based so `TELEGRAM_BOT_TOKEN`, `apiKey`, `session_secret`, etc. are all covered.
const SENSITIVE_KEY_PATTERN = /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|authorization|cookie|env)/i;
const MAX_DEPTH = 8;

/** Redact a single string value using the shared reviewed redactor. */
export function redactString(value) {
  return redact(String(value ?? ''));
}

/**
 * Deep-redact an arbitrary JSON-serializable value. Strings are pattern-redacted; values under a
 * sensitive-looking key are replaced with the literal '[REDACTED]'; nested objects/arrays are
 * walked up to MAX_DEPTH. Non-plain values (functions, symbols) are dropped.
 */
export function redactDeep(value, depth = 0) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[REDACTED:depth]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactDeep(nested, depth + 1);
    }
    return out;
  }
  return undefined;
}

/** Redact then JSON-stringify, for columns that store a serialized payload. */
export function redactedJson(value) {
  return JSON.stringify(redactDeep(value) ?? null);
}
