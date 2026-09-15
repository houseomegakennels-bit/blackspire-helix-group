import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {createBuyerWriterPostgres} from '../packages/buyer-writer/postgres.js';
import {createBuyerWriterHttpServer} from '../packages/buyer-writer/http.js';
import {planBuyerWrites} from '../packages/buyer-writer/plan.js';

assert.equal(process.versions.node,'22.23.1');
const image=process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
const owner=randomUUID(),name=`zola-native-${owner}`,networkName=`${name}-net`;
console.log(JSON.stringify({nativeFixtureOwner:owner,containerName:name,networkName}));
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'zola-native-tls-'));
let cleaning=false;
const docker=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',timeout:cleaning?5000:30000,maxBuffer:1024*1024});
const requireSuccess=result=>{assert.equal(result.status,0,'isolated native operation failed');return result.stdout.trim();};
let networkId,containerId,networkAttempted=false,containerAttempted=false,pools,server,proxy;
const proxySockets=new Set();
const checks=[];
function discover(kind,identifier) {
  const result=docker(kind==='network'?['network','inspect',identifier]:['inspect',identifier]);
  if(result.status!==0){assert.match(result.stderr??'',/No such (object|container|network)/,'ambiguous resource ownership');return null;}
  const record=JSON.parse(result.stdout)[0];
  assert.equal((kind==='network'?record.Labels:record.Config.Labels)['blackspire.test-owner'],owner,'resource ownership mismatch');
  assert.match(record.Id,/^[a-f0-9]{64}$/);return record;
}
let cleanupPromise;
function cleanup() {
  return cleanupPromise??=(async()=>{
    cleaning=true;
    const errors=[];
    try{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));server=null;}}catch{errors.push('http');}
    try{if(pools){await pools.close();pools=null;}}catch{errors.push('pools');}
    try{for(const socket of proxySockets)socket.destroy();if(proxy)await new Promise(resolve=>proxy.close(resolve));}catch{errors.push('proxy');}
    try{if(containerAttempted){const record=discover('container',containerId??name);if(record)requireSuccess(docker(['rm','-f',record.Id]));containerAttempted=false;}}catch{errors.push('container');}
    try{if(networkAttempted){const record=discover('network',networkId??networkName);if(record)requireSuccess(docker(['network','rm',record.Id]));networkAttempted=false;}}catch{errors.push('network');}
    try{fs.rmSync(temporary,{recursive:true,force:true});}catch{errors.push('temporary');}
    assert.equal(errors.length,0,'native fixture cleanup incomplete');
  })();
}
let interrupted=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{
  interrupted=true;void cleanup().then(()=>process.exit(1),()=>process.exit(1));
});
const literal=value=>`'${String(value).replaceAll("'","''")}'`;
const sql=statement=>requireSuccess(docker(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'],statement));
const copy=(filename,contents)=>requireSuccess(docker(['exec','-i','--user','postgres',containerId,'sh','-c',`umask 077; cat > ${filename}`],contents));
let failed=false,phase='network';
try {
  networkAttempted=true;
  networkId=requireSuccess(docker(['network','create','--internal','--label',`blackspire.test-owner=${owner}`,networkName]));
  assert.equal(discover('network',networkId).Internal,true);
  phase='container';
  containerAttempted=true;
  const bootstrap='umask 077; od -An -N32 -tx1 /dev/urandom | tr -d " \\n" > /tmp/bootstrap-password; export POSTGRES_PASSWORD_FILE=/tmp/bootstrap-password; exec docker-entrypoint.sh postgres';
  containerId=requireSuccess(docker(['create','--name',name,'--label',`blackspire.test-owner=${owner}`,'--network',networkId,
    '--read-only','--memory','512m','--cpus','1','--pids-limit','128',
    '--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m',
    '-e','POSTGRES_HOST_AUTH_METHOD=reject','-e','POSTGRES_INITDB_ARGS=--auth-host=reject --auth-local=trust','-e','POSTGRES_DB=writer_test',
    '--entrypoint','sh',image,'-c',bootstrap]));
  const created=discover('container',containerId);
  assert.equal(created.HostConfig.ReadonlyRootfs,true);assert.equal(created.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  requireSuccess(docker(['start',containerId]));
  phase='bootstrap';
  let ready=false;
  for(let i=0;i<60;i++){
    if(docker(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d writer_test']).status===0){ready=true;break;}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert.ok(ready&&!interrupted,'isolated PostgreSQL did not become ready');
  phase='server-version';assert.match(sql('show server_version'),/^17\.6/);
  phase='loopback-binding';
  const network=discover('network',networkId), running=discover('container',containerId);
  assert.equal(network.Internal,true);
  assert.equal(Object.keys(network.Containers).length,1);
  assert.ok(network.Containers[containerId]);
  assert.equal(Object.keys(running.NetworkSettings.Networks).length,1);
  const attachment=Object.values(running.NetworkSettings.Networks)[0];
  assert.equal(attachment.NetworkID,networkId);
  const target=attachment.IPAddress;assert.equal(net.isIP(target),4);
  assert.equal(network.Containers[containerId].IPv4Address.split('/')[0],target);
  assert.ok(Object.values(running.NetworkSettings.Ports??{}).every(value=>value===null));
  proxy=net.createServer(client=>{
    if(proxySockets.size>=16){client.destroy();return;}
    const upstream=new net.Socket();proxySockets.add(client);proxySockets.add(upstream);
    let bytes=0;const close=()=>{client.destroy();upstream.destroy();};
    const connectTimer=setTimeout(close,2000);
    const lifetime=setTimeout(close,30000);
    for(const socket of [client,upstream]){
      socket.on('error',close);socket.setTimeout(15000,close);
      socket.on('data',chunk=>{bytes+=chunk.length;if(bytes>1024*1024)close();});
      socket.once('close',()=>{clearTimeout(connectTimer);clearTimeout(lifetime);proxySockets.delete(socket);close();});
    }
    upstream.connect(5432,target,()=>clearTimeout(connectTimer));
    client.pipe(upstream);upstream.pipe(client);
  });
  await new Promise((resolve,reject)=>{proxy.once('error',reject);proxy.listen(0,'127.0.0.1',()=>{proxy.removeListener('error',reject);resolve();});});
  proxy.on('error',()=>{for(const socket of proxySockets)socket.destroy();});
  assert.equal(proxy.address().address,'127.0.0.1');
  const port=proxy.address().port;
  phase='tls-and-schema';
  const key=path.join(temporary,'server.key'),cert=path.join(temporary,'server.crt');
  requireSuccess(spawnSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1',
    '-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{encoding:'utf8',timeout:15000,maxBuffer:8192}));
  fs.chmodSync(key,0o600);copy('/tmp/server.key',fs.readFileSync(key));copy('/tmp/server.crt',fs.readFileSync(cert));
  sql("alter system set log_statement='none';alter system set log_min_error_statement='panic';alter system set ssl='on';alter system set ssl_cert_file='/tmp/server.crt';alter system set ssl_key_file='/tmp/server.key';select pg_reload_conf();");
  sql(fs.readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql('begin;'+fs.readFileSync(new URL('../frontend/supabase/migrations/20260904223151_buyer_browser_security.sql',import.meta.url),'utf8')+'commit;');
  sql(fs.readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8'));
  const runtimePassword=randomBytes(32).toString('base64url'),issuerPassword=randomBytes(32).toString('base64url');
  sql(`set log_statement='none';set log_min_error_statement='panic';set password_encryption='scram-sha-256';alter role buyer_writer_runtime login password ${literal(runtimePassword)};alter role buyer_writer_issuer login password ${literal(issuerPassword)};`);
  copy('/var/lib/postgresql/data/pg_hba.conf','local all all trust\nhostssl writer_test buyer_writer_runtime,buyer_writer_issuer 0.0.0.0/0 scram-sha-256\nhost all all 0.0.0.0/0 reject\nhost all all ::0/0 reject\n');
  sql('select pg_reload_conf();');assert.equal(sql('select count(*) from pg_hba_file_rules where error is not null'),'0');
  const base={host:'127.0.0.1',port,database:'writer_test',ca:fs.readFileSync(cert,'utf8')};
  const config={runtime:{...base,password:runtimePassword},issuer:{...base,password:issuerPassword}};
  phase='driver-identities';
  pools=await createBuyerWriterPostgres(config);
  assert.equal(sql("select count(distinct a.usename)=2 and bool_and(s.ssl) from pg_stat_activity a join pg_stat_ssl s using(pid) where a.usename in('buyer_writer_runtime','buyer_writer_issuer')"),'t');
  await assert.rejects(createBuyerWriterPostgres({runtime:{...config.runtime,ca:undefined},issuer:{...config.issuer,ca:undefined}}),/unavailable/);
  await assert.rejects(createBuyerWriterPostgres({...config,runtime:{...config.runtime,password:randomBytes(32).toString('base64url')}}),/unavailable/);
  checks.push('actual driver rejects untrusted TLS and wrong SCRAM credentials; both dedicated TLS identities accepted');
  const workload=randomBytes(32).toString('base64url'),issuerKey=randomBytes(32).toString('base64url');
  phase='native-http-writes';
  server=createBuyerWriterHttpServer({credential:workload,workspace:'isolated',query:pools.runtimeQuery,isAvailable:()=>pools.isHealthy(),issuer:{credential:issuerKey,query:pools.issuerQuery}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const jobId=randomUUID(),userId=randomUUID(),requestId=randomUUID();
  sql(`insert into auth.users(id) values(${literal(userId)})`);
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type,date_range_start,date_range_end) values(${literal(jobId)},${literal(userId)},'NC','Wake','land','2026-01-01','2026-12-31')`);
  const captured=JSON.parse(sql(`select jsonb_build_object('criteria',buyer_writer.criteria(to_jsonb(j)),'updatedAt',j.updated_at) from public."SearchJob" j where id=${literal(jobId)}`));
  const sale={buyer_name:'NATIVE TEST LLC',seller_name:'SYNTHETIC',property_address:'TEST ONLY',mailing_address:'TEST, NC',sale_price:120000,sale_date:'2026-08-01',property_type:'land',parcel_id:'TEST',deed_type:'TEST',lender_name:'UNKNOWN'};
  const bytes=Buffer.from(JSON.stringify([sale]));
  const sourceContext={version:1,mode:'frontend_payload',sources:[{sourceId:randomUUID(),sourceType:'arcgis',endpointId:'isolated',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],budgets:{maxRequests:1,maxRows:1,maxBytes:1048576},rawPayload:{digest:createHash('sha256').update(bytes).digest('hex'),byteCount:bytes.length,rowCount:1}};
  const post=async(kind,body,permit)=>{
    const headers={'content-type':'application/json',...(kind==='issuance'||kind==='reconciliation'?{'x-buyer-issuer-key':issuerKey}:{'x-buyer-writer-key':workload,'x-buyer-job-permit':permit})};
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1/jobs/${jobId}/${kind}`,{method:'POST',headers,body:JSON.stringify(body),signal:AbortSignal.timeout(17000)});
    assert.equal(response.status,200,'native HTTP operation rejected');return response.json();
  };
  const issued=await post('issuance',{version:1,ownerId:userId,requestId,...captured,sourceContext});
  const envelope={version:1,dispatchId:issued.dispatchId,generation:issued.generation};
  await post('operations',{...envelope,operation:'start',chunkIndex:0,chunkCount:1,payload:{}},issued.permit);
  const syntheticLoss=new Error('Injected completion response loss');let lost=false;
  try {
    for(const operation of planBuyerWrites({jobId,...envelope,criteria:captured.criteria,raw:[sale],clean:[sale]})){
      await post('operations',operation,issued.permit);
      if(operation.operation==='complete')throw syntheticLoss;
    }
  }catch(error){assert.ok(error===syntheticLoss,'unexpected native write error');lost=true;}
  assert.ok(lost,'unknown outcome was not injected');
  // Explicit fault injection after database/HTTP completion, not a claim of
  // physical network interruption. Recover the original attempt without replay.
  const reconciled=await post('reconciliation',{version:1,ownerId:userId,requestId,updatedAt:captured.updatedAt});
  assert.equal(reconciled.state,'completed');
  assert.equal(sql(`select count(*) from buyer_writer.dispatches where id=${literal(requestId)}`),'1');
  for(const table of ['RawSale','CleanSale','BuyerProfile','BuyerReport'])assert.equal(sql(`select count(*) from public."${table}"`),'1');
  assert.equal(sql(`select status from public."SearchJob" where id=${literal(jobId)}`),'completed');
  checks.push('actual driver and HTTP write all five tables; completed receipt survives response-loss fault injection without replay');
  phase='privilege-drift';
  const receiptSql='select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result';
  const receiptArgs=[createHash('sha256').update(issued.permit).digest('hex'),'isolated',jobId,issued.dispatchId,issued.generation,'complete',0];
  assert.equal((await pools.runtimeQuery(receiptSql,receiptArgs)).rows[0].result.found,true);
  sql('grant create on schema buyer_writer to buyer_writer_runtime');
  await assert.rejects(pools.runtimeQuery(receiptSql,receiptArgs),/unavailable/);
  sql('revoke create on schema buyer_writer from buyer_writer_runtime');
  assert.equal((await pools.runtimeQuery(receiptSql,receiptArgs)).rows[0].result.found,true);
  checks.push('privilege drift rejects on the next real checkout');
  phase='native-lock-timeout';
  const oldPid=sql("select pid from pg_stat_activity where usename='buyer_writer_runtime'");
  assert.match(oldPid,/^[0-9]+$/);
  const blocker=spawn('docker',['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin'}});
  let blockerOutput='',blockerBytes=0,lockedResolve,lockedReject;
  const locked=new Promise((resolve,reject)=>{lockedResolve=resolve;lockedReject=reject;});
  const blockerDeadline=setTimeout(()=>{blocker.kill('SIGKILL');lockedReject(new Error('isolated lock fixture timed out'));},12000);
  const blockerDone=new Promise((resolve,reject)=>{
    blocker.once('error',()=>{lockedReject(new Error('isolated lock fixture failed'));reject(new Error('isolated lock fixture failed'));});
    blocker.once('close',code=>{clearTimeout(blockerDeadline);lockedReject(new Error('isolated lock fixture closed'));code===0?resolve():reject(new Error('isolated lock fixture failed'));});
  });
  // Consume rejection immediately; both promises are awaited below.
  void blockerDone.catch(()=>{});
  for(const stream of [blocker.stdout,blocker.stderr])stream.on('data',chunk=>{
    blockerBytes+=chunk.length;if(blockerBytes>8192)blocker.kill('SIGKILL');
  });
  blocker.stdout.on('data',chunk=>{if(blockerBytes<=8192){blockerOutput+=chunk.toString('utf8');if(blockerOutput.includes('fixture_locked'))lockedResolve();}});
  blocker.stdin.on('error',()=>{});
  blocker.stdin.end("begin;lock table buyer_writer.receipts in access exclusive mode;select 'fixture_locked';select pg_sleep(7);rollback;");
  try {
    await locked;
    phase='native-lock-rejection';
    const started=performance.now();
    await assert.rejects(pools.runtimeQuery(receiptSql,receiptArgs),/unavailable/);
    phase='native-lock-duration';
    const elapsed=performance.now()-started;
    console.log(JSON.stringify({lockElapsedMs:Math.round(elapsed)}));
    assert.ok(elapsed>=4500&&elapsed<9000,'native lock deadline not enforced');
    phase='native-lock-connection-destruction';
    let removed=false;
    for(let i=0;i<20;i++){
      await new Promise(resolve=>setTimeout(resolve,50));
      if(sql(`select count(*) from pg_stat_activity where pid=${oldPid}`)==='0'){removed=true;break;}
    }
    assert.ok(removed,'failed connection was retained');
  } finally {await blockerDone;}
  phase='native-lock-recovery';
  assert.equal((await pools.runtimeQuery(receiptSql,receiptArgs)).rows[0].result.found,true);
  checks.push('real PostgreSQL lock timeout surfaces failure, destroys the failed connection and permits a fresh verified checkout');

}catch{failed=true;console.error(JSON.stringify({error:'Native Buyer writer verification failed',phase}));}
finally{try{await cleanup();}catch{failed=true;console.error('Native Buyer writer cleanup failed');}}
if(failed||interrupted)process.exitCode=1;
else console.log(JSON.stringify({driver:'pg 8.23.0',postgres:'17.6',checks,productionConnections:0,providerCalls:0,outreach:0,cleanup:true}));
