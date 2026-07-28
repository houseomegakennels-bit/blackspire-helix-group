// Anthropic (non-agentic Claude) development-only provider adapter (Milestone 2).
//
// Pure HTTPS text-in/JSON-out via the Anthropic Messages API. It has NO shell, filesystem, or
// agentic surface — the model only returns text — so path/command-injection and workspace-escape
// simply do not apply to the execution surface. It is DISABLED by default and gated by
// runtime-profile.js (development profile + explicit flag + provider allowlist); it refuses under
// the production profile even if a credential is present. The credential is read from the
// environment and sent only as an HTTP header — never in argv, logs, DB records, or task payloads.
import { resolveRuntimeProfile, realProviderPermitted, realProviderSpendPermitted } from '../runtime-profile.js';
import { redactString, redactDeep } from '../redaction.js';
import { adapterFailure, enforceInputLimit, clampOutput } from './base.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const AUTH_ENV_VAR = 'ANTHROPIC_API_KEY';

/**
 * @param {Object} [deps]
 * @param {typeof fetch} [deps.fetchImpl]  injected in tests; defaults to global fetch
 * @param {NodeJS.ProcessEnv} [deps.env]
 */
export function createAnthropicDevAdapter(deps = {}) {
  const env = deps.env || process.env;
  const fetchImpl = deps.fetchImpl || fetch;
  return {
    id: 'anthropic', adapterType: 'api',

    /** True only when a credential is present in the environment (value never returned/logged). */
    isAuthenticated() { return Boolean(env[AUTH_ENV_VAR]); },

    async execute({ objective, model = 'claude-sonnet-4-5', limits, signal }) {
      const rp = resolveRuntimeProfile(env);
      // 1. Fail closed on the runtime gate. Production is refused here regardless of credentials.
      const gate = realProviderPermitted('anthropic', rp);
      if (!gate.allowed) return adapterFailure('anthropic', 'api', 'provider_disabled', gate.reason, { model });
      // Keep the adapter boundary fail-closed as well as the orchestrator boundary.  A caller that
      // imports this adapter directly cannot omit the task-derived spend envelope and issue a real
      // request merely because a credential and development flag happen to exist.
      const spendGate = realProviderSpendPermitted('anthropic', limits?.maxSpendCents, limits?.maxCostCents, rp);
      if (!spendGate.allowed) return adapterFailure('anthropic', 'api', 'spend_not_permitted', spendGate.reason, { model });
      // 2. Credential must be present — but never printed or returned.
      if (!env[AUTH_ENV_VAR]) return adapterFailure('anthropic', 'api', 'missing_credential', `${AUTH_ENV_VAR} is not configured`, { model });
      // 3. Input-size ceiling.
      const input = enforceInputLimit(objective, limits.maxInputBytes);
      if (!input.ok) return adapterFailure('anthropic', 'api', 'input_too_large', input.reason, { model, inputBytes: input.bytes });
      if (signal?.aborted) return adapterFailure('anthropic', 'api', 'cancelled', 'cancelled before dispatch', { model, cancelled: true });

      // The prompt asks for a bounded JSON proposal; the model returns TEXT only (no tools).
      const prompt = `You are a non-agentic proposer. Do not execute anything. Given this objective, return ONLY JSON of the form {"summary":"...","artifacts":[{"path":"relative/path","content":"..."}]}.\nObjective: ${objective}`;
      let response;
      try {
        response = await fetchImpl(ANTHROPIC_URL, {
          method: 'POST',
          headers: {
            // Credential travels only in this header — never argv/logs/DB.
            'x-api-key': env[AUTH_ENV_VAR],
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
          signal,
        });
      } catch (error) {
        const cancelled = error?.name === 'AbortError';
        return adapterFailure('anthropic', 'api', cancelled ? 'cancelled' : 'network_error', cancelled ? 'request cancelled' : `request failed: ${error?.message || error}`, { model, cancelled, inputBytes: input.bytes });
      }

      let body;
      try { body = await response.json(); } catch { body = null; }
      if (!response.ok) {
        return adapterFailure('anthropic', 'api', 'provider_error', `provider returned HTTP ${response.status}`, { model, inputBytes: input.bytes, usage: usageFrom(body) });
      }
      const text = body?.content?.[0]?.text ?? '';
      let parsed;
      try { parsed = JSON.parse(text); } catch {
        return adapterFailure('anthropic', 'api', 'malformed_response', 'provider did not return valid JSON artifacts', { model, inputBytes: input.bytes, usage: usageFrom(body) });
      }
      const clamped = clampOutput(parsed.summary || '', limits.maxOutputBytes);
      // Redact BEFORE the result leaves the adapter, so nothing unredacted can be persisted/logged.
      return {
        ok: true, provider: 'anthropic', adapterType: 'api', model, mode: 'real',
        summary: redactString(clamped.text),
        artifacts: redactDeep(Array.isArray(parsed.artifacts) ? parsed.artifacts : []),
        usage: usageFrom(body),
        inputBytes: input.bytes, outputBytes: clamped.bytes, timedOut: false, cancelled: false,
        error: null, structuredError: null,
      };
    },
  };
}

// Anthropic reports token usage but not a cost; cost stays null unless pricing is configured.
function usageFrom(body) {
  const u = body?.usage;
  return {
    inputTokens: Number.isFinite(u?.input_tokens) ? u.input_tokens : null,
    outputTokens: Number.isFinite(u?.output_tokens) ? u.output_tokens : null,
    costCents: null,
  };
}
