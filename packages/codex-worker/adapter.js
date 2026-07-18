import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redact } from '../shared/util.js';

export const CODEX_WORKER_CONTRACT_VERSION = '1';
export const CODEX_WORKER_MAX_OUTPUT_BYTES = 8_192;
const invoked = new Set();

export async function runSubscriptionCodexWorker(request, { spawnImpl = spawn, timeoutMs = 45_000 } = {}) {
  validateWorkerRequest(request);
  if (invoked.has(request.idempotencyKey)) return failure('duplicate replay', 'duplicate');
  invoked.add(request.idempotencyKey);
  const runtime = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-codex-worker-'));
  const schemaPath = path.join(runtime, 'response.schema.json');
  const outputPath = path.join(runtime, 'last-message.json');
  fs.writeFileSync(schemaPath, JSON.stringify(responseSchema()));
  const env = sanitizedEnvironment(process.env);
  const args = ['exec','-','--ephemeral','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--sandbox','read-only','--output-schema',schemaPath,'--output-last-message',outputPath,'--json','--color','never','--cd',runtime];
  let child;
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  try {
    const result = await new Promise((resolve, reject) => {
      child = spawnImpl('codex', args, { cwd: runtime, env, stdio: ['pipe','pipe','pipe'] });
      const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); setTimeout(() => child.kill('SIGKILL'), 1_000).unref(); }, Math.min(timeoutMs, Math.max(1, Date.parse(request.deadline) - Date.now())));
      child.on('error', reject);
      child.stdout.on('data', (chunk) => { stdout = bounded(stdout, chunk); });
      child.stderr.on('data', (chunk) => { stderr = bounded(stderr, chunk); });
      child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
      child.stdin.end(workerPrompt(request));
    });
    if (timedOut) return failure('Codex worker timeout', 'timeout');
    if (result.code !== 0) return failure(normalizeCodexError(stderr), 'failed');
    if (hasToolInvocation(stdout)) return failure('Codex worker attempted a prohibited tool invocation', 'prohibited_tool');
    if (!fs.existsSync(outputPath)) return failure('Codex worker returned no structured result', 'malformed');
    const raw = fs.readFileSync(outputPath, 'utf8');
    if (Buffer.byteLength(raw) > CODEX_WORKER_MAX_OUTPUT_BYTES) return failure('Codex worker result exceeded output limit', 'oversized');
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return failure('Codex worker result was malformed', 'malformed'); }
    validateWorkerResponse(parsed, request);
    return { ok: true, status: 'completed', worker: 'codex-subscription', authenticationMode: 'chatgpt-subscription', invocationCount: 1, toolCalls: 0, result: redact(parsed.result), contractVersion: parsed.version };
  } catch (error) {
    return failure(redact(error.message), 'failed');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(runtime, { recursive: true, force: true });
  }
}

export function validateWorkerRequest(request) {
  const keys = ['version','requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','objective','permittedCapabilityClasses','deniedCapabilityClasses','deadline','cancellationReference','idempotencyKey','invocationLimit'];
  exactKeys(request, keys, 'worker request');
  if (request.version !== CODEX_WORKER_CONTRACT_VERSION) throw new Error('unknown worker contract version');
  for (const key of ['requestId','canonicalConversationId','canonicalTaskId','actorId','workspaceId','channel','objective','deadline','cancellationReference','idempotencyKey']) if (typeof request[key] !== 'string' || !request[key]) throw new Error(`invalid worker ${key}`);
  if (request.invocationLimit !== 1) throw new Error('worker invocation limit must be one');
  if (Date.parse(request.deadline) <= Date.now()) throw new Error('worker deadline expired');
  if (!Array.isArray(request.permittedCapabilityClasses) || request.permittedCapabilityClasses.some((value) => value !== 'status_summary')) throw new Error('worker capabilities are not restricted');
  if (!Array.isArray(request.deniedCapabilityClasses) || !request.deniedCapabilityClasses.includes('credentials')) throw new Error('worker denied capabilities are incomplete');
  return request;
}

export function validateWorkerResponse(response, request) {
  exactKeys(response, ['version','requestId','canonicalTaskId','status','result'], 'worker response');
  if (response.version !== CODEX_WORKER_CONTRACT_VERSION || response.requestId !== request.requestId || response.canonicalTaskId !== request.canonicalTaskId) throw new Error('worker response changed canonical identity');
  if (response.status !== 'completed' || typeof response.result !== 'string' || !response.result.trim() || response.result.length > 500) throw new Error('invalid worker result');
  return response;
}

export function resetWorkerInvocationForTests() { invoked.clear(); }

function workerPrompt(request) {
  return `You are a restricted read-only worker. Do not call tools, run commands, access files, browse, modify anything, or contact external resources. The synthetic fixture is: {"service":"restricted-codex-worker","state":"operational","sensitive":false}. Objective: ${request.objective}\nReturn only the JSON object required by the supplied schema. Preserve version=${request.version}, requestId=${request.requestId}, canonicalTaskId=${request.canonicalTaskId}, and status=completed.`;
}
function responseSchema() { return { type:'object', additionalProperties:false, required:['version','requestId','canonicalTaskId','status','result'], properties:{ version:{const:'1'}, requestId:{type:'string'}, canonicalTaskId:{type:'string'}, status:{const:'completed'}, result:{type:'string',maxLength:500} } }; }
function sanitizedEnvironment(source) { const env = { ...source }; for (const key of ['OPENAI_API_KEY','ANTHROPIC_API_KEY','CODEX_API_KEY','GITHUB_TOKEN','GH_TOKEN','TELEGRAM_BOT_TOKEN','TELEGRAM_WEBHOOK_SECRET']) delete env[key]; return env; }
function hasToolInvocation(jsonl) { return jsonl.split('\n').some((line) => { try { const event=JSON.parse(line); return /tool|command|shell|file_change|web_search/i.test(String(event.type || event.item?.type || '')); } catch { return false; } }); }
function normalizeCodexError(value) { const text=String(value || 'Codex worker failed'); if (/login|auth|unauthorized/i.test(text)) return 'Codex subscription authentication unavailable'; if (/limit|quota|usage/i.test(text)) return 'Codex subscription usage limit reached'; return 'Codex worker failed'; }
function bounded(current, chunk) { const next=current+chunk.toString(); if (Buffer.byteLength(next)>CODEX_WORKER_MAX_OUTPUT_BYTES*4) throw new Error('Codex worker stream exceeded limit'); return next; }
function failure(error, status) { return { ok:false, status, worker:'codex-subscription', authenticationMode:'chatgpt-subscription', invocationCount:1, toolCalls:0, error:redact(error) }; }
function exactKeys(value, expected, label) { if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error(`${label} must be an object`); const a=Object.keys(value).sort(), b=[...expected].sort(); if (a.length!==b.length || a.some((key,index)=>key!==b[index])) throw new Error(`${label} contains missing or unknown fields`); }
