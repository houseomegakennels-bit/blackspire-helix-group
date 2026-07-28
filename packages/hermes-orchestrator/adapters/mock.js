// Mock provider adapter (Milestone 2) — the default, credential-free executable provider.
//
// Conforms to the same AdapterResult shape as the real adapter so the executor treats providers
// uniformly. Deterministic, no network, no shell, no filesystem. mode='mock' so a result can never
// be mistaken for a real execution.
import { redactString, redactDeep } from '../redaction.js';
import { enforceInputLimit, clampOutput } from './base.js';

export function createMockAdapter() {
  return {
    id: 'mock', adapterType: 'mock',
    async execute({ objective, model = 'mock-hermes-status-v1', limits }) {
      const input = enforceInputLimit(objective, limits.maxInputBytes);
      if (!input.ok) {
        return { ok: false, provider: 'mock', adapterType: 'mock', model, mode: 'mock', summary: '', artifacts: [], usage: { inputTokens: 0, outputTokens: 0, costCents: 0 }, inputBytes: input.bytes, outputBytes: 0, timedOut: false, cancelled: false, error: redactString(input.reason), structuredError: { code: 'input_too_large', message: input.reason } };
      }
      const requestedPath = String(objective).match(/`([^`]+)`/)?.[1] || 'docs/hermes-mock-change.md';
      const summary = 'Mock provider proposed a safe local edit.';
      const clamped = clampOutput(summary, limits.maxOutputBytes);
      return {
        ok: true, provider: 'mock', adapterType: 'mock', model, mode: 'mock',
        summary: redactString(clamped.text),
        artifacts: redactDeep([{ path: requestedPath, content: `# Hermes Mock Change\n\nObjective: ${objective}\n` }]),
        usage: { inputTokens: 50, outputTokens: 25, costCents: 0 },
        inputBytes: input.bytes, outputBytes: clamped.bytes, timedOut: false, cancelled: false, error: null, structuredError: null,
      };
    },
  };
}
