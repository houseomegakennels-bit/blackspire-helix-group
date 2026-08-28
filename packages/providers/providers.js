import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { id, redact } from '../shared/util.js';

const CODEX_CLI_MAX_STREAM_BYTES = 1_000_000;
const CODEX_CLI_PROBE_TIMEOUT_MS = 2_000;
let codexCapability = null;

export async function codexCliAvailable({ env = process.env, deadline = null, shouldCancel = null, spawnImpl = spawn, timeoutMs = CODEX_CLI_PROBE_TIMEOUT_MS } = {}) {
  const fingerprint = codexCapabilityFingerprint(env);
  const version = await runBoundedProbe('codex', ['--version'], { env: sanitizedCodexEnvironment(env), deadline, shouldCancel, spawnImpl, timeoutMs });
  if (version.status !== 0) { codexCapability = { fingerprint, state: 'unavailable', checkedAt: Date.now() }; return false; }
  const doctor = await runBoundedProbe('codex', ['doctor', '--json'], { env: sanitizedCodexEnvironment(env), deadline, shouldCancel, spawnImpl, timeoutMs });
  if (doctor.status === 124 || doctor.signal !== null) { codexCapability = { fingerprint, state: 'unavailable', checkedAt: Date.now() }; return false; }
  try {
    const report = JSON.parse(doctor.stdout || '{}');
    const checks = report?.checks;
    const available = report?.schemaVersion === 1
      && checks?.['auth.credentials']?.status === 'ok'
      && checks?.['network.provider_reachability']?.status === 'ok'
      && checks?.['network.websocket_reachability']?.status === 'ok';
    codexCapability = { fingerprint, state: available ? 'verified' : 'unavailable', checkedAt: Date.now() };
    return available;
  } catch {
    codexCapability = { fingerprint, state: 'unavailable', checkedAt: Date.now() };
    return false;
  }
}

export function activeModes() {
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && process.env.BLACKSPIRE_PROVIDER_MODE === 'manual') {
    return { openai: 'disabled-by-profile', anthropic: 'disabled-by-profile', codex: 'disabled-by-profile', claudeCode: 'disabled-by-profile' };
  }
  const capabilityVerified = codexCapability?.fingerprint === codexCapabilityFingerprint(process.env) && codexCapability.state === 'verified';
  return {
    openai: process.env.OPENAI_API_KEY ? 'api' : 'unconfigured',
    anthropic: process.env.ANTHROPIC_API_KEY ? 'api' : 'unconfigured',
    codex: (process.env.CODEX_API_ENDPOINT || process.env.CODEX_API_KEY) ? 'direct-api-unimplemented' : (capabilityVerified ? 'cli' : 'capability-unknown'),
    claudeCode: process.env.BLACKSPIRE_RUNTIME_MODE === 'production' ? 'disabled-by-profile' : 'capability-unknown',
  };
}

export async function resolveProviderAvailability(candidates, options = {}) {
  const modes = {};
  for (const provider of candidates) {
    if (provider === 'codex') modes.codex = await codexCliAvailable(options) ? 'cli' : 'unavailable';
    else modes[provider] = 'disabled-by-profile';
    if (modes[provider] === 'cli') break;
  }
  return modes;
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
  if (process.env.BLACKSPIRE_RUNTIME_MODE === 'production' && selected.provider === 'codex' && !codexHomeReady(process.env.CODEX_HOME)) {
    return { ok: false, provider: 'codex', mode: 'cli-disabled-by-profile', artifacts: [], usage: usage(selected, 0), error: 'production Codex execution requires CODEX_HOME outside protected home', raw: null };
  }
  const started = Date.now();
  try {
    if (selected.provider === 'mock') return normalizeProviderResult({ provider: 'mock', mode: 'mock', model: selected.model, started, response: mockResponse(packet) });
    const timeoutMs = deadline ? Math.max(1, Date.parse(deadline) - Date.now()) : 30_000;
    if (selected.provider === 'openai') return normalizeProviderResult({ provider: 'openai', mode: selected.mode, model: selected.model, started, response: await callOpenAI({ prompt: JSON.stringify(packet), model: selected.model, timeoutMs }) });
    if (selected.provider === 'anthropic') return normalizeProviderResult({ provider: 'anthropic', mode: selected.mode, model: selected.model, started, response: await callAnthropic({ prompt: JSON.stringify(packet), model: selected.model, timeoutMs }) });
    if (selected.provider === 'claudeCode') return normalizeProviderResult({ provider: 'claudeCode', mode: selected.mode, model: selected.model, started, response: runClaudeCodePacket(writeTaskPacket(packet, workspace?.root_path)) });
    if (selected.provider === 'codex' && selected.mode === 'cli') return normalizeProviderResult({ provider: 'codex', mode: 'cli', model: selected.model, started, response: await runCodexCliPacket(writeTaskPacket(packet, workspace?.root_path, { external: true }), { workspaceRoot: workspace?.root_path, model: selected.model, executionIntent: packet.executionIntent, timeoutMs, shouldCancel }) });
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

export async function runCodexCliPacket(packetPath, { workspaceRoot = path.dirname(packetPath), model = null, executionIntent = 'workspace_mutation', timeoutMs = 30_000, spawnImpl = spawn, shouldCancel = null } = {}) {
  const cwd = path.resolve(workspaceRoot || path.dirname(packetPath));
  const finalPath = path.join(providerRuntimeDir('hermes-codex-results'), `${path.basename(packetPath, '.json')}.codex-final.json`);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  const args = ['exec', '--json', '--sandbox', 'read-only', '--cd', cwd, '--output-last-message', finalPath];
  if (model) args.push('--model', model);
  const responseContract = executionIntent === 'read_only'
    ? 'This is a read-only task. Return only JSON with {"artifacts":[],"summary":"..."}; artifacts must be empty.'
    : 'This is a workspace-mutation task. Return only JSON with {"artifacts":[{"path":"relative/path","content":"file content"}],"summary":"..."}; include every proposed complete file artifact.';
  args.push(`Read the approved task packet at ${packetPath}. ${responseContract} Do not modify files.`);
  const before = snapshotProviderIsolation(cwd);
  const result = await runCliChild(spawnImpl, 'codex', args, { cwd, timeoutMs: Math.max(1, Number(timeoutMs) || 1), shouldCancel });
  const parsed = parseCodexCliResult(result, finalPath);
  if (workspaceMutated(before, snapshotProviderIsolation(cwd))) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI mutated the workspace before artifact application', artifacts: [] };
  return parsed.ok ? { ...parsed, usage: { ...(parsed.usage || {}), monetaryCostState: 'subscription_unmetered' } } : parsed;
}

function mockResponse(packet) {
  if (packet.executionIntent === 'read_only') {
    return { ok: true, provider: 'mock', mode: 'mock', summary: 'Mock provider completed a read-only workspace inspection.', artifacts: [], usage: { inputTokens: 50, outputTokens: 25, costCents: 0 } };
  }
  const requestedPath = packet.request.match(/`([^`]+)`/)?.[1] || 'docs/hermes-mock-change.md';
  return { ok: true, provider: 'mock', mode: 'mock', summary: 'Mock provider proposed a safe local coding edit.', artifacts: [{ path: requestedPath, content: `# Hermes Mock Change\n\nRequest: ${packet.request}\n` }], usage: { inputTokens: 50, outputTokens: 25, costCents: 0 } };
}

function manualPacket(packet, workspaceRoot = '.') {
  const packetPath = writeTaskPacket(packet, workspaceRoot, { external: true });
  return { ok: true, provider: 'manual', mode: 'handoff', summary: `Manual task packet written to ${packetPath}`, artifacts: [], manualPacketPath: packetPath, usage: { inputTokens: 0, outputTokens: 0, costCents: 0 } };
}

function writeTaskPacket(packet, workspaceRoot = '.', { external = false } = {}) {
  const dir = external ? providerRuntimeDir('hermes-task-packets') : path.resolve(workspaceRoot || '.', '.hermes-task-packets');
  const workspace = fs.realpathSync(path.resolve(workspaceRoot || '.'));
  if (!external) fs.mkdirSync(dir, { recursive: true });
  const packetPath = path.join(dir, `${packet.taskId || id('task')}.json`);
  const packetDirectoryDescriptor = external
    ? openConfinedDirectory(dir, workspace)
    : fs.openSync(dir, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  let descriptor;
  try {
    const physicalPacketPath = physicalProspectivePath(packetPath);
    const packetRelative = path.relative(workspace, physicalPacketPath);
    if (external && (packetRelative === '' || (!packetRelative.startsWith(`..${path.sep}`) && packetRelative !== '..' && !path.isAbsolute(packetRelative)))) {
      throw new Error('External provider packet path must be outside the workspace');
    }
    // Node does not expose openat(2). On Linux, the procfs descriptor link gives
    // openSync the same pinned-directory semantics: subsequent path replacement
    // cannot redirect the create into a different directory.
    const pinnedDirectory = `/proc/self/fd/${packetDirectoryDescriptor}`;
    const pinnedPhysicalDirectory = fs.realpathSync(pinnedDirectory);
    const pinnedRelative = path.relative(workspace, pinnedPhysicalDirectory);
    if (external && (pinnedRelative === '' || (!pinnedRelative.startsWith(`..${path.sep}`) && pinnedRelative !== '..' && !path.isAbsolute(pinnedRelative)))) {
      throw new Error('External provider packet path must be outside the workspace');
    }
    descriptor = fs.openSync(path.join(pinnedDirectory, path.basename(packetPath)), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    fs.writeFileSync(descriptor, JSON.stringify(packet, null, 2));
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.closeSync(packetDirectoryDescriptor);
  }
  return packetPath;
}

function openConfinedDirectory(target, workspace) {
  const missing = [];
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Unable to resolve external provider runtime directory');
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  assertExternalDirectory(fs.realpathSync(existing), workspace);
  let descriptor = fs.openSync(existing, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try {
    for (const component of missing) {
      const pinnedParent = `/proc/self/fd/${descriptor}`;
      assertExternalDirectory(fs.realpathSync(pinnedParent), workspace);
      const child = path.join(pinnedParent, component);
      try {
        fs.mkdirSync(child, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
      const childDescriptor = fs.openSync(child, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      fs.closeSync(descriptor);
      descriptor = childDescriptor;
    }
    assertExternalDirectory(fs.realpathSync(`/proc/self/fd/${descriptor}`), workspace);
    return descriptor;
  } catch (error) {
    fs.closeSync(descriptor);
    throw error;
  }
}

function assertExternalDirectory(directory, workspace) {
  const relative = path.relative(workspace, directory);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('External provider runtime directory must be outside the workspace');
  }
}

function physicalProspectivePath(target) {
  const missing = [];
  let existing = path.resolve(target);
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error('Unable to resolve external provider runtime directory');
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), ...missing);
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

function runCliChild(spawnImpl, command, args, { cwd, timeoutMs, shouldCancel = null, env = sanitizedCodexEnvironment(process.env) }) {
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
      child = spawnImpl(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      finish(1, null, String(error?.message || error));
      return;
    }
    const terminate = () => {
      if (Number.isInteger(child.pid) && child.pid > 0) {
        try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill?.('SIGTERM'); }
        setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill?.('SIGKILL'); } }, 1000).unref?.();
      } else {
        child.kill?.('SIGTERM');
        setTimeout(() => child.kill?.('SIGKILL'), 1000).unref?.();
      }
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
  const codexHome = source.CODEX_HOME || '';
  const env = {
    PATH: source.PATH || process.env.PATH || '',
    HOME: codexHome || source.HOME || process.env.HOME || '',
    USER: source.USER || process.env.USER || '',
    LOGNAME: source.LOGNAME || process.env.LOGNAME || '',
    SHELL: source.SHELL || process.env.SHELL || '',
    TERM: source.TERM || 'dumb',
    TMPDIR: source.TMPDIR || os.tmpdir(),
    XDG_CONFIG_HOME: codexHome || source.XDG_CONFIG_HOME || '',
    XDG_DATA_HOME: codexHome || source.XDG_DATA_HOME || '',
    CODEX_HOME: codexHome,
  };
  for (const [key, value] of Object.entries(env)) if (!value) delete env[key];
  return env;
}

function codexCapabilityFingerprint(env) {
  return JSON.stringify([env.PATH || '', env.CODEX_HOME || '', env.BLACKSPIRE_RUNTIME_MODE || '', env.BLACKSPIRE_PRODUCTION_EXECUTION || '']);
}

function runBoundedProbe(command, args, { env, deadline, shouldCancel, spawnImpl, timeoutMs }) {
  const deadlineMs = deadline ? Date.parse(deadline) - Date.now() : timeoutMs;
  const bound = Math.max(1, Math.min(timeoutMs, Number.isFinite(deadlineMs) ? deadlineMs : timeoutMs));
  return runCliChild(spawnImpl, command, args, { cwd: process.cwd(), env, timeoutMs: bound, shouldCancel });
}

function codexHomeReady(value) {
  if (!value || !path.isAbsolute(value)) return false;
  const resolved = path.resolve(value);
  if (resolved === '/root' || resolved.startsWith('/root/') || resolved === '/home' || resolved.startsWith('/home/')) return false;
  try {
    const stat = fs.statSync(resolved);
    fs.accessSync(resolved, fs.constants.R_OK | fs.constants.W_OK);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function readBoundedFinalOutput(finalPath) {
  const stat = fs.statSync(finalPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > CODEX_CLI_MAX_STREAM_BYTES) return '';
  return fs.readFileSync(finalPath, 'utf8');
}

export function parseCodexCliResult(result, finalPath = null) {
  const events = parseCodexJsonl(result.stdout || '');
  if (!events.ok) return { ok: false, provider: 'codex', mode: 'cli', error: events.error, artifacts: [] };
  if (result.status !== 0) return { ok: false, provider: 'codex', mode: 'cli', error: codexError(result, events.records), artifacts: [] };
  if (!events.terminal) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI JSONL stream did not contain a terminal result', artifacts: [] };
  const finalText = finalPath && fs.existsSync(finalPath) ? readBoundedFinalOutput(finalPath) : extractFinalMessage(events.records);
  if (!finalText || Buffer.byteLength(finalText) > CODEX_CLI_MAX_STREAM_BYTES) return { ok: false, provider: 'codex', mode: 'cli', error: 'Codex CLI final output was missing or truncated', artifacts: [] };
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

const MAX_WORKSPACE_SNAPSHOT_ENTRIES = 100_000;
const MAX_WORKSPACE_SNAPSHOT_BYTES = 256 * 1024 * 1024;

function snapshotProviderIsolation(root) {
  const entries = new Map();
  if (!root || !fs.existsSync(root)) return entries;
  let entryCount = 0;
  let byteCount = 0;
  const visit = (dir, namespace, base) => {
    const handle = fs.opendirSync(dir);
    try {
      let directoryEntry;
      while ((directoryEntry = handle.readSync()) !== null) {
      const name = directoryEntry.name;
      const full = path.join(dir, name);
      const relative = `${namespace}:${path.relative(base, full)}`;
      const stat = fs.lstatSync(full);
      if (++entryCount > MAX_WORKSPACE_SNAPSHOT_ENTRIES) throw new Error('Workspace is too large to verify provider isolation safely');
      if (stat.isDirectory()) {
        entries.set(relative, `directory:${stat.mode}`);
        visit(full, namespace, base);
      } else if (stat.isSymbolicLink()) {
        entries.set(relative, `symlink:${fs.readlinkSync(full)}`);
      } else if (stat.isFile()) {
        byteCount += stat.size;
        if (byteCount > MAX_WORKSPACE_SNAPSHOT_BYTES) throw new Error('Workspace is too large to verify provider isolation safely');
        entries.set(relative, `file:${stat.mode}:${stat.dev}:${stat.ino}:${stat.nlink}:${createHash('sha256').update(fs.readFileSync(full)).digest('hex')}`);
      } else entries.set(relative, `unsupported:${stat.mode}`);
      }
    } finally {
      handle.closeSync();
    }
  };
  const workspace = fs.realpathSync(root);
  if (++entryCount > MAX_WORKSPACE_SNAPSHOT_ENTRIES) throw new Error('Workspace is too large to verify provider isolation safely');
  entries.set('workspace:', `directory:${fs.lstatSync(workspace).mode}`);
  visit(workspace, 'workspace', workspace);
  const gitDirectories = new Set();
  for (const option of ['--absolute-git-dir', '--git-common-dir']) {
    const result = spawnSync('git', ['-C', workspace, 'rev-parse', option], { encoding: 'utf8' });
    if (result.status !== 0) continue;
    const reported = result.stdout.trim();
    gitDirectories.add(fs.realpathSync(path.isAbsolute(reported) ? reported : path.resolve(workspace, reported)));
  }
  const externalGitDirectories = [...gitDirectories]
    .filter((gitDirectory) => {
      const relative = path.relative(workspace, gitDirectory);
      return relative !== '' && (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative));
    })
    .filter((gitDirectory, _index, roots) => !roots.some((other) => other !== gitDirectory && isPathInside(other, gitDirectory)))
    .sort();
  for (const [gitDirectoryIndex, gitDirectory] of externalGitDirectories.entries()) {
    const namespace = `gitdir${gitDirectoryIndex}`;
    if (++entryCount > MAX_WORKSPACE_SNAPSHOT_ENTRIES) throw new Error('Workspace is too large to verify provider isolation safely');
    entries.set(`${namespace}:`, `directory:${fs.lstatSync(gitDirectory).mode}`);
    visit(gitDirectory, namespace, gitDirectory);
  }
  return entries;
}

function isPathInside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
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
