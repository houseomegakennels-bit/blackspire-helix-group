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
  const startedAt = Date.now();
  let parserStage = 'not_started';
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
    const diagnostic = diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt });
    if (timedOut) return failure('Codex worker timeout', 'timeout', { ...diagnostic, failureCategory:'timeout' });
    if (result.code !== 0) return failure(normalizeCodexError(`${stderr}\n${structuredErrorText(stdout)}`), 'failed', { ...diagnostic, failureCategory:classifyFailure(stderr, stdout) });
    if (hasToolInvocation(stdout)) return failure('Codex worker attempted a prohibited tool invocation', 'prohibited_tool', { ...diagnostic, failureCategory:'prohibited_tool' });
    parserStage = 'output_file';
    if (!fs.existsSync(outputPath)) return failure('Codex worker returned no structured result', 'malformed', { ...diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }), failureCategory:'empty_output' });
    const raw = fs.readFileSync(outputPath, 'utf8');
    parserStage = 'size_check';
    if (Buffer.byteLength(raw) > CODEX_WORKER_MAX_OUTPUT_BYTES) return failure('Codex worker result exceeded output limit', 'oversized', { ...diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }), failureCategory:'output_truncation' });
    let parsed;
    parserStage = 'json_parse';
    try { parsed = JSON.parse(raw); } catch { return failure('Codex worker result was malformed', 'malformed', { ...diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }), failureCategory:'natural_language_or_malformed_output' }); }
    parserStage = 'schema_validation';
    try { validateWorkerResponse(parsed, request); } catch { return failure('Codex worker response contract failed', 'malformed', { ...diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }), failureCategory:'contract_validation' }); }
    parserStage = 'completed';
    return { ok: true, status: 'completed', worker: 'codex-subscription', authenticationMode: 'chatgpt-subscription', invocationCount: 1, toolCalls: 0, result: redact(parsed.result), contractVersion: parsed.version, diagnostic:diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }) };
  } catch (error) {
    return failure(redact(error.message), 'failed', { invocationStarted:Boolean(child), exitCodeCategory:'spawn_or_stream_error', timeout:false, stdoutPresent:Boolean(stdout), stderrPresent:Boolean(stderr), stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr), structuredRecords:countStructuredRecords(stdout), parserStage, schemaValidated:false, failureCategory:'adapter_runtime', durationMs:Date.now()-startedAt, terminationSignal:null });
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
function classifyFailure(stderr, stdout='') { const structured=structuredErrorText(stdout); const text=`${String(stderr||'')}\n${structured}`; if (/login|auth|unauthorized/i.test(text)) return 'authentication_unavailable'; if (/limit|quota|rate.?limit|usage/i.test(text)) return 'subscription_limit'; if (/unknown|unexpected|unrecognized|invalid (?:option|argument)|unsupported flag/i.test(text)) return 'unsupported_cli_flag'; if (/schema|json.?schema|structured output/i.test(text)) return 'output_schema_rejected'; if (/nested|max(?:imum)? depth|spawn depth/i.test(text)) return 'nested_invocation_prohibited'; if (/sandbox|landlock|permission denied/i.test(text)) return 'sandbox_initialization'; if (structured) return 'nonzero_exit_with_structured_stdout_error'; return 'process_exit_nonzero'; }
function bounded(current, chunk) { const next=current+chunk.toString(); if (Buffer.byteLength(next)>CODEX_WORKER_MAX_OUTPUT_BYTES*4) throw new Error('Codex worker stream exceeded limit'); return next; }
function diagnosticMetadata({ result, timedOut, stdout, stderr, parserStage, startedAt }) { return { invocationStarted:true, exitCodeCategory:result.code===0?'zero':`nonzero:${Number.isInteger(result.code)?result.code:'unknown'}`, timeout:Boolean(timedOut), stdoutPresent:Boolean(stdout), stderrPresent:Boolean(stderr), stdoutBytes:Buffer.byteLength(stdout), stderrBytes:Buffer.byteLength(stderr), structuredRecords:countStructuredRecords(stdout), structuredErrorRecords:countStructuredErrors(stdout), parserStage, schemaValidated:parserStage==='completed', durationMs:Date.now()-startedAt, terminationSignal:result.signal?String(result.signal):null }; }
function countStructuredRecords(value) { return String(value||'').split('\n').reduce((count,line)=>{ try { JSON.parse(line); return count+1; } catch { return count; } },0); }
function countStructuredErrors(value) { return structuredErrors(value).length; }
function structuredErrorText(value) { return structuredErrors(value).map((event)=>String(event.message||event.error?.message||event.error||event.item?.message||event.item?.error||'')).join(' ').slice(0,2048); }
function structuredErrors(value) { return String(value||'').split('\n').flatMap((line)=>{ try { const event=JSON.parse(line); return /error|failed/i.test(String(event.type||event.item?.type||event.status||''))?[event]:[]; } catch { return []; } }); }
function failure(error, status, diagnostic = null) { return { ok:false, status, worker:'codex-subscription', authenticationMode:'chatgpt-subscription', invocationCount:status==='duplicate'?0:1, toolCalls:0, error:redact(error), ...(diagnostic?{diagnostic}:{}) }; }
function exactKeys(value, expected, label) { if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error(`${label} must be an object`); const a=Object.keys(value).sort(), b=[...expected].sort(); if (a.length!==b.length || a.some((key,index)=>key!==b[index])) throw new Error(`${label} contains missing or unknown fields`); }
