import { spawnSync } from 'node:child_process';
import { redact } from '../shared/util.js';

export function activeModes() {
  return {
    openai: process.env.OPENAI_API_KEY ? 'api' : 'unconfigured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'api' : 'unconfigured',
    codex: process.env.CODEX_API_ENDPOINT && process.env.CODEX_API_KEY ? 'direct-api' : (spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0 ? 'cli' : 'manual-handoff'),
    claudeCode: spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0 ? 'cli' : 'unavailable',
  };
}

export function selectProvider(policy = {}) {
  const modes = activeModes();
  for (const provider of policy.preferred || ['codex', 'openai', 'anthropic', 'manual']) {
    if (provider === 'codex' && modes.codex) return { provider: 'codex', mode: modes.codex };
    if (provider === 'openai' && modes.openai === 'api') return { provider: 'openai', mode: 'api' };
    if (provider === 'anthropic' && modes.anthropic === 'api') return { provider: 'anthropic', mode: 'api' };
    if (provider === 'manual') return { provider: 'manual', mode: 'handoff' };
  }
  return { provider: 'manual', mode: 'handoff' };
}

export async function callOpenAI({ prompt, model = process.env.OPENAI_MODEL || 'gpt-5.1', timeoutMs = 30000 }) {
  if (!process.env.OPENAI_API_KEY) return { ok: false, mode: 'unconfigured', error: 'OPENAI_API_KEY required' };
  return withTimeout(fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: prompt, stream: false }),
  }), timeoutMs).then(toProviderResult('openai')).catch((error) => ({ ok: false, provider: 'openai', error: redact(error.message) }));
}

export async function callAnthropic({ prompt, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', timeoutMs = 30000 }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, mode: 'unconfigured', error: 'ANTHROPIC_API_KEY required' };
  return withTimeout(fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  }), timeoutMs).then(toProviderResult('anthropic')).catch((error) => ({ ok: false, provider: 'anthropic', error: redact(error.message) }));
}

export function runClaudeCodePacket(packetPath) {
  const available = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!available) return { ok: false, mode: 'unavailable', error: 'Claude Code CLI is not installed or authenticated' };
  const result = spawnSync('claude', ['--print', `Read and execute the approved task packet at ${packetPath}`], { encoding: 'utf8', timeout: 600000 });
  return { ok: result.status === 0, mode: 'cli', stdout: redact(result.stdout), stderr: redact(result.stderr), code: result.status };
}

function withTimeout(promise, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return promise.finally(() => clearTimeout(timer));
}

function toProviderResult(provider) {
  return async (response) => {
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, provider, status: response.status, body: response.ok ? body : undefined, error: response.ok ? undefined : redact(JSON.stringify(body)) };
  };
}
