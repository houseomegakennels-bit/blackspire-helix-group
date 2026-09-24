#!/usr/bin/env node
// Exact immutable frontend source, real Next HTTP, synthetic loopback database.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { RECOVERY_SHA } from '../packages/zola-rollback/intake.js';
import { cases } from '../packages/zola-six-reads/offline.js';
import { blackspireCapabilityRegistry } from '../packages/capabilities/index.js';
import { validateCapabilityOutput } from '../packages/capabilities/contract.js';
import { startRecoveryFrontend } from '../packages/zola-rollback/frontend-fixture.js';
let fixture;
try {
  assert.equal(process.argv.length, 2);
  assert.deepEqual(Object.keys(process.env).sort(), ['NODE_NO_WARNINGS','PATH','ZOLA_CANDIDATE_PARENT_NET','ZOLA_SIX_READ_DISPOSABLE_DIR'].sort());
  const root=process.env.ZOLA_SIX_READ_DISPOSABLE_DIR;
  assert.deepEqual(fs.readdirSync(root), []);
  fixture=await startRecoveryFrontend(root);
  const { request, events, workspace, token, sourceDigest }=fixture;
  const results=[];
  for(const entry of cases){
    const body={workspaceId:workspace,...entry.input,...(entry.id==='buyer.matches.search'?{matchesOnly:true}:{})};
    const before=events.length;
    for(const [auth,scope] of [[null,workspace],['wrong-token',workspace],[token,'foreign-workspace']])assert.equal((await request(entry,{...body,workspaceId:scope},auth)).status,404);
    assert.equal(events.length,before,'denials must precede database I/O');
    const own=await request(entry,body);assert.equal(own.status,200,`${entry.id} unavailable`);
    validateCapabilityOutput(blackspireCapabilityRegistry.get(entry.id),own.data);
    const count=entry.collection?own.data[entry.collection].length:own.data.found===false?0:own.data.source===null?0:1;
    assert.ok(count>0&&count<=5,`${entry.id} needs a nonempty bounded witness`);
    results.push({capability:entry.id,status:'PASS_IMMUTABLE_NEXT_HTTP',boundedResultCount:count,anonymousDenial:true,wrongCredentialDenial:true,foreignWorkspaceDenial:true,databaseRequests:events.length-before});
  }
  fixture.assertIntegrity();
  process.stdout.write(JSON.stringify({version:1,recoverySha:RECOVERY_SHA,status:'PASS_IMMUTABLE_FRONTEND_HTTP',productionAccepted:false,sourceDigest,archiveDigest:fixture.archiveDigest,results,
    dependencyScope:'Reused installed dependencies; exact recovery package and lock bytes match current checkout; installed package integrity not independently verified',
    observedDatabaseMutationAttempts:0,externalNetwork:'kernel isolated; loopback only',limitations:['Next development runtime, not production build or deployment','Synthetic database; no live row-owner policy or complete functional rollback acceptance']})+'\n');
}catch(error){process.stderr.write(`Immutable recovery frontend failed: ${String(error.message).slice(0,160)}\n`);process.exitCode=1;}
finally{await fixture?.close();}
