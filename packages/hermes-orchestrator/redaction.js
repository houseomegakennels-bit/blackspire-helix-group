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
// A generous stack-safety backstop only. Cycles are caught by path-based detection below, so this
// no longer has to be small to avoid infinite recursion, and legitimate deep payloads are not
// truncated at a shallow depth.
const MAX_DEPTH = 32;

/** Redact a single string value using the shared reviewed redactor. */
export function redactString(value) {
  return redact(String(value ?? ''));
}

/**
 * Deep-redact an arbitrary value. Strings are pattern-redacted; values under a sensitive-looking key
 * are replaced with '[REDACTED]'; Error objects are reduced to a redacted {name,message}; bigints
 * are stringified and redacted; nested objects/arrays are walked with path-based cycle detection so
 * a cyclic structure yields '[REDACTED:cycle]' instead of crashing. Functions/symbols are dropped.
 * @param {*} value
 * @param {number} depth
 * @param {WeakSet<object>} seen  objects currently on the recursion path (cycle guard)
 */
export function redactDeep(value, depth = 0, seen = new WeakSet()) {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return '[REDACTED:depth]';
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return redactString(value.toString());
  if (value instanceof Error) return { name: value.name, message: redactString(value.message || '') };
  if (typeof value === 'object') {
    if (seen.has(value)) return '[REDACTED:cycle]';
    seen.add(value); // add before descending, delete after: tracks the current path, not siblings
    let out;
    if (Array.isArray(value)) {
      out = value.map((item) => redactDeep(item, depth + 1, seen));
    } else {
      out = {};
      for (const [key, nested] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[REDACTED]' : redactDeep(nested, depth + 1, seen);
      }
    }
    seen.delete(value);
    return out;
  }
  return undefined;
}

/** Redact then JSON-stringify, for columns that store a serialized payload. */
export function redactedJson(value) {
  return JSON.stringify(redactDeep(value) ?? null);
}
