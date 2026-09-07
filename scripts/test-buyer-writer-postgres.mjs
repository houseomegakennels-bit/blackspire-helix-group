import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseWriterOperation } from '../packages/buyer-writer/protocol.js';
import { createBuyerWriterHttpServer } from '../packages/buyer-writer/http.js';
import { planBuyerWrites } from '../packages/buyer-writer/plan.js';
import { normalizeBuyerSales } from '../packages/buyer-writer/normalize.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const name = `zola-writer-test-${randomUUID()}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership = randomUUID();
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'], statement);
  if (fail) { assert.notEqual(r.status, 0, 'expected database denial'); return; }
  assert.equal(r.status, 0, `isolated SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
  return r.stdout.trim();
};
const cleanup = () => {
  if(!owned && creationAttempted) {
    // A create RPC can time out after daemon-side creation. It has not been
    // started yet. Recover only our unpredictable ownership label, never a name
    // alone; deletion uses the immutable container ID to avoid name reuse races.
    const inspected=run(['inspect',name]);
    if(inspected.status===0) {
      const candidate=JSON.parse(inspected.stdout)[0];
      assert.equal(candidate.Config.Labels['blackspire.test-owner'],ownership,'container ownership mismatch');
      containerId=candidate.Id;owned=true;
    } else {
      assert.match(inspected.stderr??'',/No such (object|container)/,'ambiguous create cleanup could not be verified');
    }
  }
  if(!owned) return;
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const removed=run(['rm','-f',containerId]);
  assert.equal(removed.status,0,'owned disposable container cleanup failed');
  owned=false;creationAttempted=false;
};
for(const [signal,code] of [['SIGTERM',143],['SIGINT',130]]) process.once(signal,()=>{cleanup();process.exit(code);});
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
const role = (name, statement, options) => sql(`set session authorization ${name};begin;${statement};commit;`, options);
const count = (table) => Number(sql(`select count(*) from public."${table}"`));
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const workspace = 'isolated-buyer-workspace';
const sourceContext={version:1,mode:'county_fetch',sources:[{sourceId:'00000000-0000-4000-8000-000000000003',sourceType:'arcgis',endpointId:'isolated',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],budgets:{maxRequests:500,maxRows:50000,maxBytes:67108864},rawPayload:null};
const contextLiteral=literal(JSON.stringify(sourceContext))+'::jsonb';
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const issue = (options = {}) => {
  const jobId = randomUUID();
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type,date_range_start,date_range_end) values(${literal(jobId)},${literal(owner)},'NC','Wake','land','2026-01-01','2026-12-31')`);
  const permit = randomBytes(32).toString('base64url');
  const permitDigest = createHash('sha256').update(permit).digest('hex');
  const dispatch = JSON.parse(role('buyer_writer_issuer', `select buyer_writer.issue(${literal(jobId)},${literal(owner)},${literal(workspace)},${literal(permitDigest)},${literal(JSON.stringify(options.sourceContext??sourceContext))}::jsonb)`));
  return { jobId, permit, permitDigest, ...dispatch, ...options };
};
const sale = { buyer_name:'ISOLATED HOLDINGS LLC',seller_name:'SYNTHETIC',property_address:'TEST ONLY',mailing_address:'TEST, NC',sale_price:120000,sale_date:'2026-08-01',property_type:'land',parcel_id:'SYNTHETIC-1',deed_type:'TEST',lender_name:'UNKNOWN' };
const request = (d, operation, payload = {}, overrides = {}) => {
  const { payloadDigest, ...operationBody } = parseWriterOperation({ jobId:d.jobId, body:Buffer.from(JSON.stringify({ version:1,dispatchId:d.dispatchId,generation:d.generation,operation,chunkIndex:0,chunkCount:1,payload,...overrides })) });
  return operationBody;
};
const apply = (d, operation, payload = {}, overrides = {}, fail = false) => {
  const q = request(d,operation,payload,overrides);
  const result = role('buyer_writer_runtime',`select buyer_writer.apply(${literal(d.permitDigest)},${literal(workspace)},${literal(JSON.stringify(q))}::jsonb)`,{fail});
  return fail ? null : JSON.parse(result);
};
try {
  creationAttempted=true;
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=writer_test',image]);
  assert.equal(created.status,0,'isolated PostgreSQL container creation failed');
  containerId=created.stdout.trim();assert.match(containerId,/^[a-f0-9]{64}$/);
  const container = JSON.parse(run(['inspect',containerId]).stdout)[0];
  assert.equal(container.Config.Labels['blackspire.test-owner'],ownership);
  owned = true;
  assert.equal(container.HostConfig.NetworkMode,'none');assert.equal(container.HostConfig.ReadonlyRootfs,true);
  assert.equal(container.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  assert.equal(run(['start',containerId]).status,0,'isolated PostgreSQL container failed to start');
  let ready = false;
  for (let i=0;i<60;i++) {
    if (run(['exec',name,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d writer_test']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  assert.match(sql('show server_version'),/^17\.6/);
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql('begin;'+readFileSync(new URL('../frontend/supabase/migrations/20260904223151_buyer_browser_security.sql',import.meta.url),'utf8')+'commit;');
  sql('create role fixture_manager nologin nosuperuser createrole;grant create on database writer_test to fixture_manager;grant usage,create on schema public to fixture_manager;');
  for(const table of ['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport'])sql(`alter table public."${table}" owner to fixture_manager`);
  const installSql='set session authorization fixture_manager;'+readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
  sql(installSql);
  check('dedicated roles cannot select tables, issue arbitrary permits or assume the owner role',()=>{
    for(const r of ['anon','authenticated','buyer_writer_runtime','buyer_writer_issuer']) {
      for(const t of ['RawSale','CleanSale','BuyerProfile','BuyerReport']) role(r,`select * from public."${t}"`,{fail:true});
    }
    role('buyer_writer_runtime','set role buyer_writer_owner',{fail:true});
    role('buyer_writer_runtime','select * from buyer_writer.dispatches',{fail:true});
    role('buyer_writer_runtime',`select buyer_writer.issue(null,null,null,null,null)`,{fail:true});
  });
  check('source context is mandatory, immutable, scoped after start and derived without caller cash overrides',()=>{
    const d=issue();
    const get=(item=d,fail=false)=>role('buyer_writer_runtime',`select buyer_writer.context(${literal(item.permitDigest)},${literal(workspace)},${literal(item.jobId)},${literal(item.dispatchId)},${item.generation})`,{fail});
    get(d,true);apply(d,'start');
    const result=JSON.parse(get());assert.deepEqual(result.sourceContext,sourceContext);
    assert.match(result.sourceContextDigest,/^[a-f0-9]{64}$/);assert.equal(Object.hasOwn(result,'ownerId'),false);
    const before=JSON.stringify(result);sql(installSql);assert.equal(JSON.stringify(JSON.parse(get())),before);
    get({...d,permitDigest:'f'.repeat(64)},true);get({...d,generation:d.generation+1},true);
    role('buyer_writer_issuer',`select buyer_writer.issue(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal('f'.repeat(64))},false)`,{fail:true});
    for(const context of [null,{}, {...sourceContext,extra:true},{...sourceContext,mode:'frontend_payload'},
      {...sourceContext,sources:[...sourceContext.sources,...sourceContext.sources]},
      {...sourceContext,sources:[{...sourceContext.sources[0],endpointId:'https://evil.invalid'}]},
      {...sourceContext,budgets:{...sourceContext.budgets,maxRows:50001}}]) {
      role('buyer_writer_issuer',`select buyer_writer.issue(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${literal(JSON.stringify(context))}::jsonb)`,{fail:true});
    }
    assert.equal(JSON.stringify(JSON.parse(get())),before,'rejected issuance must not cancel current dispatch');
    sql(`update buyer_writer.dispatches set source_context=null where id=${literal(d.dispatchId)}`);
    get(d,true);apply(d,'raw.append',{rows:[sale]}, {},true);
    const cash=issue();const bound={...sourceContext,sources:[{...sourceContext.sources[0],cashDisabled:true}]};
    const issued=JSON.parse(role('buyer_writer_issuer',`select buyer_writer.issue(${literal(cash.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${literal(JSON.stringify(bound))}::jsonb)`));
    assert.equal(sql(`select no_cash_data from buyer_writer.dispatches where id=${literal(issued.dispatchId)}`),'t');
  });
  check('upgrade removes legacy boolean issuer and preserves but rejects context-free dispatch history',()=>{
    const d=issue();sql(`update buyer_writer.dispatches set source_context=null,source_context_digest=null where id=${literal(d.dispatchId)}`);
    // Recreate the old signature/ownership/grants, not a production schema clone.
    sql(`set role buyer_writer_owner;create function buyer_writer.issue(uuid,uuid,text,text,boolean) returns jsonb language sql security definer set search_path=pg_catalog as 'select null::jsonb';revoke all on function buyer_writer.issue(uuid,uuid,text,text,boolean) from public;grant execute on function buyer_writer.issue(uuid,uuid,text,text,boolean) to buyer_writer_issuer;`);
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,boolean)') is not null"),'t');
    sql(installSql);
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,boolean)') is null"),'t');
    assert.equal(sql(`select count(*) from buyer_writer.dispatches where id=${literal(d.dispatchId)} and source_context is null`),'1');
    apply(d,'start',{}, {},true);
  });
  check('scoped writes commit all five tables with receipts and no catalog response',()=>{
    const d=issue();
    assert.equal(apply(d,'start').ok,true);
    assert.equal(apply(d,'raw.append',{rows:[sale]}).ok,true);
    assert.equal(apply(d,'clean.append',{rows:[sale]}).ok,true);
    assert.equal(apply(d,'buyers.commit').ok,true);
    const result=apply(d,'complete'); assert.equal(result.ok,true);
    assert.equal(count('RawSale'),1);assert.equal(count('CleanSale'),1);assert.equal(count('BuyerProfile'),1);assert.equal(count('BuyerReport'),1);
    assert.equal(sql(`select status from public."SearchJob" where id=${literal(d.jobId)}`),'completed');
    assert.equal(JSON.stringify(result).includes(sale.buyer_name),false);
    apply(d,'complete',{}, {},true);
  });
  check('source row budgets and frontend raw-payload row binding reject excess writes',()=>{
    for(const c of [
      {...sourceContext,budgets:{...sourceContext.budgets,maxRows:1}},
      {...sourceContext,mode:'frontend_payload',rawPayload:{digest:'d'.repeat(64),rowCount:1,byteCount:2}},
    ]) {
      const d=issue({sourceContext:c});apply(d,'start');
      apply(d,'raw.append',{rows:[sale,{...sale,parcel_id:'OVER-LIMIT'}]}, {},true);
      assert.equal(sql(`select count(*) from public."RawSale" where search_job_id=${literal(d.jobId)}`),'0');
      assert.equal(apply(d,'raw.append',{rows:[sale]},{chunkCount:2}).ok,true);
      apply(d,'raw.append',{rows:[{...sale,parcel_id:'SECOND-CHUNK'}]},{chunkIndex:1,chunkCount:2},true);
    }
  });
  check('empty bound frontend payload permits completion but no appended raw row',()=>{
    const d=issue({sourceContext:{...sourceContext,mode:'frontend_payload',rawPayload:{digest:'e'.repeat(64),rowCount:0,byteCount:2}}});
    apply(d,'start');apply(d,'raw.append',{rows:[sale]}, {},true);
    assert.equal(apply(d,'buyers.commit').ok,true);assert.equal(apply(d,'complete').ok,true);
  });
  check('malformed, wrong-job, wrong-workspace and expired permits fail closed',()=>{
    const d=issue();
    apply({...d,permitDigest:'malformed'},'start',{}, {},true);
    apply({...d,jobId:randomUUID()},'start',{}, {},true);
    role('buyer_writer_runtime',`select buyer_writer.apply(${literal(d.permitDigest)},'other',${literal(JSON.stringify(request(d,'start')))}::jsonb)`,{fail:true});
    sql(`update buyer_writer.dispatches set expires_at=clock_timestamp()-interval '1 second' where id=${literal(d.dispatchId)}`);
    apply(d,'start',{}, {},true);
  });
  check('owner change, cancellation and stale generations reject future writes',()=>{
    const d=issue();sql(`update public."SearchJob" set user_id=${literal(other)} where id=${literal(d.jobId)}`);
    apply(d,'start',{}, {},true);
    const c=issue();role('buyer_writer_issuer',`select buyer_writer.cancel(${literal(c.jobId)},${literal(owner)},${literal(workspace)})`);
    apply(c,'start',{}, {},true);
    const g=issue();role('buyer_writer_issuer',`select buyer_writer.issue(${literal(g.jobId)},${literal(owner)},${literal(workspace)},${literal('a'.repeat(64))},${contextLiteral})`);
    apply(g,'start',{}, {},true);
  });
  check('replays and incomplete or forged provenance cannot report success',()=>{
    const d=issue();apply(d,'start');apply(d,'start',{}, {},true);
    apply(d,'raw.append',{rows:[sale]});apply(d,'raw.append',{rows:[sale]}, {},true);
    apply(d,'clean.append',{rows:[{...sale,sale_price:1}]},{},true);
    apply(d,'complete',{}, {},true);
    const before=count('CleanSale');apply(d,'clean.append',{rows:[sale]});assert.equal(count('CleanSale'),before+1);
  });
  check('failed profile/report transaction leaves a durable failure receipt and failed job',()=>{
    const d=issue();const row={...sale,buyer_name:'FAILURE LLC',parcel_id:'FAILURE'};
    apply(d,'start');apply(d,'raw.append',{rows:[row]});apply(d,'clean.append',{rows:[row]});
    const profiles=count('BuyerProfile'),reports=count('BuyerReport');
    sql(`alter table public."BuyerReport" add constraint fixture_failure check(buyer_name_snapshot <> 'FAILURE LLC')`);
    assert.deepEqual(apply(d,'buyers.commit'),{ok:false,code:'WRITE_FAILED'});
    assert.equal(count('BuyerProfile'),profiles);assert.equal(count('BuyerReport'),reports);
    assert.equal(sql(`select status from public."SearchJob" where id=${literal(d.jobId)}`),'failed');
    const receipt=JSON.parse(role('buyer_writer_runtime',`select buyer_writer.receipt(${literal(d.permitDigest)},${literal(workspace)},${literal(d.jobId)},${literal(d.dispatchId)},${d.generation},'buyers.commit',0)`));
    assert.deepEqual(receipt,{found:true,receipt:{ok:false,code:'WRITE_FAILED'}});
    apply(d,'buyers.commit',{}, {},true);
    sql('alter table public."BuyerReport" drop constraint fixture_failure');
    role('buyer_writer_issuer',`select buyer_writer.issue(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${contextLiteral})`);
    role('buyer_writer_runtime',`select buyer_writer.receipt(${literal(d.permitDigest)},${literal(workspace)},${literal(d.jobId)},${literal(d.dispatchId)},${d.generation},'buyers.commit',0)`,{fail:true});
  });
  check('direct SQL rejects NULL, unknown operations, owner fields and incomplete chunk streams',()=>{
    const d=issue();
    for(const q of [null,{...request(d,'start'),operation:'delete'}, {...request(d,'start'),payload:null}, {...request(d,'start'),owner_id:other}, {...request(d,'start'),generation:null}]) {
      role('buyer_writer_runtime',`select buyer_writer.apply(${literal(d.permitDigest)},${literal(workspace)},${q===null?'null':literal(JSON.stringify(q))+'::jsonb'})`,{fail:true});
    }
    role('buyer_writer_runtime',`select buyer_writer.apply(null,null,null)`,{fail:true});
    sql(`update public."SearchJob" set status=null where id=${literal(d.jobId)}`);apply(d,'start',{}, {},true);
    sql(`update public."SearchJob" set status='pending' where id=${literal(d.jobId)}`);
    apply(d,'start');apply(d,'raw.append',{rows:[sale]},{chunkCount:2});
    apply(d,'buyers.commit',{}, {},true);apply(d,'clean.append',{rows:[sale]}, {},true);
    apply(d,'raw.append',{rows:[{...sale,sale_price:1}]},{chunkCount:2},true);
    const wrong={...request(d,'raw.append',{rows:[sale]}),chunkCount:501};
    role('buyer_writer_runtime',`select buyer_writer.apply(${literal(d.permitDigest)},${literal(workspace)},${literal(JSON.stringify(wrong))}::jsonb)`,{fail:true});
  });
  check('browser inserts fail and authenticated reads remain owner scoped',()=>{
    const d=issue();
    for(const r of ['anon','authenticated']) for(const t of ['RawSale','CleanSale','BuyerProfile','BuyerReport']) {
      role(r,`insert into public."${t}"(id) values(gen_random_uuid())`,{fail:true});
    }
    role('anon',`insert into public."SearchJob"(user_id,state,county,property_type) values(${literal(owner)},'NC','Wake','land')`,{fail:true});
    assert.equal(role('authenticated',`set local fixture.user_id=${literal(other)};select count(*) from public."SearchJob" where id=${literal(d.jobId)}`),'0');
    assert.equal(role('authenticated',`set local fixture.user_id=${literal(owner)};select count(*) from public."SearchJob" where id=${literal(d.jobId)}`),'1');
  });
  check('global profile updates preserve existing key and NULL mailing semantics',()=>{
    const execute=(row)=>{const d=issue();apply(d,'start');apply(d,'raw.append',{rows:[row]});apply(d,'clean.append',{rows:[row]});assert.equal(apply(d,'buyers.commit').ok,true);apply(d,'complete');};
    let profiles=count('BuyerProfile');execute(sale);assert.equal(count('BuyerProfile'),profiles);
    execute({...sale,mailing_address:null});execute({...sale,mailing_address:null});assert.equal(count('BuyerProfile'),profiles+2);
    assert.equal(sql(`select bool_and(is_llc and is_cash_buyer and purchase_count=1 and total_spend=120000) from public."BuyerProfile" where buyer_name=${literal(sale.buyer_name)}`),'t');
  });
  check('installer reapplication preserves existing records and permissions',()=>{
    const before=sql('select count(*) from buyer_writer.receipts');
    sql(installSql);
    assert.equal(sql('select count(*) from buyer_writer.receipts'),before);
    role('buyer_writer_runtime','select * from buyer_writer.sales',{fail:true});
  });
  check('installer rejects unexpected privileged functions and pre-existing role grants',()=>{
    const install=installSql;
    sql("create function buyer_writer.unexpected() returns integer language sql security definer as 'select 1';grant execute on function buyer_writer.unexpected() to anon;");
    sql(install,{fail:true});
    assert.equal(sql("select pg_get_userbyid(proowner) from pg_proc where oid='buyer_writer.unexpected()'::regprocedure"),'postgres');
    sql('drop function buyer_writer.unexpected()');
    sql('grant select(buyer_name) on public."BuyerProfile" to buyer_writer_runtime');sql(install,{fail:true});
    sql('revoke select(buyer_name) on public."BuyerProfile" from buyer_writer_runtime');
    sql("create function public.fixture_trigger() returns trigger language plpgsql security definer as 'begin return new;end';");
    sql(install,{fail:true});sql('drop function public.fixture_trigger()');
    sql("create function public.fixture_event() returns event_trigger language plpgsql security definer as 'begin return;end';");
    sql(install);role('buyer_writer_runtime','select public.fixture_event()',{fail:true});sql('drop function public.fixture_event()');
    sql('alter role buyer_writer_runtime login;alter role buyer_writer_issuer login;');
    sql(install);
    const login=run(['exec','-i',name,'psql','-X','-qAt','-U','buyer_writer_runtime','-d','writer_test','-v','ON_ERROR_STOP=1'], 'select session_user;');
    assert.equal(login.status,0);assert.equal(login.stdout.trim(),'buyer_writer_runtime');
    const denied=run(['exec','-i',name,'psql','-X','-qAt','-U','buyer_writer_runtime','-d','writer_test','-v','ON_ERROR_STOP=1'], 'set role buyer_writer_owner;');
    assert.notEqual(denied.status,0);
  });
  const asyncSql=(statement)=>new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
    let out='',err='';const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('isolated lock test timeout'));},10000);
    child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err+=chunk;});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',status=>{clearTimeout(timer);resolve({status,out,err});});child.stdin.end(statement);
  });
  const waitForSleeper=async(label)=>{
    for(let i=0;i<40;i++) {
      if(sql(`select exists(select from pg_stat_activity where application_name=${literal(label)} and wait_event='PgSleep')`)==='t')return;
      await new Promise(r=>setTimeout(r,25));
    }
    assert.fail('lock-holder barrier not observed');
  };
  {
    const d=issue();sql(`update buyer_writer.dispatches set expires_at=clock_timestamp()+interval '1 second' where id=${literal(d.dispatchId)}`);
    const lock=asyncSql(`set application_name='writer_expiry_lock';begin;select id from public."SearchJob" where id=${literal(d.jobId)} for update;select pg_sleep(2);commit;`);
    await waitForSleeper('writer_expiry_lock');
    const operation=await asyncSql(`set session authorization buyer_writer_runtime;select buyer_writer.apply(${literal(d.permitDigest)},${literal(workspace)},${literal(JSON.stringify(request(d,'start')))}::jsonb);`);
    assert.equal((await lock).status,0);assert.notEqual(operation.status,0);assert.match(operation.err,/42501/);
    assert.equal(sql(`select count(*) from buyer_writer.receipts where dispatch_id=${literal(d.dispatchId)}`),'0');
    checks.push('permit expiring while blocked on job lock is rejected after lock acquisition');
  }
  {
    const d=issue();apply(d,'start');
    const cancel=asyncSql(`set application_name='writer_cancel_lock';set session authorization buyer_writer_issuer;begin;select buyer_writer.cancel(${literal(d.jobId)},${literal(owner)},${literal(workspace)});select pg_sleep(2);commit;`);
    await waitForSleeper('writer_cancel_lock');
    const operation=await asyncSql(`set session authorization buyer_writer_runtime;select buyer_writer.apply(${literal(d.permitDigest)},${literal(workspace)},${literal(JSON.stringify(request(d,'raw.append',{rows:[sale]})))}::jsonb);`);
    assert.equal((await cancel).status,0);assert.notEqual(operation.status,0);assert.match(operation.err,/42501/);
    assert.equal(sql(`select count(*) from public."RawSale" where search_job_id=${literal(d.jobId)}`),'0');
    checks.push('cancellation acknowledgement fences a concurrent waiting write');
  }
  for(const change of ['expiry','owner','criteria','cancel']) {
    const d=issue();apply(d,'start');
    if(change==='expiry')sql(`update buyer_writer.dispatches set expires_at=clock_timestamp()+interval '1 second' where id=${literal(d.dispatchId)}`);
    const mutation={expiry:'',owner:`update public."SearchJob" set user_id=${literal(other)} where id=${literal(d.jobId)};`,criteria:`update public."SearchJob" set county='Different' where id=${literal(d.jobId)};`,cancel:`update buyer_writer.dispatches set state='cancelled' where id=${literal(d.dispatchId)};`}[change];
    const label=`writer_context_${change}`;
    const lock=asyncSql(`set application_name=${literal(label)};begin;select id from public."SearchJob" where id=${literal(d.jobId)} for update;${mutation}select pg_sleep(2);commit;`);
    await waitForSleeper(label);
    const result=await asyncSql(`set session authorization buyer_writer_runtime;select buyer_writer.context(${literal(d.permitDigest)},${literal(workspace)},${literal(d.jobId)},${literal(d.dispatchId)},${d.generation});`);
    assert.equal((await lock).status,0);assert.notEqual(result.status,0);assert.match(result.err,/42501/);
  }
  checks.push('context rechecks expiry ownership criteria and cancellation after waiting on the job lock');
  {
    // Actual local HTTP -> gateway -> dedicated PostgreSQL login. psql is a
    // test-only transport: PREPARE preserves the gateway's fixed SQL parameters;
    // no production database driver, credential, endpoint or pool is loaded.
    const workload=randomBytes(32).toString('base64url');
    const query=async(statement,parameters)=>{
      const write=statement==='select buyer_writer.apply($1,$2,$3::jsonb) as result';
      const context=statement==='select buyer_writer.context($1,$2,$3,$4,$5) as result';
      assert.ok(write||context||statement==='select buyer_writer.receipt($1,$2,$3,$4,$5,$6,$7) as result');
      const types=write?'text,text,jsonb':context?'text,text,uuid,uuid,bigint':'text,text,uuid,uuid,bigint,text,integer';
      const result=run(['exec','-i',name,'psql','-X','-qAt','-U','buyer_writer_runtime','-d','writer_test',
        '-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
      `set statement_timeout='10s';set lock_timeout='5s';prepare writer_http(${types}) as ${statement};execute writer_http(${parameters.map(literal).join(',')});`);
      if(result.status!==0) throw Object.assign(new Error('isolated writer database rejected'),{code:result.stderr.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1]});
      return{rows:[{result:JSON.parse(result.stdout.trim())}]};
    };
    const server=createBuyerWriterHttpServer({credential:workload,workspace,query,isAvailable:()=>true});
    try {
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
      });
      const d=issue();
      const endpoint=`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1/jobs/${d.jobId}/operations`;
      const send=async(operation,payload={},headers={},chunks={})=>{
        const {jobId,...body}=request(d,operation,payload,chunks);
        const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'content-type':'application/json',
          'x-buyer-writer-key':workload,'x-buyer-job-permit':d.permit,...headers},body:JSON.stringify(body)});
        return{status:response.status,body:await response.json()};
      };
      assert.equal((await send('start',{}, {'x-buyer-writer-key':'invalid'})).status,401);
      assert.equal((await send('start')).status,200);
      assert.equal((await send('start')).status,409);
      const contextResponse=await fetch(endpoint.replace(/operations$/,'context'),{method:'POST',redirect:'error',headers:{'content-type':'application/json','x-buyer-writer-key':workload,'x-buyer-job-permit':d.permit},body:JSON.stringify({version:1,dispatchId:d.dispatchId,generation:d.generation})});
      assert.equal(contextResponse.status,200);assert.deepEqual((await contextResponse.json()).sourceContext,sourceContext);

      const criteria={county:'Wake',state:'NC',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31'};
      const normalized=normalizeBuyerSales({...criteria,raw_sales:Array.from({length:201},(_,i)=>({...sale,buyer_name:'HTTP ISOLATED LLC',parcel_id:`HTTP-${i}`}))});
      const plan=planBuyerWrites({...d,criteria,...normalized});
      for(const item of plan)assert.equal((await send(item.operation,item.payload,{}, {chunkIndex:item.chunkIndex,chunkCount:item.chunkCount})).status,200);
      for(const table of ['RawSale','CleanSale'])assert.equal(sql(`select count(*) from public."${table}" where search_job_id=${literal(d.jobId)}`),'201');
      assert.equal(sql(`select count(*) from public."BuyerReport" where search_job_id=${literal(d.jobId)}`),'1');
      assert.equal(sql(`select status from public."SearchJob" where id=${literal(d.jobId)}`),'completed');
      assert.equal(sql(`select count(*) from public."BuyerProfile" where buyer_name='HTTP ISOLATED LLC'`),'1');
      checks.push('real loopback HTTP executes normalized multi-chunk plan through dedicated runtime and all five tables');
    } finally {
      server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    }
  }
  check('planner JSONB byte accounting and ISO calendar dates agree with actual PostgreSQL',()=>{
    const d=issue();const criteria={property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31'};
    assert.equal(sql(`select buyer_writer.eligible(${literal(JSON.stringify(sale))}::jsonb,${literal(JSON.stringify({...criteria,property_type:'ALL'}))}::jsonb)`),'t');
    const rows=Array.from({length:100},(_,i)=>({...sale,buyer_name:'漢'.repeat(512),seller_name:'漢'.repeat(512),
      mailing_address:'漢'.repeat(512),property_address:'漢'.repeat(512),deed_type:'漢'.repeat(512),
      lender_name:'漢'.repeat(512),parcel_id:String(i),sale_price:Number.MIN_VALUE}));
    for(const body of planBuyerWrites({...d,criteria,raw:rows,clean:rows})) {
      assert.ok(Number(sql(`select octet_length(${literal(JSON.stringify({jobId:d.jobId,...body}))}::jsonb::text)`))<=262144);
    }
    for(const stamp of ['2026-08-01T00:30:00+14:00','2026-08-31T23:30:00-05:00']) {
      const normalized=normalizeBuyerSales({...criteria,county:'Cumberland',state:'NC',source_type:'arcgis_cumberland',
        raw_sales:[{OWNER:'DATE TEST',PKG_SALE_DATE:stamp}]});
      assert.equal(normalized.raw[0].sale_date,sql(`select ${literal(stamp)}::date::text`));
    }
    const empty=issue();apply(empty,'start');
    for(const item of planBuyerWrites({...empty,criteria,raw:[],clean:[]}))apply(empty,item.operation,item.payload);
    assert.equal(sql(`select status from public."SearchJob" where id=${literal(empty.jobId)}`),'completed');
    assert.equal(sql(`select count(*) from public."BuyerReport" where search_job_id=${literal(empty.jobId)}`),'0');
  });
  console.log(JSON.stringify({postgres:'17.6',checksPassed:checks.length,checks,productionConnections:0,providerCalls:0,outreach:0}));
} finally {
  cleanup();
}
