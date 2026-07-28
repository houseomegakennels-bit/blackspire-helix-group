// Deterministic fake provider adapter (Milestone 2 — tests only).
//
// A dependency-injected stand-in for a real provider so the automated suite never needs a paid API
// call. It exercises every code path the real adapter has (success, malformed, oversized, timeout,
// cancellation, error) deterministically. It performs no network or shell work.
import { redactString, redactDeep } from '../redaction.js';
import { nullUsage, adapterFailure, enforceInputLimit, clampOutput } from './base.js';

/**
 * @param {Object} opts
 * @param {'ok'|'malformed'|'oversized'|'timeout'|'error'|'secretleak'} [opts.behavior]
 * @param {number} [opts.usageInputTokens] @param {number} [opts.usageOutputTokens] @param {number|null} [opts.costCents]
 */
export function createFakeAdapter(opts = {}) {
  const behavior = opts.behavior || 'ok';
  return {
    id: 'fake', adapterType: 'fake',
    async execute({ objective, model = 'fake-v1', limits, signal }) {
      const input = enforceInputLimit(objective, limits.maxInputBytes);
      if (!input.ok) return adapterFailure('fake', 'fake', 'input_too_large', input.reason, { model, inputBytes: input.bytes });
      if (signal?.aborted) return adapterFailure('fake', 'fake', 'cancelled', 'cancelled before dispatch', { model, cancelled: true });

      if (behavior === 'timeout') {
        // Simulate a deadline breach without real waiting.
        return adapterFailure('fake', 'fake', 'timeout', 'provider timed out', { model, timedOut: true, inputBytes: input.bytes });
      }
      if (behavior === 'error') {
        return adapterFailure('fake', 'fake', 'provider_error', 'simulated upstream 500', { model, inputBytes: input.bytes });
      }
      if (behavior === 'malformed') {
        // Non-JSON body path: the adapter must fail closed, not surface garbage.
        return adapterFailure('fake', 'fake', 'malformed_response', 'provider did not return valid JSON artifacts', { model, inputBytes: input.bytes });
      }

      let summary = 'Fake provider proposed a safe local edit.';
      let artifacts = [{ path: 'docs/hermes-fake-change.md', content: `# Fake change\n\nObjective: ${objective}\n` }];
      let usage = { inputTokens: opts.usageInputTokens ?? 42, outputTokens: opts.usageOutputTokens ?? 21, costCents: opts.costCents ?? null };

      if (behavior === 'secretleak') {
        // The provider tries to echo a secret; the adapter must redact before returning.
        summary = 'Here is the key sk-' + 'a'.repeat(24) + ' and Authorization: Bearer ' + 'b'.repeat(24);
        artifacts = [{ path: 'docs/leak.md', content: 'AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE' }];
      }
      if (behavior === 'oversized') {
        summary = 'x'.repeat(limits.maxOutputBytes * 2);
      }

      const clamped = clampOutput(summary, limits.maxOutputBytes);
      const safeArtifacts = redactDeep(artifacts);
      return {
        ok: true, provider: 'fake', adapterType: 'fake', model, mode: 'real',
        summary: redactString(clamped.text), artifacts: safeArtifacts, usage,
        inputBytes: input.bytes, outputBytes: clamped.bytes, timedOut: false, cancelled: false,
        error: null, structuredError: null,
      };
    },
  };
}

export const nullUsageForFake = nullUsage;
