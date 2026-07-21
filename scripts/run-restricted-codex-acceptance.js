import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

if (process.env.OPENAI_API_KEY) throw new Error('Restricted subscription Codex acceptance forbids OPENAI_API_KEY');
const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-codex-acceptance-'));
process.env.BLACKSPIRE_DATA_DIR=runtime;
process.env.BLACKSPIRE_DB_PATH=path.join(runtime,'acceptance.sqlite');
process.env.BLACKSPIRE_RUNTIME_MODE='restricted-subscription-codex-test';

let closeDb;
try {
  const tasks=await import('../packages/task-engine/tasks.js');
  const workspaces=await import('../packages/workspace-registry/workspaces.js');
  ({ closeDb }=await import('../packages/task-engine/db.js'));
  const { runRestrictedCodexAcceptance }=await import('../packages/codex-worker/acceptance.js');
  workspaces.upsertWorkspace({id:'subscription-codex-acceptance',name:'Subscription Codex Acceptance',githubRepository:'synthetic/restricted-status',allowedPaths:[],buildCommands:[],providerPolicy:{preferred:['codex-subscription']},budgetCents:1,secretReferences:[],enabledTools:['status'],rootPath:runtime});
  const task=tasks.createTask({workspaceId:'subscription-codex-acceptance',request:'Return only a structured result confirming that the restricted subscription Codex worker path is operational. Make no file changes, invoke no tools, access no external resources, and perform no privileged actions.',idempotencyKey:'restricted-subscription-codex-final-v3',budgetCents:1,sourceChannel:'api',actorId:'restricted-test-actor',authorityClass:'authenticated_admin'});
  const result=await runRestrictedCodexAcceptance({task,workspace:workspaces.getWorkspace('subscription-codex-acceptance'),actorId:'restricted-test-actor',timeoutMs:45_000});
  const records=tasks.taskRecords(task.id);
  const attempt=records.providerAttempts[0];
  const evidence=records.evidence.find((row)=>row.kind==='codex_worker_result');
  const details=evidence?JSON.parse(evidence.details):{};
  const safe={timestamp:new Date().toISOString(),worker:'codex-subscription',authenticationMode:'chatgpt-subscription',invocationCount:records.providerAttempts.length,successfulInvocations:attempt?.status==='completed'?1:0,retries:0,fallbackProviders:0,toolCalls:details.toolCalls||0,canonicalTaskStatus:result.status,contractValidated:Boolean(details.contractValidated),diagnostic:details.diagnostic||null};
  process.stdout.write(`${JSON.stringify(safe)}\n`);
  if (result.status!=='completed') process.exitCode=1;
} finally {
  closeDb?.();
  fs.rmSync(runtime,{recursive:true,force:true});
}
