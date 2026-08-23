import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { id, redact } from '../shared/util.js';

const CODEX_CLI_MAX_STREAM_BYTES = 1_000_000;

export function codexCliAvailable() {
  const version = spawnSync('codex', ['--version'], { encoding: 'utf8' });
  if (version.status !== 0) return false;
  const doctor = spawnSync('codex', ['doctor', '--json'], { encoding: 'utf8', timeout: 30_000 });
  if (doctor.status !== 0) return false;
  try {
    const report = JSON.parse(doctor.stdout || '{}');
    const auth = report?.checks?.['auth.credentials'];
    return auth?.status === 'ok' && /auth is configured/i.test(auth?.summary || '');
  } catch {
    return /auth is configured/i.test(doctor.stdout);
  }
}

export function activeModes() {
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && process.env.BLACKSPIRE_PROVIDER_MODE === 'manual') {
    return { openai: 'disabled-by-profile', anthropic: 'disabled-by-profile', codex: 'disabled-by-profile', claudeCode: 'disabled-by-profile' };
  }
  return {
    openai: process.env.OPENAI_API_KEY ? 'api' : 'unconfigured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'api' : 'unconfigured',
    codex: (process.env.CODEX_API_ENDPOINT || process.env.CODEX_API_KEY) ? 'direct-api-unimplemented' : (codexCliAvailable() ? 'cli' : 'manual-handoff'),
    claudeCode: spawnSync('claude', ['--version'], { encoding: 'utf8' }).status === 0 ? 'cli' : 'unavailable',
  };
}

export function selectProvider(policy = {}, { requested = null, model = null } = {}) {
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && process.env.BLACKSPIRE_PROVIDER_MODE === 'manual') {
    return { provider: 'manual', mode: 'handoff', model };
  }
  if (process.env.HERMES_TEST_PROVIDER === 'mock') return { provider: 'mock', mode: 'mock', model: 'mock-hermes-status-v1' };
  requested ||= process.env.BLACKSPIRE_PROVIDER_MODE || 'mock';
  const preferred = policy.preferred || ['manual'];
  if (!preferred.includes(requested)) return { provider: requested, mode: 'unconfigured', model };
  if (requested === 'mock') return { provider: 'mock', mode: 'mock', model: model || 'mock-hermes-status-v1' };
  if (requested === 'manual') return { provider: 'manual', mode: 'handoff', model };
  const modes = activeModes();
  // `model` is server authority (Hermes' BLACKSPIRE_PRODUCTION_MODEL) and is carried
  // through selection unchanged, so execution cannot silently substitute a
  // worker-local default for the model the server chose.
  if (requested === 'codex' && modes.codex !== 'manual-handoff') return { provider: 'codex', mode: modes.codex, model };
  if (requested === 'openai' && modes.openai === 'api') return { provider: 'openai', mode: 'api', model };
  if (requested === 'anthropic' && modes.anthropic === 'api') return { provider: 'anthropic', mode: 'api', model };
  if (requested === 'claudeCode' && process.env.BLACKSPIRE_RUNTIME_MODE !== 'production' && modes.claudeCode === 'cli') return { provider: 'claudeCode', mode: 'cli', model };
  return { provider: requested, mode: 'unconfigured', model };
}

export async function executeProviderRequest({ selected, packet, workspace, deadline = null, shouldCancel = null }) {
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && process.env.BLACKSPIRE_PROVIDER_MODE === 'manual' && selected.provider !== 'manual') {
    return { ok: false, provider: selected.provider || 'unknown', mode: 'disabled-by-profile', artifacts: [], usage: usage(selected, 0), error: 'external providers are disabled by the production profile', raw: null };
  }
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && selected.provider !== 'manual' && process.env.BLACKSPIRE_PRODUCTION_EXECUTION !== 'enabled') {
    return { ok: false, provider: selected.provider || 'unknown', mode: 'disabled-by-profile', artifacts: [], usage: usage(selected, 0), error: 'production provider execution requires BLACKSPIRE_PRODUCTION_EXECUTION=enabled', raw: null };
  }
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && ['openai', 'anthropic'].includes(selected.provider)) {
    return { ok: false, provider: selected.provider, mode: 'api-disabled-pending-cost-accounting', artifacts: [], usage: usage(selected, 0, { monetaryCostState: 'metered_cost_unavailable' }), error: 'metered API providers require conservative production cost accounting before dispatch', raw: null };
  }
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && selected.provider === 'claudeCode') {
    return { ok: false, provider: 'claudeCode', mode: 'cli-disabled-pending-accounting', artifacts: [], usage: usage(selected, 0, { monetaryCostState: 'metered_cost_unavailable' }), error: 'Claude Code production execution is disabled until accounting and authentication are independently reviewed', raw: null };
  }
  const started = Date.now();
  try {
    if (selected.provider === 'mock') return normalizeProviderResult({ provider: 'mock', mode: 'mock', model: selected.model, started, response: mockResponse(packet) });
    const timeoutMs = deadline ? Math.max(1, Date.parse(deadline) - Date.now()) : 30_000;
    if (selected.provider === 'openai') return normalizeProviderResult({ provider: 'openai', mode: selected.mode, model: selected.model, started, response: await callOpenAI({ prompt: JSON.stringify(packet), model: selected.model, timeoutMs }) });
    if (selected.provider === 'anthropic') return normalizeProviderResult({ provider: 'anthropic', mode: selected.mode, model: selected.model, started, response: await callAnthropic({ prompt: JSON.stringify(packet), model: selected.model, timeoutMs }) });
    if (selected.provider === 'claudeCode') return normalizeProviderResult({ provider: 'claudeCode', mode: selected.mode, model: selected.model, started, response: runClaudeCodePacket(writeTaskPacket(packet, workspace?.root_path)) });
    if (selected.provider === 'codex' && selected.mode === 'cli') return normalizeProviderResult({ provider: 'codex', mode: 'cli', model: selected.model, started, response: await runCodexCliPacket(writeTaskPacket(packet, workspace?.root_path, { external: true }), { workspaceRoot: workspace?.root_path, model: selected.model, timeoutMs, shouldCancel }) });
    if (selected.provider === 'manual' && selected.mode === 'handoff') return normalizeProviderResult({ provider: 'manual', mode: 'handoff', started, response: manualPacket(packet, workspace?.root_path) });
    return { ok: false, provider: selected.provider || 'unknown', mode: selected.mode || 'unconfigured', artifacts: [], usage: usage(selected, Date.now() - started), error: 'provider is not explicitly configured', raw: null };
  } catch (error) {
    return { ok: false, provider: selected.provider, mode: selected.mode, artifacts: [], usage: usage(selected, Date.now() - started), error: redact(error.message), raw: null };
  }
}

export async function callOpenAI({ prompt, model = null, timeoutMs = 30000 }) {
  model ||= process.env.OPENAI_MODEL || 'gpt-5.1';
  if (!process.env.OPENAI_API_KEY) return { ok: false, mode: 'unconfigured', error: 'OPENAI_API_KEY required', artifacts: [] };
  const response = await withTimeout(fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: `${prompt}\nReturn JSON: {"artifacts":[{"path":"relative/path","content":"file content"}],"summary":"..."}`, stream: false }),
  }), timeoutMs);
  const body = await response.json().catch(() => ({}));
  return parseModelBody({ ok: response.ok, provider: 'openai', mode: 'api', body, error: response.ok ? null : JSON.stringify(body) });
}

export async function callAnthropic({ prompt, model = null, timeoutMs = 30000 }) {
  model ||= process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5';
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

export async function runCodexCliPacket(packetPath, { workspaceRoot = path.dirname(packetPath), model = null, timeoutMs = 30_000, spawnImpl = spawn, shouldCancel = null } = {}) {
  const available = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0;
  if (!available) return { ok: false, mode: 'unavailable', error: 'Codex CLI is not installed or authenticated', artifacts: [] };
  const cwd = path.resolve(workspaceRoot || path.dirname(packetPath));
  const finalPath = path.join(providerRuntimeDir('hermes-codex-results'), `${path.basename(packetPath, '.json')}.codex-final.json`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const args = ['exec', '--json', '--sandbox', 'read-only', '--cd', cwd, '--output-last-message', finalPath];
  if (model) args.push('--model', model);
  args.push(`Read the approved task packet at ${packetPath}. Return only JSON with {"artifacts":[{"path":"relative/path","content":"file content"}],"summary":"..."}. Do not modify files.`);
  const before = snapshotWorkspace(cwd);
  const result = await runCliChild(spawnImpl, 'codex', args, { cwd, timeoutMs: Math.max(1, Number(timeoutMs) || 1), shouldCancel });
  const parsed = parseCodexCliResult(result, finalPath);
  if (parsed.ok && workspaceMutated(before, snapshotWorkspace(cwd))) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI mutated the workspace before artifact application', artifacts: [] };
  return parsed.ok ? { ...parsed, usage: { ...(parsed.usage || {}), monetaryCostState: 'subscription_unmetered' } } : parsed;
}

function mockResponse(packet) {
  const requestedPath = packet.request.match(/`([^`]+)`/)?.[1] || 'docs/hermes-mock-change.md';
  return { ok: true, provider: 'mock', mode: 'mock', summary: 'Mock provider proposed a safe local coding edit.', artifacts: [{ path: requestedPath, content: `# Hermes Mock Change\n\nRequest: ${packet.request}\n` }], usage: { inputTokens: 50, outputTokens: 25, costCents: 0 } };
}

function manualPacket(packet, workspaceRoot = '.') {
  const packetPath = writeTaskPacket(packet, workspaceRoot);
  return { ok: true, provider: 'manual', mode: 'handoff', summary: `Manual task packet written to ${packetPath}`, artifacts: [], manualPacketPath: packetPath, usage: { inputTokens: 0, outputTokens: 0, costCents: 0 } };
}

function writeTaskPacket(packet, workspaceRoot = '.', { external = false } = {}) {
  const dir = external ? providerRuntimeDir('hermes-task-packets') : path.resolve(workspaceRoot || '.', '.hermes-task-packets');
  fs.mkdirSync(dir, { recursive: true });
  const packetPath = path.join(dir, `${packet.taskId || id('task')}.json`);
  fs.writeFileSync(packetPath, JSON.stringify(packet, null, 2));
  return packetPath;
}

function providerRuntimeDir(name) {
  return path.resolve(process.env.BLACKSPIRE_DATA_DIR || os.tmpdir(), name);
}

function normalizeProviderResult({ provider, mode, model = null, started, response }) {
  const monetaryCostState = response.usage?.monetaryCostState || (provider === 'codex' && mode === 'cli' ? 'subscription_unmetered' : 'metered');
  return {
    ok: Boolean(response.ok), provider, mode, model, artifacts: response.artifacts || [], summary: response.summary || '', manualPacketPath: response.manualPacketPath,
    usage: { provider, mode, model, latencyMs: Date.now() - started, inputTokens: response.usage?.inputTokens || 0, outputTokens: response.usage?.outputTokens || 0, costCents: response.usage?.costCents ?? null, monetaryCostState },
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

function runCliChild(spawnImpl, command, args, { cwd, timeoutMs, shouldCancel = null }) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let cancelled = false;
    let outputExceeded = false;
    let child;
    let timer;
    let cancelTimer;
    const finish = (status, signal = null, errorText = '') => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (cancelTimer) clearInterval(cancelTimer);
      const stderrText = outputExceeded ? `${stderr}\nCodex CLI output exceeded limit`.trim() : cancelled ? `${stderr}\nCodex CLI cancelled by task controls`.trim() : timedOut ? `${stderr}\nCodex CLI deadline exceeded`.trim() : (errorText || stderr);
      resolve({ status, signal, stdout, stderr: stderrText });
    };
    try {
      child = spawnImpl(command, args, { cwd, env: sanitizedCodexEnvironment(process.env), stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish(1, null, String(error?.message || error));
      return;
    }
    const terminate = () => {
      child.kill?.('SIGTERM');
      setTimeout(() => child.kill?.('SIGKILL'), 1000).unref?.();
    };
    timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    if (typeof shouldCancel === 'function') {
      cancelTimer = setInterval(() => {
        try {
          if (!settled && shouldCancel()) {
            cancelled = true;
            terminate();
          }
        } catch (error) {
          cancelled = true;
          stderr = `${stderr}\n${String(error?.message || error)}`.trim();
          terminate();
        }
      }, 250);
      cancelTimer.unref?.();
    }
    child.stdout?.setEncoding?.('utf8');
    child.stderr?.setEncoding?.('utf8');
    child.stdout?.on?.('data', (chunk) => { stdout = appendBounded(stdout, chunk, () => { outputExceeded = true; terminate(); }); });
    child.stderr?.on?.('data', (chunk) => { stderr = appendBounded(stderr, chunk, () => { outputExceeded = true; terminate(); }); });
    child.on?.('error', (error) => finish(1, null, String(error?.message || error)));
    child.on?.('close', (code, signal) => finish(outputExceeded || cancelled || timedOut ? 124 : (code ?? 1), signal));
  });
}

function appendBounded(current, chunk, onExceeded) {
  const next = current + chunk.toString();
  if (Buffer.byteLength(next) <= CODEX_CLI_MAX_STREAM_BYTES) return next;
  onExceeded();
  return next.slice(0, CODEX_CLI_MAX_STREAM_BYTES);
}

function sanitizedCodexEnvironment(source) {
  const env = {
    PATH: source.PATH || process.env.PATH || '',
    HOME: source.HOME || process.env.HOME || '',
    USER: source.USER || process.env.USER || '',
    LOGNAME: source.LOGNAME || process.env.LOGNAME || '',
    SHELL: source.SHELL || process.env.SHELL || '',
    TERM: source.TERM || 'dumb',
    TMPDIR: source.TMPDIR || os.tmpdir(),
    XDG_CONFIG_HOME: source.XDG_CONFIG_HOME || '',
    XDG_DATA_HOME: source.XDG_DATA_HOME || '',
    CODEX_HOME: source.CODEX_HOME || '',
  };
  for (const [key, value] of Object.entries(env)) if (!value) delete env[key];
  return env;
}

export function parseCodexCliResult(result, finalPath = null) {
  const events = parseCodexJsonl(result.stdout || '');
  if (!events.ok) return { ok: false, provider: 'codex', mode: 'cli', error: events.error, artifacts: [] };
  if (result.status !== 0) return { ok: false, provider: 'codex', mode: 'cli', error: codexError(result, events.records), artifacts: [] };
  if (!events.terminal) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI JSONL stream did not contain a terminal result', artifacts: [] };
  const finalText = finalPath && fs.existsSync(finalPath) ? fs.readFileSync(finalPath, 'utf8') : extractFinalMessage(events.records);
  if (!finalText || finalText.length > 1_000_000) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI final output was missing or truncated', artifacts: [] };
  try {
    const parsed = JSON.parse(finalText.trim());
    if (!Array.isArray(parsed.artifacts) || !parsed.artifacts.every(validArtifact)) throw new Error('invalid artifact schema');
    return { ok: true, provider: 'codex', mode: 'cli', artifacts: parsed.artifacts, summary: String(parsed.summary || ''), usage: parsed.usage || {} };
  } catch {
    return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI final output did not match the artifact schema', artifacts: [] };
  }
}

function parseCodexJsonl(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (!lines.length) return { ok: false, error: 'Codex CLI emitted no JSONL events', records: [] };
  const records = [];
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (!record || typeof record !== 'object') throw new Error('not object');
      records.push(record);
    } catch {
      return { ok: false, error: 'Codex CLI emitted malformed JSONL', records };
    }
  }
  return { ok: true, records, terminal: records.some((record) => record.type === 'turn.completed' || record.type === 'thread.completed') };
}

function extractFinalMessage(records) {
  for (const record of [...records].reverse()) {
    const text = record?.item?.message?.content?.[0]?.text || record?.item?.text || record?.message?.content?.[0]?.text || record?.message?.text;
    if (typeof text === 'string' && text.trim()) return text;
  }
  return '';
}

function codexError(result, records) {
  const eventError = records.find((record) => record.type === 'error' || record.error || record?.item?.type === 'error');
  return redact(eventError ? JSON.stringify(eventError) : (result.stderr || 'Codex CLI exited nonzero'));
}

function validArtifact(artifact) {
  return artifact && typeof artifact === 'object' && typeof artifact.path === 'string' && artifact.path.length > 0 && !path.isAbsolute(artifact.path) && typeof artifact.content === 'string';
}

function snapshotWorkspace(root) {
  const entries = new Map();
  if (!root || !fs.existsSync(root)) return entries;
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === '.git' || name === '.hermes-task-packets') continue;
      const full = path.join(dir, name);
      const relative = path.relative(root, full);
      const stat = fs.lstatSync(full);
      if (stat.isDirectory()) visit(full);
      else entries.set(relative, `${stat.size}:${stat.mtimeMs}`);
    }
  };
  visit(root);
  return entries;
}

function workspaceMutated(before, after) {
  if (before.size !== after.size) return true;
  for (const [key, value] of before) if (after.get(key) !== value) return true;
  return false;
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
  return { inputTokens: body.usage?.input_tokens || body.usage?.inputTokens || 0, outputTokens: body.usage?.output_tokens || body.usage?.outputTokens || 0, costCents: null, monetaryCostState: 'metered_cost_unavailable' };
}

function usage(selected, latencyMs, overrides = {}) {
  return { provider: selected.provider, mode: selected.mode, model: selected.model || null, latencyMs, inputTokens: 0, outputTokens: 0, costCents: null, monetaryCostState: 'unavailable', ...overrides };
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('provider timeout')), timeoutMs))]);
}
