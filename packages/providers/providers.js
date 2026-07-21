import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { id, redact } from '../shared/util.js';

export function activeModes() {
  return {
    openai: process.env.OPENAI_API_KEY ? 'api' : 'unconfigured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'api' : 'unconfigured',
    codex: process.env.CODEX_API_ENDPOINT && process.env.CODEX_API_KEY ? 'direct-api' : (spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0 ? 'cli' : 'manual-handoff'),
    claudeCode: spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0 ? 'cli' : 'unavailable',
  };
}

export function selectProvider(policy = {}, { requested = null, model = null } = {}) {
  if (process.env.HERMES_TEST_PROVIDER === 'mock') return { provider: 'mock', mode: 'mock', model: 'mock-hermes-status-v1' };
  requested ||= process.env.BLACKSPIRE_PROVIDER_MODE || 'mock';
  const preferred = policy.preferred || ['manual'];
  if (!preferred.includes(requested)) return { provider: requested, mode: 'unconfigured', model };
  if (requested === 'mock') return { provider: 'mock', mode: 'mock', model: model || 'mock-hermes-status-v1' };
  if (requested === 'manual') return { provider: 'manual', mode: 'handoff', model };
  const modes = activeModes();
  if (requested === 'codex' && modes.codex !== 'manual-handoff') return { provider: 'codex', mode: modes.codex };
  if (requested === 'openai' && modes.openai === 'api') return { provider: 'openai', mode: 'api' };
  if (requested === 'anthropic' && modes.anthropic === 'api') return { provider: 'anthropic', mode: 'api' };
  if (requested === 'claudeCode' && modes.claudeCode === 'cli') return { provider: 'claudeCode', mode: 'cli' };
  return { provider: requested, mode: 'unconfigured', model };
}

export async function executeProviderRequest({ selected, packet, workspace, deadline = null }) {
  const started = Date.now();
  try {
    if (selected.provider === 'mock') return normalizeProviderResult({ provider: 'mock', mode: 'mock', model: selected.model, started, response: mockResponse(packet) });
    const timeoutMs = deadline ? Math.max(1, Date.parse(deadline) - Date.now()) : 30_000;
    if (selected.provider === 'openai') return normalizeProviderResult({ provider: 'openai', mode: selected.mode, started, response: await callOpenAI({ prompt: JSON.stringify(packet), timeoutMs }) });
    if (selected.provider === 'anthropic') return normalizeProviderResult({ provider: 'anthropic', mode: selected.mode, started, response: await callAnthropic({ prompt: JSON.stringify(packet), timeoutMs }) });
    if (selected.provider === 'claudeCode') return normalizeProviderResult({ provider: 'claudeCode', mode: selected.mode, started, response: runClaudeCodePacket(writeTaskPacket(packet, workspace?.root_path)) });
    if (selected.provider === 'codex' && selected.mode === 'cli') return normalizeProviderResult({ provider: 'codex', mode: 'cli', started, response: runCodexCliPacket(writeTaskPacket(packet, workspace?.root_path)) });
    if (selected.provider === 'manual' && selected.mode === 'handoff') return normalizeProviderResult({ provider: 'manual', mode: 'handoff', started, response: manualPacket(packet, workspace?.root_path) });
    return { ok: false, provider: selected.provider || 'unknown', mode: selected.mode || 'unconfigured', artifacts: [], usage: usage(selected, Date.now() - started), error: 'provider is not explicitly configured', raw: null };
  } catch (error) {
    return { ok: false, provider: selected.provider, mode: selected.mode, artifacts: [], usage: usage(selected, Date.now() - started), error: redact(error.message), raw: null };
  }
}

export async function callOpenAI({ prompt, model = process.env.OPENAI_MODEL || 'gpt-5.1', timeoutMs = 30000 }) {
  if (!process.env.OPENAI_API_KEY) return { ok: false, mode: 'unconfigured', error: 'OPENAI_API_KEY required', artifacts: [] };
  const response = await withTimeout(fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: `${prompt}\nReturn JSON: {"artifacts":[{"path":"relative/path","content":"file content"}],"summary":"..."}`, stream: false }),
  }), timeoutMs);
  const body = await response.json().catch(() => ({}));
  return parseModelBody({ ok: response.ok, provider: 'openai', mode: 'api', body, error: response.ok ? null : JSON.stringify(body) });
}

export async function callAnthropic({ prompt, model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5', timeoutMs = 30000 }) {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, mode: 'unconfigured', error: 'ANTHROPIC_API_KEY required', artifacts: [] };
  const response = await withTimeout(fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 2000, messages: [{ role: 'user', content: `${prompt}\nReturn JSON: {"artifacts":[{"path":"relative/path","content":"file content"}],"summary":"..."}` }] }),
  }), timeoutMs);
  const body = await response.json().catch(() => ({}));
  return parseModelBody({ ok: response.ok, provider: 'anthropic', mode: 'api', body, error: response.ok ? null : JSON.stringify(body) });
}

export function runClaudeCodePacket(packetPath) {
  const available = spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!available) return { ok: false, mode: 'unavailable', error: 'Claude Code CLI is not installed or authenticated', artifacts: [] };
  const result = spawnSync('claude', ['--print', `Read the approved task packet at ${packetPath}. Return only JSON with artifacts array.`], { encoding: 'utf8', timeout: 600000 });
  return parseCliResult('claudeCode', 'cli', result);
}

export function runCodexCliPacket(packetPath) {
  const available = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!available) return { ok: false, mode: 'unavailable', error: 'Codex CLI is not installed or authenticated', artifacts: [] };
  const result = spawnSync('codex', ['exec', '--json', `Read the approved task packet at ${packetPath}. Return JSON artifacts only.`], { encoding: 'utf8', timeout: 600000 });
  return parseCliResult('codex', 'cli', result);
}

function mockResponse(packet) {
  const requestedPath = packet.request.match(/`([^`]+)`/)?.[1] || 'docs/hermes-mock-change.md';
  return { ok: true, provider: 'mock', mode: 'mock', summary: 'Mock provider proposed a safe local coding edit.', artifacts: [{ path: requestedPath, content: `# Hermes Mock Change\n\nRequest: ${packet.request}\n` }], usage: { inputTokens: 50, outputTokens: 25, costCents: 0 } };
}

function manualPacket(packet, workspaceRoot = '.') {
  const packetPath = writeTaskPacket(packet, workspaceRoot);
  return { ok: true, provider: 'manual', mode: 'handoff', summary: `Manual task packet written to ${packetPath}`, artifacts: [], manualPacketPath: packetPath, usage: { inputTokens: 0, outputTokens: 0, costCents: 0 } };
}

function writeTaskPacket(packet, workspaceRoot = '.') {
  const dir = path.resolve(workspaceRoot || '.', '.hermes-task-packets');
  fs.mkdirSync(dir, { recursive: true });
  const packetPath = path.join(dir, `${packet.taskId || id('task')}.json`);
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2));
  return packetPath;
}

function normalizeProviderResult({ provider, mode, model = null, started, response }) {
  return {
    ok: Boolean(response.ok), provider, mode, model, artifacts: response.artifacts || [], summary: response.summary || '', manualPacketPath: response.manualPacketPath,
    usage: { provider, mode, latencyMs: Date.now() - started, inputTokens: response.usage?.inputTokens || 0, outputTokens: response.usage?.outputTokens || 0, costCents: response.usage?.costCents || 0 },
    error: response.ok ? null : redact(response.error || 'provider failed'), raw: response,
  };
}

function parseCliResult(provider, mode, result) {
  if (result.status !== 0) return { ok: false, provider, mode, error: redact(result.stderr), artifacts: [] };
  try {
    const parsed = JSON.parse(result.stdout.trim());
    return { ok: true, provider, mode, artifacts: parsed.artifacts || [], summary: parsed.summary || '', usage: parsed.usage || {} };
  } catch {
    return { ok: false, provider, mode, error: 'CLI did not return valid JSON artifacts', artifacts: [], raw: redact(result.stdout) };
  }
}

function parseModelBody({ ok, provider, mode, body, error }) {
  if (!ok) return { ok: false, provider, mode, error: redact(error), artifacts: [] };
  const text = body.output_text || body.content?.[0]?.text || body.content?.[0]?.text?.value || JSON.stringify(body);
  try {
    const parsed = JSON.parse(text);
    return { ok: true, provider, mode, artifacts: parsed.artifacts || [], summary: parsed.summary || '', usage: usageFromBody(body) };
  } catch {
    return { ok: false, provider, mode, error: 'Provider response was not valid JSON artifacts', artifacts: [], raw: redact(text) };
  }
}

function usageFromBody(body) {
  return { inputTokens: body.usage?.input_tokens || body.usage?.inputTokens || 0, outputTokens: body.usage?.output_tokens || body.usage?.outputTokens || 0, costCents: 0 };
}

function usage(selected, latencyMs) {
  return { provider: selected.provider, mode: selected.mode, latencyMs, inputTokens: 0, outputTokens: 0, costCents: 0 };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('provider timeout')), timeoutMs))]);
}
