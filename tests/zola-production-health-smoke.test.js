import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Readable} from 'node:stream';
import {hash} from '../packages/zola-release/commander-journal.js';
import {HELD_ACCEPTANCE_CAPABILITIES,HELD_ACCEPTANCE_OPERATIONS} from '../packages/zola-release/held-acceptance-authority.js';
import {PRODUCTION_HEALTH_URL,createHealthSmokeProductionOperations,requestFixedProductionHealth}
 from '../packages/zola-release/production-health-smoke.js';

const releaseSha='a'.repeat(40),apiGeneration='b'.repeat(32),workerGeneration='c'.repeat(32);
const commanderRunId='11111111-1111-4111-8111-111111111111',epochRunId='22222222-2222-4222-8222-222222222222';
const permitId='33333333-3333-4333-8333-333333333333';
const permissions=['seller.opportunities.read','buyer.profiles.read','buyer.matches.read','deal.records.read','deal.analysis.read','nexus.enrichment.read'];
const claims={schema:1,kind:'held-epoch-acceptance',permitId,commanderRunId,mergeMainSha:releaseSha,expectedDeploymentSha:releaseSha,
 epochRunId,workspace:'workspace-one',principal:'principal-one',apiGeneration,workerGeneration,issuedAt:1,expiresAt:1000,
 operations:[...HELD_ACCEPTANCE_OPERATIONS],reads:HELD_ACCEPTANCE_CAPABILITIES.map((capability,index)=>{
  const idempotencyKey=`zola-six:${epochRunId}:${index}`,request=`read ${index}`;
  return{index,idempotencyKey,capability,permission:permissions[index],request,
   requestDigest:hash({channel:'jarvis',workspaceId:'workspace-one',text:request,idempotencyKey,executionIntent:'read_only'})};
 }),tokenDigest:'d'.repeat(64)};

function evidence(operation,extra={}){
 return{schema:1,operation,permitId,attemptId:`${String(4+HELD_ACCEPTANCE_OPERATIONS.indexOf(operation)).repeat(8)}-${String(4+HELD_ACCEPTANCE_OPERATIONS.indexOf(operation)).repeat(4)}-4${String(4+HELD_ACCEPTANCE_OPERATIONS.indexOf(operation)).repeat(3)}-8${String(4+HELD_ACCEPTANCE_OPERATIONS.indexOf(operation)).repeat(3)}-${String(4+HELD_ACCEPTANCE_OPERATIONS.indexOf(operation)).repeat(12)}`,
  mergeMainSha:releaseSha,epochRunId,apiGeneration,workerGeneration,bindingDigest:'e'.repeat(64),...extra};
}
function events(pending){
 const rows=[{schema:1,type:'held_acceptance_mint_intent',claims,claimsDigest:hash(claims)},
  {schema:1,type:'held_acceptance_minted',permitId,claimsDigest:hash(claims)},
  {schema:1,type:'held_acceptance_consume_intent',permitId,claimsDigest:hash(claims)}];
 const completed=HELD_ACCEPTANCE_OPERATIONS.slice(0,HELD_ACCEPTANCE_OPERATIONS.indexOf(pending));
 for(const operation of completed){
  const base=operation==='six_live_reads'?evidence(operation,{status:'PASS_LIVE_ACCEPTANCE',livePass:true,readCount:6,crossOwnerDenials:6,
   paidProviderCalls:0,mutationDelta:0,collectorDigest:'f'.repeat(64)}):evidence(operation,{status:'PASS',observationDigest:'f'.repeat(64)});
  rows.push({schema:1,type:'held_acceptance_operation_intent',permitId,claimsDigest:hash(claims),operation,attemptId:base.attemptId});
  rows.push({schema:1,type:'held_acceptance_operation_result',permitId,claimsDigest:hash(claims),operation,attemptId:base.attemptId,evidenceDigest:hash(base),evidence:base});
 }
 rows.push({schema:1,type:'held_acceptance_operation_intent',permitId,claimsDigest:hash(claims),operation:pending,attemptId:'99999999-9999-4999-8999-999999999999'});
 return rows;
}
function fixture(stage){
 const rows=events(stage),context={input:{releaseSha,workspace:'workspace-one',principal:'principal-one'},journal:{stream:()=>({events:()=>rows})}};
 const state={context:{operationId:commanderRunId},outputs:{capture_new_main_sha:{newMainSha:releaseSha}}};
 const call={input:null,state,ordinal:24,attemptId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',inputDigest:'1'.repeat(64),checkOutputDigest:'2'.repeat(64)};
 call.input=context.input;return{context,call};
}
const health=()=>({ok:true,service:'blackspire-command-api',lifecycle:'ready',emergencyStop:false,database:'available',
 deploymentIdentity:{state:'VERIFIED',build:{value:releaseSha},environment:{value:'production'}},
 dependencies:{worker:{required:true,ok:true,state:'idle',heartbeatAgeMs:10,generationId:workerGeneration}}});

test('api health operation binds fixed release, sequence, attempt, principal and generations',async()=>{
 const {context,call}=fixture('api_health');let reads=0;
 const operations=createHealthSmokeProductionOperations(context,{requestHealth:async()=>{reads++;return health();},now:(()=>{let n=0;return()=>n++;})()});
 assert.equal((await operations.api_health.check({input:context.input,state:call.state,ordinal:24})).status,'PASS');
 operations.api_health.execute(call);const result=await operations.api_health.reconcile(call);
 assert.equal(reads,1);assert.equal(result.status,'PASS');assert.equal(result.evidence.endpoint,PRODUCTION_HEALTH_URL);
 assert.equal(result.evidence.releaseSha,releaseSha);assert.equal(result.evidence.operationId,commanderRunId);
 assert.equal(result.evidence.stageAttemptId,call.attemptId);assert.equal(result.evidence.apiGeneration,apiGeneration);
 assert.equal(result.evidence.workerGeneration,workerGeneration);assert.match(result.evidence.observationDigest,/^[a-f0-9]{64}$/);
});

test('production smoke summarizes existing HELD collector/lifecycle evidence and rechecks runtime',async()=>{
 const {context,call}=fixture('production_smoke');
 const result=await createHealthSmokeProductionOperations(context,{requestHealth:async()=>health(),now:(()=>{let n=10;return()=>n++;})()}).production_smoke.reconcile(call);
 assert.equal(result.status,'PASS');assert.equal(result.evidence.acceptancePathSucceeded,true);
 assert.equal(result.evidence.readCount,6);assert.equal(result.evidence.crossOwnerDenials,6);
 assert.equal(result.evidence.unexpectedMutation,false);assert.equal(result.evidence.paidProviderActivity,false);
 assert.equal(result.evidence.staleWorker,false);assert.equal(result.evidence.exactRuntimeSha,true);
});

test('health and smoke fail closed for stale SHA, worker, collector or caller binding',async()=>{
 const api=fixture('api_health');
 await assert.rejects(()=>createHealthSmokeProductionOperations(api.context,{requestHealth:async()=>({...health(),deploymentIdentity:{...health().deploymentIdentity,build:{value:'9'.repeat(40)}}})}).api_health.reconcile(api.call),/rejected/);
 const smoke=fixture('production_smoke');smoke.context.journal.stream().events().find(row=>row.operation==='six_live_reads'&&row.type==='held_acceptance_operation_result').evidence.paidProviderCalls=1;
 await assert.rejects(()=>createHealthSmokeProductionOperations(smoke.context,{requestHealth:async()=>health()}).production_smoke.reconcile(smoke.call),/rejected/);
 assert.throws(()=>createHealthSmokeProductionOperations(api.context).api_health.execute({...api.call,attemptId:'wrong'}),/rejected/);
});

function transport(responseSpec){
 return{request(options,onResponse){
  const request=new EventEmitter();request.end=()=>queueMicrotask(()=>{
   if(responseSpec==='timeout'){request.emit('timeout');return;}
   const response=Readable.from([Buffer.from(responseSpec.body??'')]);response.statusCode=responseSpec.status;response.headers=responseSpec.headers;
   onResponse(response);
  });request.destroy=error=>request.emit('error',error);return Object.assign(request,{options});
 }};
}

test('fixed health transport accepts bounded JSON and rejects redirects and timeout',async()=>{
 const good=transport({status:200,headers:{'content-type':'application/json'},body:JSON.stringify(health())});
 assert.deepEqual(await requestFixedProductionHealth({timeoutMs:100,transport:good}),health());
 const redirect=transport({status:302,headers:{location:'http://example.invalid/','content-type':'application/json'}});
 await assert.rejects(()=>requestFixedProductionHealth({timeoutMs:100,transport:redirect}),/REJECTED/);
 await assert.rejects(()=>requestFixedProductionHealth({timeoutMs:25,transport:transport('timeout')}),/TIMEOUT/);
});
