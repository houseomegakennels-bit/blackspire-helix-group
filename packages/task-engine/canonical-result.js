import { redact } from '../shared/util.js';

export const CANONICAL_RESULT_MAX_CHARS = 8000;
export const EMPTY_COMPLETION_RESULT = 'Task completed; no textual response was recorded.';

const GENERIC_RESULTS = new Set(['completed', 'complete', 'done', 'success', 'successful']);

function sanitizeText(value) {
  if (typeof value !== 'string') return '';
  const sanitized = redact(value).replace(/\r\n?/g, '\n').trim();
  if (!sanitized) return '';
  if (sanitized.length <= CANONICAL_RESULT_MAX_CHARS) return sanitized;
  return `${sanitized.slice(0, CANONICAL_RESULT_MAX_CHARS - 1)}…`;
}

export function isMeaningfulTaskResult(value) {
  const text = sanitizeText(value);
  return Boolean(text) && !GENERIC_RESULTS.has(text.toLowerCase());
}

function summaryResult(summary) {
  if (typeof summary !== 'string' || !summary.trim()) return '';
  try {
    const parsed = JSON.parse(summary);
    return sanitizeText(parsed?.result);
  } catch {
    return sanitizeText(summary);
  }
}

function attemptSummary(attempt) {
  if (!attempt || typeof attempt.response_packet !== 'string') return '';
  try {
    return sanitizeText(JSON.parse(attempt.response_packet)?.summary);
  } catch {
    return '';
  }
}

export function resolveCanonicalTaskResult(task, providerAttempts = []) {
  if (!task || task.status !== 'completed') return null;
  const taskResult = summaryResult(task.summary);
  if (isMeaningfulTaskResult(taskResult)) return taskResult;

  const successful = providerAttempts.filter((attempt) =>
    attempt?.task_id === task.id && attempt.status === 'completed');
  // A normal retry sequence has at most one successful attempt. Multiple successes are ambiguous:
  // none is promoted as the owner, which keeps stale or duplicate success rows from becoming UI truth.
  if (successful.length === 1) {
    const providerResult = attemptSummary(successful[0]);
    if (isMeaningfulTaskResult(providerResult)) return providerResult;
  }
  return EMPTY_COMPLETION_RESULT;
}

export function serializeTaskWithCanonicalResult(task, providerAttempts = []) {
  return { ...task, canonicalResult: resolveCanonicalTaskResult(task, providerAttempts) };
}
