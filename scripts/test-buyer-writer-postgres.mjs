import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseWriterOperation } from '../packages/buyer-writer/protocol.js';
import { createBuyerWriterHttpServer } from '../packages/buyer-writer/http.js';
import { planBuyerWrites } from '../packages/buyer-writer/plan.js';
import { normalizeBuyerSales } from '../packages/buyer-writer/normalize.js';
import { TEMPLATE1_IDENTITY_SQL, WRITER_IDENTITY_SQL } from '../packages/buyer-writer/postgres.js';
import { BUYER_WRITER_PRODUCTION_VERIFY_SQL,verifyBuyerWriterProductionEvidence } from '../packages/buyer-writer/production-verifier.js';
import { BUYER_WRITER_ENTRYPOINTS, BUYER_WRITER_ROUTINES } from '../packages/buyer-writer/routine-policy.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const name = `zola-writer-test-${randomUUID()}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership = randomUUID();
const dockerExecPacing=new Int32Array(new SharedArrayBuffer(4));
const run = (args, input) => {
  if(args[0]==='exec')Atomics.wait(dockerExecPacing,0,0,100);
  return spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
};
const sql = (statement, { fail = false, permissionDenied = false } = {}) => {
  const r = run(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'], statement);
  if (fail) { assert.notEqual(r.status, 0, 'expected database denial'); assert.match(r.stderr ?? '', permissionDenied ? /ERROR:  permission denied/ : /ERROR:/, 'denial must be the expected PostgreSQL error'); return; }
  assert.equal(r.status, 0, `isolated SQL failed${r.error?`: ${r.error.message}`:''}${r.signal?` (${r.signal})`:''}: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
  return r.stdout.trim();
};
const adminSql = statement => {
  const r = run(['exec','-i',name,'psql','-X','-qAt','-U','fixture_admin','-d','writer_test','-v','ON_ERROR_STOP=1'], statement);
  assert.equal(r.status,0,`isolated admin SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0,600)}`);
  return r.stdout.trim();
};
const adminTemplateSql = statement => {
  const r = run(['exec','-i',name,'psql','-X','-qAt','-U','fixture_admin','-d','template1','-v','ON_ERROR_STOP=1'], statement);
  assert.equal(r.status,0,`isolated template admin SQL failed: ${(r.stderr??'').replace(/DETAIL:[\s\S]*/,'').slice(0,600)}`);
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
const migrations = [
  ['20260904201014_nexus_read_security.sql','1be43afc6d6964752301f0c80806423dc6b82d054b09748813cf40dca7944e51'],
  ['20260904223151_buyer_browser_security.sql','61baa67314a77d4fa0f0b587821de9216dfa0220d1bb9e22b2808bc2002ae01e'],
].map(([file,sha256])=>{
  const source=readFileSync(new URL('../frontend/supabase/migrations/'+file,import.meta.url),'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),sha256,'reviewed migration drift');
  return source;
}).join('\n');
const buyerTables=['SearchJob','RawSale','CleanSale','BuyerProfile','BuyerReport'];
const snapshot=(ledger=false)=>sql(`select jsonb_build_object(${[
  ...[...buyerTables,'nexus_contacts'].map(t=>`${literal(t)},(select coalesce(jsonb_agg(to_jsonb(x) order by id),'[]') from public."${t}" x)`),
  ...(ledger?['dispatches','receipts','sales'].map(t=>`${literal(t)},(select coalesce(jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text),'[]') from buyer_writer.${t} x)`):[]),
].join(',')})`);
const checks = [];
const check = (name, fn) => { fn(); checks.push(name); };
const capture = jobId => JSON.parse(sql(`select jsonb_build_object('criteria',buyer_writer.criteria(to_jsonb(j)),'updatedAt',j.updated_at) from public."SearchJob" j where id=${literal(jobId)}`));
const expected = snapshot => `${literal(JSON.stringify(snapshot.criteria))}::jsonb,${snapshot.updatedAt===null?'null':literal(snapshot.updatedAt)}::timestamptz`;
const issueStatement=(jobId,snapshot,context=sourceContext,requestId=randomUUID())=>`select buyer_writer.issue(${literal(jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${literal(JSON.stringify(context))}::jsonb,${expected(snapshot)},${literal(requestId)})`;
const issue = (options = {}) => {
  const jobId = randomUUID();
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type,date_range_start,date_range_end) values(${literal(jobId)},${literal(owner)},'NC','Wake','land','2026-01-01','2026-12-31')`);
  const permit = randomBytes(32).toString('base64url');
  const permitDigest = createHash('sha256').update(permit).digest('hex');
  const dispatch = JSON.parse(role('buyer_writer_issuer', `select buyer_writer.issue(${literal(jobId)},${literal(owner)},${literal(workspace)},${literal(permitDigest)},${literal(JSON.stringify(options.sourceContext??sourceContext))}::jsonb,${expected(capture(jobId))},${literal(randomUUID())})`));
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
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=writer_test',image]);
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
    if (run(['exec',name,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U fixture_admin -d writer_test']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  adminSql(`create role fixture_oid_padding_1;create role fixture_oid_padding_2;
    create role fixture_oid_padding_3;
    create role postgres superuser createdb createrole replication bypassrls login;
    alter database writer_test owner to postgres;`);
  adminSql('create database writer_other');
  sql('revoke connect on database postgres,writer_other from public');
  assert.match(sql('show server_version'),/^17\.6/);
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../tests/fixtures/buyer-writer/nexus.sql',import.meta.url),'utf8'));
  sql(`insert into public."SearchJob"(id,user_id,state,county,property_type) values ('00000000-0000-4000-8000-000000000010',${literal(owner)},'NC','Wake','land');
    insert into public."RawSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVATION');
    insert into public."CleanSale"(search_job_id,buyer_name) values ('00000000-0000-4000-8000-000000000010','PRESERVATION');
    insert into public."BuyerProfile"(id,buyer_name) values ('00000000-0000-4000-8000-000000000011','PRESERVATION');
    insert into public."BuyerReport"(search_job_id,buyer_profile_id) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000011');`);
  check('exact Buyer and Nexus migrations preserve all six tables and roll back atomically on failure',()=>{
    const before=snapshot();
    const acl=()=>sql(`select jsonb_agg(jsonb_build_object('name',relname,'acl',relacl,'policies',
      (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where p.schemaname='public' and p.tablename=c.relname)) order by relname)
      from pg_class c where relnamespace='public'::regnamespace and relname in (${[...buyerTables,'nexus_contacts'].map(literal).join(',')})`);
    const beforeAcl=acl();
    const failed=run(['exec','-i',name,'psql','-X','-qAt','-U','postgres','-d','writer_test','-v','ON_ERROR_STOP=1'],
      'begin;'+migrations+"\ndo $$begin raise exception 'EXPECTED_COMBINED_ABORT';end$$;commit;");
    assert.notEqual(failed.status,0);assert.match(failed.stderr,/ERROR:  EXPECTED_COMBINED_ABORT/);
    assert.equal(snapshot(),before);assert.equal(acl(),beforeAcl);
    sql('begin;'+migrations+'commit;');assert.equal(snapshot(),before);
  });
  const trustedCreatorOid=adminSql("select oid from pg_roles where rolname='postgres'");
  assert.equal(trustedCreatorOid,'16388','fixture must represent the live managed postgres creator OID');
  const installSql=`set blackspire.buyer_writer_creator_oid=${literal(trustedCreatorOid)};`+readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
  const admissionSql=readFileSync(new URL('../packages/buyer-writer/sql/admission.sql',import.meta.url),'utf8');
  adminSql('alter role postgres nosuperuser createrole;');
  adminSql('grant temporary on database template1 to public');sql(installSql,{fail:true});
  assert.equal(adminSql("select count(*) from pg_roles where rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')"),'0');
  adminSql('revoke temporary on database template1 from public');
  sql(installSql);
  check('Supabase-shaped non-superuser database-owner creator accepts only pinned role grants and inert template1 CONNECT',()=>{
    assert.equal(sql("select rolsuper||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls from pg_roles where oid=16388"),'false,true,true,true,true');
    assert.equal(sql("select datistemplate and datdba=10 and has_database_privilege('buyer_writer_runtime',oid,'CONNECT') and not has_database_privilege('buyer_writer_runtime',oid,'CREATE') and not has_database_privilege('buyer_writer_runtime',oid,'TEMP') from pg_database where datname='template1'"),'t');
    assert.equal(sql(`select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid
      where r.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer')`),'4');
    assert.equal(sql(`select count(*) from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member
      where r.rolname in('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer') and u.rolname='postgres'
       and u.oid=(select datdba from pg_database where datname=current_database()) and not m.inherit_option
       and ((m.grantor=10 and m.admin_option and not m.set_option) or
       (r.rolname='buyer_writer_owner' and pg_get_userbyid(m.grantor)='postgres' and not m.admin_option and m.set_option))`),'4');
  });
  sql(installSql);checks.push('non-superuser creator reapplies owner DDL through the pinned SET edge');
  adminSql('alter role postgres superuser;');
  check('dedicated roles cannot select tables, issue arbitrary permits or assume the owner role',()=>{
    for(const r of ['anon','authenticated','buyer_writer_runtime','buyer_writer_issuer']) {
      for(const t of ['RawSale','CleanSale','BuyerProfile','BuyerReport']) role(r,`select * from public."${t}"`,{fail:true});
    }
    role('buyer_writer_runtime','set role buyer_writer_owner',{fail:true});
    role('buyer_writer_runtime','select * from buyer_writer.dispatches',{fail:true});
    role('buyer_writer_runtime',`select buyer_writer.issue(null,null,null,null,null,null,null)`,{fail:true});
  });
  check('issuance rejects changed or malformed captured criteria/revision without changing job or dispatches',()=>{
    const d=issue();const snapshot=capture(d.jobId);
    const state=()=>sql(`select jsonb_build_object('job',to_jsonb(j),'dispatches',(select jsonb_agg(to_jsonb(x) order by generation) from buyer_writer.dispatches x where x.job_id=j.id)) from public."SearchJob" j where id=${literal(d.jobId)}`);
    const before=state();
    for(const criteria of [null,{},[],{...snapshot.criteria,extra:true},{...snapshot.criteria,county:'Changed'}]) {
      role('buyer_writer_issuer',issueStatement(d.jobId,{...snapshot,criteria}),{fail:true});assert.equal(state(),before);
    }
    role('buyer_writer_issuer',issueStatement(d.jobId,{...snapshot,updatedAt:null}),{fail:true});assert.equal(state(),before);
    sql(`update public."SearchJob" set county='Changed' where id=${literal(d.jobId)}`);const changed=state();
    role('buyer_writer_issuer',issueStatement(d.jobId,snapshot),{fail:true});assert.equal(state(),changed);
    sql(`update public."SearchJob" set min_purchases=6 where id=${literal(d.jobId)}`);const unsupported=state();
    role('buyer_writer_issuer',issueStatement(d.jobId,capture(d.jobId)),{fail:true});assert.equal(state(),unsupported);
  });
  check('competing issuance and cancellation before any dispatch fence stale acquisitions',()=>{
    const d=issue();const captured=capture(d.jobId);
    const next=JSON.parse(role('buyer_writer_issuer',issueStatement(d.jobId,captured)));
    assert.equal(next.generation,d.generation+1);
    role('buyer_writer_issuer',issueStatement(d.jobId,captured),{fail:true});
    assert.equal(sql(`select count(*) from buyer_writer.dispatches where job_id=${literal(d.jobId)}`),'2');
    const fresh=issue();sql(`delete from buyer_writer.dispatches where job_id=${literal(fresh.jobId)}`);
    const beforeCancel=capture(fresh.jobId);role('buyer_writer_issuer',`select buyer_writer.cancel(${literal(fresh.jobId)},${literal(owner)},${literal(workspace)})`);
    role('buyer_writer_issuer',issueStatement(fresh.jobId,beforeCancel),{fail:true});
    assert.equal(sql(`select count(*) from buyer_writer.dispatches where job_id=${literal(fresh.jobId)}`),'0');
  });
  check('NULL revision/criteria fields are preserved and future timestamps advance monotonically at microsecond precision',()=>{
    const d=issue();sql(`update public."SearchJob" set updated_at=null,min_purchases=null,cash_buyers_only=null,llc_buyers_only=null where id=${literal(d.jobId)}`);
    const empty=capture(d.jobId);assert.equal(empty.updatedAt,null);assert.equal(empty.criteria.min_purchases,null);
    role('buyer_writer_issuer',issueStatement(d.jobId,empty));assert.notEqual(capture(d.jobId).updatedAt,null);
    sql(`update public."SearchJob" set updated_at='2050-01-01T00:00:00.123456Z' where id=${literal(d.jobId)}`);
    const future=capture(d.jobId);const next=JSON.parse(role('buyer_writer_issuer',issueStatement(d.jobId,future)));
    assert.equal(sql(`select updated_at='2050-01-01T00:00:00.123457Z'::timestamptz from public."SearchJob" where id=${literal(d.jobId)}`),'t');
    role('buyer_writer_issuer',`select buyer_writer.cancel(${literal(d.jobId)},${literal(owner)},${literal(workspace)})`);
    assert.equal(sql(`select updated_at='2050-01-01T00:00:00.123458Z'::timestamptz from public."SearchJob" where id=${literal(d.jobId)}`),'t');
    assert.equal(sql(`select state from buyer_writer.dispatches where id=${literal(next.dispatchId)}`),'cancelled');
    sql(`update public."SearchJob" set updated_at='infinity' where id=${literal(d.jobId)}`);
    role('buyer_writer_issuer',issueStatement(d.jobId,capture(d.jobId)),{fail:true});
    role('buyer_writer_issuer',`select buyer_writer.cancel(${literal(d.jobId)},${literal(owner)},${literal(workspace)})`,{fail:true});
    const running=issue();sql(`update public."SearchJob" set updated_at='2050-01-01T00:00:00.123456Z' where id=${literal(running.jobId)}`);
    apply(running,'start');apply(running,'fail',{code:'SOURCE_FAILED'});
    assert.equal(sql(`select updated_at='2050-01-01T00:00:00.123458Z'::timestamptz from public."SearchJob" where id=${literal(running.jobId)}`),'t');
  });
  check('attempt reconciliation fences absent issuance and never cancels a successor',()=>{
    const d=issue();const snapshot=capture(d.jobId),attempt=randomUUID();
    const reconcile=(id,revision,job=d.jobId,who=owner,space=workspace,fail=false)=>role('buyer_writer_issuer',
      `select buyer_writer.reconcile(${literal(job)},${literal(who)},${literal(space)},${literal(id)},${revision===null?'null':literal(revision)}::timestamptz)`,{fail});
    assert.equal(JSON.parse(reconcile(attempt,snapshot.updatedAt)).state,'absent');
    role('buyer_writer_issuer',issueStatement(d.jobId,snapshot,sourceContext,attempt),{fail:true});
    const original=capture(d.jobId);const issued=JSON.parse(role('buyer_writer_issuer',issueStatement(d.jobId,original,sourceContext,attempt)));
    assert.equal(issued.dispatchId,attempt);
    const successor=JSON.parse(role('buyer_writer_issuer',issueStatement(d.jobId,capture(d.jobId))));
    const state=()=>sql(`select row_to_json(j) from public."SearchJob" j where id=${literal(d.jobId)}`);
    const before=state();assert.equal(JSON.parse(reconcile(attempt,original.updatedAt)).state,'cancelled');assert.equal(state(),before);
    assert.equal(sql(`select state from buyer_writer.dispatches where id=${literal(successor.dispatchId)}`),'pending');
    reconcile(attempt,original.updatedAt,d.jobId,other,workspace,true);reconcile(attempt,original.updatedAt,d.jobId,owner,'wrong',true);
    const another=issue();reconcile(attempt,original.updatedAt,another.jobId,owner,workspace,true);
    role('buyer_writer_issuer',issueStatement(d.jobId,capture(d.jobId),sourceContext,attempt),{fail:true});assert.equal(state(),before);
    assert.equal(JSON.parse(reconcile(successor.dispatchId,original.updatedAt)).state,'cancelled');
    const cancelled=state();reconcile(successor.dispatchId,original.updatedAt);assert.equal(state(),cancelled);
    const absent=randomUUID();reconcile(absent,original.updatedAt);assert.equal(state(),cancelled);
    sql(`update public."SearchJob" set updated_at=null where id=${literal(d.jobId)}`);
    reconcile(absent,null);assert.notEqual(capture(d.jobId).updatedAt,null);
    role('buyer_writer_runtime',`select buyer_writer.reconcile(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(absent)},null)`,{fail:true});
  });
  check('reconciliation preserves terminal receipts and completed or failed job state',()=>{
    for(const terminal of ['completed','failed']) {
      const d=issue({sourceContext:{...sourceContext,mode:'frontend_payload',rawPayload:{digest:'e'.repeat(64),rowCount:0,byteCount:2}}});
      apply(d,'start');if(terminal==='completed'){apply(d,'buyers.commit');apply(d,'complete');}else apply(d,'fail',{code:'INVALID_SOURCE_DATA'});
      const state=()=>sql(`select row_to_json(j) from public."SearchJob" j where id=${literal(d.jobId)}`);
      const before=state();const receipts=sql(`select jsonb_agg(to_jsonb(r)) from buyer_writer.receipts r where dispatch_id=${literal(d.dispatchId)}`);
      const result=JSON.parse(role('buyer_writer_issuer',`select buyer_writer.reconcile(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(d.dispatchId)},null)`));
      assert.equal(result.state,terminal);assert.equal(state(),before);
      assert.equal(sql(`select jsonb_agg(to_jsonb(r)) from buyer_writer.receipts r where dispatch_id=${literal(d.dispatchId)}`),receipts);
    }
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
      role('buyer_writer_issuer',`select buyer_writer.issue(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${literal(JSON.stringify(context))}::jsonb,${expected(capture(d.jobId))},${literal(randomUUID())})`,{fail:true});
    }
    assert.equal(JSON.stringify(JSON.parse(get())),before,'rejected issuance must not cancel current dispatch');
    sql(`update buyer_writer.dispatches set source_context=null where id=${literal(d.dispatchId)}`);
    get(d,true);apply(d,'raw.append',{rows:[sale]}, {},true);
    const cash=issue();const bound={...sourceContext,sources:[{...sourceContext.sources[0],cashDisabled:true}]};
    const issued=JSON.parse(role('buyer_writer_issuer',`select buyer_writer.issue(${literal(cash.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${literal(JSON.stringify(bound))}::jsonb,${expected(capture(cash.jobId))},${literal(randomUUID())})`));
    assert.equal(sql(`select no_cash_data from buyer_writer.dispatches where id=${literal(issued.dispatchId)}`),'t');
  });
  check('upgrade removes legacy boolean issuer and preserves but rejects context-free dispatch history',()=>{
    const d=issue();sql(`update buyer_writer.dispatches set source_context=null,source_context_digest=null where id=${literal(d.dispatchId)}`);
    // Recreate the old signature/ownership/grants, not a production schema clone.
    sql(`set role buyer_writer_owner;create function buyer_writer.issue(uuid,uuid,text,text,boolean) returns jsonb language sql security definer set search_path=pg_catalog as 'select null::jsonb';revoke all on function buyer_writer.issue(uuid,uuid,text,text,boolean) from public;grant execute on function buyer_writer.issue(uuid,uuid,text,text,boolean) to buyer_writer_issuer;`);
    sql(`set role buyer_writer_owner;create function buyer_writer.issue(uuid,uuid,text,text,jsonb) returns jsonb language sql security definer set search_path=pg_catalog as 'select null::jsonb';revoke all on function buyer_writer.issue(uuid,uuid,text,text,jsonb) from public;grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb) to buyer_writer_issuer;`);
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,boolean)') is not null"),'t');
    sql(`set role buyer_writer_owner;create function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamptz) returns jsonb language sql security definer set search_path=pg_catalog as 'select null::jsonb';revoke all on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamptz) from public;grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamptz) to buyer_writer_issuer;`);
    sql(installSql,{fail:true});
    sql(`set role buyer_writer_owner;revoke execute on function buyer_writer.issue(uuid,uuid,text,text,boolean) from buyer_writer_issuer;revoke execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb) from buyer_writer_issuer;revoke execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamptz) from buyer_writer_issuer;`);
    sql(installSql);
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamptz)') is null"),'t');
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,boolean)') is null"),'t');
    assert.equal(sql("select to_regprocedure('buyer_writer.issue(uuid,uuid,text,text,jsonb)') is null"),'t');
    assert.equal(sql(`select count(*) from buyer_writer.dispatches where id=${literal(d.dispatchId)} and source_context is null`),'1');
    apply(d,'start',{}, {},true);
  });
  check('scoped writes commit all five tables with receipts and no catalog response',()=>{
    const before=Object.fromEntries(['RawSale','CleanSale','BuyerProfile','BuyerReport'].map(t=>[t,count(t)]));
    const d=issue();
    assert.equal(apply(d,'start').ok,true);
    assert.equal(apply(d,'raw.append',{rows:[sale]}).ok,true);
    assert.equal(apply(d,'clean.append',{rows:[sale]}).ok,true);
    assert.equal(apply(d,'buyers.commit').ok,true);
    const result=apply(d,'complete'); assert.equal(result.ok,true);
    for(const [table,rows] of Object.entries(before))assert.equal(count(table),rows+1);
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
    const g=issue();role('buyer_writer_issuer',`select buyer_writer.issue(${literal(g.jobId)},${literal(owner)},${literal(workspace)},${literal('a'.repeat(64))},${contextLiteral},${expected(capture(g.jobId))},${literal(randomUUID())})`);
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
    role('buyer_writer_issuer',`select buyer_writer.issue(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(randomBytes(32).toString('hex'))},${contextLiteral},${expected(capture(d.jobId))},${literal(randomUUID())})`);
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
  check('both reviewed migrations reapply after scoped writes without changing rows, ledger or writer authority',()=>{
    const before=snapshot(true);
    const permissions=()=>sql(`select jsonb_agg(to_jsonb(x) order by to_jsonb(x)::text) from (
      select table_name,column_name,grantee,privilege_type,is_grantable from information_schema.column_privileges where grantee like 'buyer_writer_%'
      union all select routine_name,null,grantee,privilege_type,is_grantable from information_schema.routine_privileges where grantee like 'buyer_writer_%') x`);
    const grants=permissions();sql('begin;'+migrations+'commit;');assert.equal(snapshot(true),before);assert.equal(permissions(),grants);
    for(const r of ['anon','authenticated'])for(const t of ['RawSale','CleanSale','BuyerProfile','BuyerReport','nexus_contacts']){
      assert.equal(sql(`select has_table_privilege(${literal(r)},${literal('public."'+t+'"')},'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')`),'f');
      assert.equal(sql(`select has_any_column_privilege(${literal(r)},${literal('public."'+t+'"')},'SELECT,INSERT,UPDATE,REFERENCES')`),'f');
      for(const statement of [`select * from public."${t}"`,`insert into public."${t}"(id) values(gen_random_uuid())`,
        `update public."${t}" set id=id where false`,`delete from public."${t}" where false`])role(r,statement,{fail:true,permissionDenied:true});
    }
    for(const r of ['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'])role(r,'select * from public.nexus_contacts',{fail:true,permissionDenied:true});
    assert.equal(role('service_role','select count(*) from public.nexus_contacts'),'2');
    const d=issue();apply(d,'start');apply(d,'raw.append',{rows:[sale]});apply(d,'clean.append',{rows:[sale]});apply(d,'buyers.commit');apply(d,'complete');
    assert.equal(sql(`select status from public."SearchJob" where id=${literal(d.jobId)}`),'completed');
    for(const t of ['RawSale','CleanSale','BuyerReport'])assert.equal(sql(`select count(*) from public."${t}" where search_job_id=${literal(d.jobId)}`),'1');
    const otherJob=randomUUID();sql(`insert into public."SearchJob"(id,user_id,state,county,property_type) values(${literal(otherJob)},${literal(other)},'NC','Wake','land')`);
    for(const who of [owner,other])for(const [id,jobOwner] of [[d.jobId,owner],[otherJob,other]])
      assert.equal(role('authenticated',`set local fixture.user_id=${literal(who)};select count(*) from public."SearchJob" where id=${literal(id)}`),who===jobOwner?'1':'0');
    role('anon','select * from public."SearchJob"',{fail:true});
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
    for(const [grant,revoke] of [
      ['grant create on schema public to buyer_writer_runtime','revoke create on schema public from buyer_writer_runtime'],
      ['grant create on database writer_test to buyer_writer_runtime','revoke create on database writer_test from buyer_writer_runtime'],
      ['grant maintain on public."RawSale" to buyer_writer_runtime','revoke maintain on public."RawSale" from buyer_writer_runtime'],
      ['grant usage on sequence buyer_writer.sales_ordinal_seq to buyer_writer_runtime','revoke usage on sequence buyer_writer.sales_ordinal_seq from buyer_writer_runtime'],
      ['grant select on public."RawSale" to buyer_writer_owner','revoke select on public."RawSale" from buyer_writer_owner'],
      ['grant select(error_message) on public."SearchJob" to buyer_writer_owner','revoke select(error_message) on public."SearchJob" from buyer_writer_owner'],
      ['grant execute on function buyer_writer.valid_sale(jsonb) to buyer_writer_runtime','revoke execute on function buyer_writer.valid_sale(jsonb) from buyer_writer_runtime'],
    ]){sql(grant);sql(install,{fail:true});sql(revoke);}
    sql('grant connect on database writer_other to public');sql(install,{fail:true});sql('revoke connect on database writer_other from public');
    sql(`create function public.fixture_hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
      create trigger fixture_hidden_trigger before insert on public."RawSale" for each row execute function public.fixture_hidden_trigger();
      revoke execute on function public.fixture_hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;`);
    sql(install,{fail:true});
    sql('drop trigger fixture_hidden_trigger on public."RawSale";drop function public.fixture_hidden_trigger()');
    sql('create sequence public.fixture_writer_sequence;grant usage on sequence public.fixture_writer_sequence to buyer_writer_owner');
    sql(install,{fail:true});sql('drop sequence public.fixture_writer_sequence');
    sql("create function public.fixture_invoker() returns integer language sql as 'select 1';grant usage on schema public to buyer_writer_runtime;");
    sql(install,{fail:true});sql('revoke usage on schema public from buyer_writer_runtime;drop function public.fixture_invoker()');
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
  check('pool identity query accepts actual separate logins and rejects privilege or routine drift',()=>{
    const creatorOid=trustedCreatorOid;
    const functions=BUYER_WRITER_ENTRYPOINTS;
    const identity=(kind='runtime',substitute=false)=>{
      const user=`buyer_writer_${kind}`;
      const statement=`${substitute?`set role ${user};`:''}set statement_timeout='10s';set lock_timeout='5s';set search_path=pg_catalog;
        prepare zola_identity(text,text[],jsonb,oid) as ${WRITER_IDENTITY_SQL};execute zola_identity(${literal(user)},array[${functions[kind].map(literal).join(',')}],${literal(JSON.stringify(BUYER_WRITER_ROUTINES))}::jsonb,${creatorOid}::oid);`;
      const result=run(['exec','-i',name,'psql','-X','-qAt','-U',substitute?'postgres':user,'-d','writer_test','-v','ON_ERROR_STOP=1'],statement);
      assert.equal(result.status,0,`isolated identity query must execute: ${(result.stderr??'').slice(0,600)}`);return result.stdout.trim();
    };
    const productionEvidence=()=>JSON.parse(sql(`prepare zola_production(oid,jsonb) as ${BUYER_WRITER_PRODUCTION_VERIFY_SQL};
      execute zola_production(${creatorOid}::oid,${literal(JSON.stringify(BUYER_WRITER_ROUTINES))}::jsonb);`));
    const templateIdentity=(kind='runtime')=>{
      const user=`buyer_writer_${kind}`;
      const result=run(['exec','-i',name,'psql','-X','-qAt','-U',user,'-d','template1','-v','ON_ERROR_STOP=1'],
        `prepare zola_template(text) as ${TEMPLATE1_IDENTITY_SQL};execute zola_template(${literal(user)});`);
      assert.equal(result.status,0,`template identity query must execute: ${(result.stderr??'').slice(0,600)}`);
      return result.stdout.trim();
    };
    const bindCurrentRelations=()=>sql(`set role buyer_writer_owner;
      do $$declare metadata jsonb;begin
       select jsonb_build_object('creatorOid',${creatorOid}::text,'relations',jsonb_agg(jsonb_build_object(
        'schema',reviewed.schema_name,'name',reviewed.relation_name,'oid',c.oid::text,'relkind',c.relkind,
        'relowner',c.relowner::text,'relispartition',c.relispartition,'relpersistence',c.relpersistence,
        'relrowsecurity',c.relrowsecurity,'relforcerowsecurity',c.relforcerowsecurity,
        'parentOids',coalesce((select jsonb_agg(i.inhparent::text order by i.inhparent) from pg_inherits i where i.inhrelid=c.oid),'[]'::jsonb)
       ) order by reviewed.schema_name,reviewed.relation_name)) into metadata
       from (values('public','SearchJob'),('public','RawSale'),('public','CleanSale'),('public','BuyerProfile'),('public','BuyerReport'),
        ('buyer_writer','dispatches'),('buyer_writer','receipts'),('buyer_writer','sales')) reviewed(schema_name,relation_name)
       join pg_namespace n on n.nspname=reviewed.schema_name join pg_class c on c.relnamespace=n.oid and c.relname=reviewed.relation_name;
       execute format('comment on schema buyer_writer is %L','blackspire-buyer-writer:v2:'||metadata::text);
      end$$;reset role;`);
    assert.equal(identity(),'t');assert.equal(identity('issuer'),'t');assert.equal(identity('runtime',true),'f');
    assert.equal(templateIdentity(),'t');assert.equal(templateIdentity('issuer'),'t');
    adminTemplateSql('create table public.fixture_exposed(value integer);grant select on public.fixture_exposed to public');
    assert.equal(templateIdentity(),'f');adminTemplateSql('drop table public.fixture_exposed');
    adminTemplateSql('create table public.fixture_column_exposed(value integer);grant select(value) on public.fixture_column_exposed to public');
    assert.equal(templateIdentity(),'f');adminTemplateSql('drop table public.fixture_column_exposed');
    adminTemplateSql(`create role fixture_template_reader nologin;create table public.fixture_inherited_column(value integer);
      grant select(value) on public.fixture_inherited_column to fixture_template_reader;
      alter role buyer_writer_runtime inherit;grant fixture_template_reader to buyer_writer_runtime`);
    assert.equal(templateIdentity(),'f');
    adminTemplateSql(`revoke fixture_template_reader from buyer_writer_runtime;alter role buyer_writer_runtime noinherit;
      drop table public.fixture_inherited_column;drop role fixture_template_reader`);
    adminTemplateSql("create function public.fixture_escalate() returns integer language sql security definer as 'select 1'");
    assert.equal(templateIdentity(),'f');adminTemplateSql('drop function public.fixture_escalate()');
    adminTemplateSql('create schema fixture_reachable;grant usage on schema fixture_reachable to public');
    assert.equal(templateIdentity(),'f');adminTemplateSql('drop schema fixture_reachable');
    adminTemplateSql('create schema fixture_creatable;grant create on schema fixture_creatable to public');
    assert.equal(templateIdentity(),'f');adminTemplateSql('drop schema fixture_creatable');
    adminTemplateSql('grant create on schema pg_catalog to public');assert.equal(templateIdentity(),'f');
    adminTemplateSql('revoke create on schema pg_catalog from public');assert.equal(templateIdentity(),'t');
    adminTemplateSql('grant create on schema public to public');assert.equal(templateIdentity(),'f');
    adminTemplateSql('revoke create on schema public from public');assert.equal(templateIdentity(),'t');
    const baselineEvidence=productionEvidence();
    assert.equal(baselineEvidence.creatorOid,String(creatorOid));assert.equal(baselineEvidence.relationPolicySafe,true);
    assert.equal(baselineEvidence.routinePolicySafe,true);assert.equal(baselineEvidence.ownerPolicySafe,true);
    assert.deepEqual(baselineEvidence.crossDatabaseConnect,[]);
    assert.equal(verifyBuyerWriterProductionEvidence(baselineEvidence,Number(creatorOid)).compliant,true);
    const denied=(grant,revoke)=>{sql(grant);assert.equal(identity(),'f');sql(revoke);assert.equal(identity(),'t');};
    denied('grant create on schema buyer_writer to buyer_writer_runtime','revoke create on schema buyer_writer from buyer_writer_runtime');
    denied('grant create on database writer_test to buyer_writer_runtime','revoke create on database writer_test from buyer_writer_runtime');
    denied('grant connect on database writer_other to public','revoke connect on database writer_other from public');
    denied('grant temporary on database template1 to public','revoke temporary on database template1 from public');
    denied('grant create on database template1 to public','revoke create on database template1 from public');
    adminSql('alter database template1 is_template false');assert.equal(identity(),'f');sql(installSql,{fail:true});
    adminSql('alter database template1 is_template true');assert.equal(identity(),'t');
    adminSql('alter database template1 owner to postgres');assert.equal(identity(),'f');sql(installSql,{fail:true});
    adminSql('alter database template1 owner to fixture_admin');assert.equal(identity(),'t');
    sql('create role inherited_cross_database nologin;grant connect on database writer_other to inherited_cross_database');
    denied('alter role buyer_writer_runtime inherit;grant inherited_cross_database to buyer_writer_runtime','revoke inherited_cross_database from buyer_writer_runtime;alter role buyer_writer_runtime noinherit');
    sql('revoke connect on database writer_other from inherited_cross_database;drop role inherited_cross_database');
    denied('grant maintain on public."RawSale" to buyer_writer_runtime','revoke maintain on public."RawSale" from buyer_writer_runtime');
    denied('grant select(user_id) on public."SearchJob" to buyer_writer_runtime','revoke select(user_id) on public."SearchJob" from buyer_writer_runtime');
    sql('grant select(error_message) on public."SearchJob" to buyer_writer_owner');assert.equal(identity(),'f');
    assert.equal(productionEvidence().ownerPolicySafe,false);sql('revoke select(error_message) on public."SearchJob" from buyer_writer_owner');assert.equal(identity(),'t');
    denied('grant create on schema public to buyer_writer_owner','revoke create on schema public from buyer_writer_owner');
    denied('grant create on database writer_test to buyer_writer_owner','revoke create on database writer_test from buyer_writer_owner');
    denied('grant usage on sequence buyer_writer.sales_ordinal_seq to buyer_writer_runtime','revoke usage on sequence buyer_writer.sales_ordinal_seq from buyer_writer_runtime');
    denied('grant execute on function buyer_writer.cancel(uuid,uuid,text) to buyer_writer_runtime','revoke execute on function buyer_writer.cancel(uuid,uuid,text) from buyer_writer_runtime');
    denied('alter role buyer_writer_runtime inherit','alter role buyer_writer_runtime noinherit');
    denied('alter role buyer_writer_owner login','alter role buyer_writer_owner nologin');
    sql('create role isolated_membership nologin');
    denied('grant isolated_membership to buyer_writer_runtime','revoke isolated_membership from buyer_writer_runtime');
    denied('grant buyer_writer_runtime to isolated_membership','revoke buyer_writer_runtime from isolated_membership');
    sql('drop role isolated_membership');
    denied('alter function buyer_writer.context(text,text,uuid,uuid,bigint) security invoker','alter function buyer_writer.context(text,text,uuid,uuid,bigint) security definer');
    denied('alter function buyer_writer.context(text,text,uuid,uuid,bigint) set search_path=public','alter function buyer_writer.context(text,text,uuid,uuid,bigint) set search_path=pg_catalog');
    sql('create schema hidden_sequence_fixture;revoke all on schema hidden_sequence_fixture from public;create sequence hidden_sequence_fixture.ids;grant usage on sequence hidden_sequence_fixture.ids to public');
    assert.equal(sql("select has_schema_privilege('buyer_writer_runtime','hidden_sequence_fixture','USAGE')"),'f');
    const hiddenSequenceOid=sql("select 'hidden_sequence_fixture.ids'::regclass::oid");
    assert.equal(role('buyer_writer_runtime',`select nextval(${hiddenSequenceOid}::oid::regclass)`),'1');
    assert.equal(identity(),'f','OID-addressable sequence capability must fail without schema USAGE');
    assert.deepEqual(productionEvidence().directSequences.map(({role,usage})=>({role,usage})),[
      {role:'buyer_writer_issuer',usage:true},{role:'buyer_writer_runtime',usage:true}
    ]);
    sql(installSql,{fail:true});sql('revoke usage on sequence hidden_sequence_fixture.ids from public;drop schema hidden_sequence_fixture cascade');assert.equal(identity(),'t');
    sql('revoke usage on schema public from public;grant select on public."SearchJob" to public');
    assert.equal(identity(),'f','target PUBLIC table ACL must fail without schema USAGE');sql(installSql,{fail:true});
    assert.ok(productionEvidence().targetPublicRelations.some(row=>row.name==='SearchJob'&&row.privilege==='SELECT'));
    sql('revoke select on public."SearchJob" from public;grant usage on schema public to public');assert.equal(identity(),'t');
    sql('create table public."SearchJob_plain_child"() inherits (public."SearchJob")');
    assert.equal(identity(),'f','a trigger-free descendant must change protected relation identity');assert.equal(productionEvidence().relationPolicySafe,false);sql(installSql,{fail:true});
    sql('drop table public."SearchJob_plain_child"');assert.equal(identity(),'t');
    const contextDefinition=sql("select pg_get_functiondef('buyer_writer.context(text,text,uuid,uuid,bigint)'::regprocedure)");
    sql('create trusted procedural language plpgsql_alias handler pg_catalog.plpgsql_call_handler inline pg_catalog.plpgsql_inline_handler validator pg_catalog.plpgsql_validator');
    const languageDrift=contextDefinition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql_alias');assert.notEqual(languageDrift,contextDefinition);
    sql(languageDrift);assert.equal(identity(),'f','reviewed entrypoint language drift must fail checkout closed');
    sql(installSql,{fail:true});sql(contextDefinition);sql('drop language plpgsql_alias');assert.equal(identity(),'t');
    sql(`create or replace function buyer_writer.context(p_digest text,p_workspace text,p_job uuid,p_dispatch uuid,p_generation bigint)
      returns jsonb language plpgsql security definer set search_path=pg_catalog set lock_timeout='5s' as $$begin return '{}'::jsonb;end$$;`);
    assert.equal(identity(),'f','reviewed entrypoint body drift must fail closed');
    sql(installSql,{fail:true});sql(contextDefinition);assert.equal(identity(),'t');
    const helperDefinition=sql("select pg_get_functiondef('buyer_writer.valid_sale(jsonb)'::regprocedure)");
    sql(`create or replace function buyer_writer.valid_sale(r jsonb) returns boolean
      language plpgsql immutable set search_path=pg_catalog as $$begin return true;end$$;`);
    assert.equal(identity('runtime'),'f','reviewed helper body drift must fail runtime closed');
    assert.equal(identity('issuer'),'f','reviewed helper body drift must fail issuer closed');
    sql(installSql,{fail:true});sql(helperDefinition);
    assert.equal(identity('runtime'),'t');assert.equal(identity('issuer'),'t');
    for(const schema of ['extensions','public','other_reachable']){
      if(schema==='extensions'||schema==='other_reachable')sql(`create schema ${schema};grant usage on schema ${schema} to public;`);
      sql(`create function ${schema}.public_invoker() returns integer language sql as 'select 1'`);
      assert.equal(identity(),'f',`reachable PUBLIC SECURITY INVOKER in ${schema} must fail closed`);
      sql(`drop function ${schema}.public_invoker()`);
      if(schema!=='public')sql(`drop schema ${schema}`);
      assert.equal(identity(),'t');
    }
    sql("create function public.owner_only_invoker() returns integer language sql as 'select 1';revoke execute on function public.owner_only_invoker() from public;grant execute on function public.owner_only_invoker() to buyer_writer_owner;");
    assert.equal(identity(),'f','owner-only reachable external routine must fail every runtime checkout');
    sql('drop function public.owner_only_invoker()');assert.equal(identity(),'t');
    sql(`create function public.hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
      create trigger hidden_trigger before insert on public."RawSale" for each row execute function public.hidden_trigger();
      revoke execute on function public.hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;`);
    assert.equal(identity(),'f','attached trigger remains executable without writer EXECUTE and must fail checkout closed');
    sql(installSql,{fail:true});sql('drop trigger hidden_trigger on public."RawSale";drop function public.hidden_trigger()');assert.equal(identity(),'t');
    sql('create role writer_entrypoint_outsider nologin');
    denied(`grant usage on schema buyer_writer to writer_entrypoint_outsider;
      grant execute on function buyer_writer.apply(text,text,jsonb) to writer_entrypoint_outsider`,
     `revoke execute on function buyer_writer.apply(text,text,jsonb) from writer_entrypoint_outsider;
      revoke usage on schema buyer_writer from writer_entrypoint_outsider`);
    sql(`grant usage on schema buyer_writer to public;
      grant execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid) to public`);
    assert.equal(identity('runtime'),'f','PUBLIC schema reachability to an approved entrypoint must fail runtime checkout');
    assert.equal(identity('issuer'),'f','PUBLIC schema reachability to an approved entrypoint must fail issuer checkout');
    sql(`revoke execute on function buyer_writer.issue(uuid,uuid,text,text,jsonb,jsonb,timestamp with time zone,uuid) from public;
      revoke usage on schema buyer_writer from public`);
    sql(`grant usage on schema buyer_writer to writer_entrypoint_outsider;
      grant execute on function buyer_writer.apply(text,text,jsonb) to writer_entrypoint_outsider;
      alter role buyer_writer_runtime inherit;
      grant writer_entrypoint_outsider to buyer_writer_runtime`);
    assert.equal(identity(),'f','an inherited outsider entrypoint grant must fail checkout');
    sql(`revoke writer_entrypoint_outsider from buyer_writer_runtime;
      alter role buyer_writer_runtime noinherit;
      revoke execute on function buyer_writer.apply(text,text,jsonb) from writer_entrypoint_outsider;
      revoke usage on schema buyer_writer from writer_entrypoint_outsider;
      drop role writer_entrypoint_outsider`);assert.equal(identity(),'t');
    sql(`create table public."RawSale_hook_child"() inherits (public."RawSale");
      create function public.child_hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
      create trigger child_hidden_trigger before insert on public."RawSale_hook_child" for each row execute function public.child_hidden_trigger();
      revoke execute on function public.child_hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;`);
    assert.equal(identity(),'f','a trigger on a pg_inherits descendant of a protected relation must fail checkout');
    sql(installSql,{fail:true});
    sql('drop table public."RawSale_hook_child";drop function public.child_hidden_trigger()');assert.equal(identity(),'t');
    const stableRelationBinding=sql("select obj_description('buyer_writer'::regnamespace,'pg_namespace')");
    sql(`alter table public."RawSale" rename to "RawSale_bound";
      create table public."RawSale" (like public."RawSale_bound" including defaults including constraints) partition by list(search_job_id);
      create table public."RawSale_partition" partition of public."RawSale" default;
      create function public.partition_hidden_trigger() returns trigger language plpgsql security definer as 'begin return new;end';
      create trigger partition_hidden_trigger before insert on public."RawSale_partition" for each row execute function public.partition_hidden_trigger();
      revoke execute on function public.partition_hidden_trigger() from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;`);
    bindCurrentRelations();
    assert.equal(identity(),'f','a trigger on a declarative partition child must fail checkout even when installation metadata matches the partition graph');
    sql(installSql,{fail:true});
    sql(`drop table public."RawSale";alter table public."RawSale_bound" rename to "RawSale";
      set role buyer_writer_owner;comment on schema buyer_writer is ${literal(stableRelationBinding)};reset role;
      drop function public.partition_hidden_trigger()`);assert.equal(identity(),'t');
    sql(`create rule raw_sale_rewrite_guard as on insert to public."RawSale" do also notify zola_rule_witness`);
    assert.equal(identity(),'f','a nontrivial rewrite rule on a protected relation must fail checkout');
    sql(installSql,{fail:true});sql('drop rule raw_sale_rewrite_guard on public."RawSale"');assert.equal(identity(),'t');
    sql(`create schema hidden_bridge;create table hidden_bridge.witness(id integer);
      create function hidden_bridge.bridge() returns boolean language plpgsql security definer set search_path=pg_catalog as
       'begin insert into hidden_bridge.witness values (1);return true;end';
      revoke usage on schema hidden_bridge from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;
      alter table public."SearchJob" add constraint hidden_bridge_guard check(hidden_bridge.bridge()) not valid;`);
    assert.equal(identity(),'f','an OID-bound function in a protected relation expression must fail checkout without schema reachability');
    assert.equal(productionEvidence().relationPolicySafe,false);sql(installSql,{fail:true});
    assert.equal(sql('select count(*) from hidden_bridge.witness'),'0','rejected identity inspection must not execute the hidden expression');
    sql('alter table public."SearchJob" drop constraint hidden_bridge_guard;drop schema hidden_bridge cascade');assert.equal(identity(),'t');
    sql(`create schema hidden_domain;create table hidden_domain.witness(id integer);
      create function hidden_domain.bridge() returns boolean language plpgsql security definer set search_path=pg_catalog as
       'begin insert into hidden_domain.witness values (1);return true;end';
      create domain hidden_domain.guarded as text check(hidden_domain.bridge());
      alter table public."RawSale" add column hidden_guard hidden_domain.guarded;
      truncate hidden_domain.witness;
      revoke usage on schema hidden_domain from public,buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer;`);
    assert.equal(identity(),'f','a custom column type on a protected relation must fail checkout without schema reachability');
    assert.equal(productionEvidence().relationPolicySafe,false);sql(installSql,{fail:true});
    assert.equal(sql('select count(*) from hidden_domain.witness'),'0','rejected identity inspection must not execute a hidden domain constraint');
    sql('alter table public."RawSale" drop column hidden_guard;drop schema hidden_domain cascade');assert.equal(identity(),'t');
    sql('alter table public."RawSale" owner to anon');assert.equal(identity(),'f','protected relation owner drift must fail checkout');
    sql('alter table public."RawSale" owner to postgres');assert.equal(identity(),'t');
    sql('alter table public."RawSale" rename to "RawSale_bound"');assert.equal(identity(),'f','protected relation rename must fail checkout');
    sql('alter table public."RawSale_bound" rename to "RawSale"');assert.equal(identity(),'t');
    sql(`alter table public."RawSale" rename to "RawSale_bound";
      create table public."RawSale" (like public."RawSale_bound" including defaults including constraints)`);
    assert.equal(identity(),'f','ordinary equivalent-name relation replacement must fail checkout');
    sql('drop table public."RawSale";alter table public."RawSale_bound" rename to "RawSale"');assert.equal(identity(),'t');
    sql(`alter table public."RawSale" rename to "RawSale_bound";
      create table public."RawSale" (like public."RawSale_bound" including defaults including constraints) partition by list(search_job_id)`);
    assert.equal(identity(),'f','partitioned equivalent-name substitution must fail checkout');
    sql('drop table public."RawSale";alter table public."RawSale_bound" rename to "RawSale"');assert.equal(identity(),'t');
    const otherDatabase=run(['exec','-i',name,'psql','-X','-qAt','-U','buyer_writer_runtime','-d','writer_other','-v','ON_ERROR_STOP=1'],'select 1');
    assert.notEqual(otherDatabase.status,0,'safe non-target database must reject the runtime login');
    adminSql('revoke buyer_writer_runtime from postgres granted by fixture_admin');
    assert.equal(identity(),'f','removing one pinned creator ADMIN edge must fail checkout');
    assert.throws(()=>verifyBuyerWriterProductionEvidence(productionEvidence(),Number(creatorOid)),/production verification failed/);
    adminSql('grant buyer_writer_runtime to postgres with admin true,set false,inherit false granted by fixture_admin');assert.equal(identity(),'t');
    const applyDefinition=sql("select pg_get_functiondef('buyer_writer.apply(text,text,jsonb)'::regprocedure)");
    const swappedApplyDefinition=applyDefinition.replace('p_digest text, p_workspace text','p_workspace text, p_digest text');
    assert.notEqual(swappedApplyDefinition,applyDefinition);
    const installApply=definition=>sql(`set role buyer_writer_owner;${definition};revoke all on function buyer_writer.apply(text,text,jsonb) from public;
      grant execute on function buyer_writer.apply(text,text,jsonb) to buyer_writer_runtime;reset role;`);
    sql('drop function buyer_writer.apply(text,text,jsonb)');installApply(swappedApplyDefinition);
    assert.equal(identity(),'f','reviewed routine argument-name drift must fail checkout even when body and signature are unchanged');
    assert.equal(productionEvidence().routinePolicySafe,false);sql(installSql,{fail:true});
    sql('drop function buyer_writer.apply(text,text,jsonb)');installApply(applyDefinition);assert.equal(identity(),'t');
    sql('create role substituted_bootstrap nologin');
    sql('revoke buyer_writer_owner from postgres granted by postgres');
    adminSql('revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer from postgres granted by fixture_admin');
    sql(`grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer to substituted_bootstrap with admin true,set false,inherit false;
      set role substituted_bootstrap;
      grant buyer_writer_owner to substituted_bootstrap with admin false,set true,inherit true granted by substituted_bootstrap;
      reset role;`);
    assert.equal(identity(),'f','substituted creator and SET ROLE path must fail closed');
    sql(`revoke buyer_writer_owner from substituted_bootstrap granted by substituted_bootstrap;
      revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer from substituted_bootstrap granted by postgres;
      reset role;`);
    adminSql('grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer to postgres with admin true,set false,inherit false granted by fixture_admin');
    sql(`set role postgres;
      grant buyer_writer_owner to postgres with admin false,set true,inherit false granted by postgres;
      reset role;drop role substituted_bootstrap;`);
    assert.equal(identity(),'t');
    const relationBindingComment=sql("select obj_description('buyer_writer'::regnamespace,'pg_namespace')");
    adminSql(`alter role postgres rename to original_creator;
      create role postgres superuser login;
      alter database writer_test owner to postgres;
      revoke buyer_writer_owner from original_creator granted by original_creator;
      revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer from original_creator granted by fixture_admin;
      grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer to postgres with admin true,set false,inherit false granted by fixture_admin;`);
    sql('grant buyer_writer_owner to postgres with admin false,set true,inherit false granted by postgres');
    const replacementCreatorOid=sql("select oid from pg_roles where rolname='postgres'");
    assert.notEqual(replacementCreatorOid,creatorOid);
    assert.equal(identity(),'f','renamed and replaced postgres/database owner must not substitute for the pinned creator OID');
    sql(`set role buyer_writer_owner;comment on schema buyer_writer is ${literal('blackspire-buyer-writer:v2:{"creatorOid":"'+replacementCreatorOid+'","relations":[]}')};reset role;`);
    sql(installSql,{fail:true});
    adminSql(`revoke buyer_writer_owner from postgres granted by postgres;
      revoke buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer from postgres granted by fixture_admin;
      alter database writer_test owner to original_creator;
      drop role postgres;
      alter role original_creator rename to postgres;
      grant buyer_writer_owner,buyer_writer_runtime,buyer_writer_issuer to postgres with admin true,set false,inherit false granted by fixture_admin;`);
    sql('grant buyer_writer_owner to postgres with admin false,set true,inherit false granted by postgres');
    sql(`set role buyer_writer_owner;comment on schema buyer_writer is ${literal(relationBindingComment)};reset role;`);
    assert.equal(sql("select oid from pg_roles where rolname='postgres'"),creatorOid);assert.equal(identity(),'t');
    sql('create schema net;create table net.http_request_queue(id integer);grant all on net.http_request_queue to public;');
    assert.equal(identity(),'t','PUBLIC relation ACL without schema USAGE is unreachable');
    denied('grant usage on schema net to public','revoke usage on schema net from public');
    sql("create function net.isolated_network_function() returns integer language sql as 'select 1'");
    assert.equal(identity(),'t','PUBLIC network EXECUTE without schema USAGE is unreachable');
    sql('grant usage on schema net to public');assert.equal(identity(),'f');
    sql('revoke usage on schema net from public');assert.equal(identity(),'t');
    sql('drop schema net cascade');
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
  for(const first of ['reconcile','issue']) {
    const d=issue(),snapshot=capture(d.jobId),attempt=randomUUID(),label=`reconcile_race_${first}`;
    const issuance=issueStatement(d.jobId,snapshot,sourceContext,attempt);
    const reconciliation=`select buyer_writer.reconcile(${literal(d.jobId)},${literal(owner)},${literal(workspace)},${literal(attempt)},${literal(snapshot.updatedAt)}::timestamptz)`;
    const lock=asyncSql(`set application_name=${literal(label)};begin;${first==='reconcile'?reconciliation:issuance};select pg_sleep(2);commit;`);
    await waitForSleeper(label);
    const second=await asyncSql(`set session authorization buyer_writer_issuer;${first==='reconcile'?issuance:reconciliation};`);
    assert.equal((await lock).status,0);
    if(first==='reconcile'){assert.notEqual(second.status,0);assert.match(second.err,/42501/);assert.equal(sql(`select count(*) from buyer_writer.dispatches where id=${literal(attempt)}`),'0');}
    else{assert.equal(second.status,0);assert.equal(JSON.parse(second.out.trim()).state,'cancelled');}
  }
  checks.push('reconciliation and issuance serialize both lock orders without late dispatch survival');
  for(const change of ['criteria','cancel','revision']) {
    const d=issue();const snapshot=capture(d.jobId);const label=`issuer_snapshot_${change}`;
    const mutation=change==='criteria'?`update public."SearchJob" set county='Changed' where id=${literal(d.jobId)};`
      :change==='cancel'?`select buyer_writer.cancel(${literal(d.jobId)},${literal(owner)},${literal(workspace)});`
        :`update public."SearchJob" set updated_at=updated_at+interval '1 microsecond' where id=${literal(d.jobId)};`;
    const lock=asyncSql(`set application_name=${literal(label)};begin;select id from public."SearchJob" where id=${literal(d.jobId)} for update;${mutation}select pg_sleep(2);commit;`);
    await waitForSleeper(label);
    const rejected=await asyncSql(`set session authorization buyer_writer_issuer;${issueStatement(d.jobId,snapshot)};`);
    assert.equal((await lock).status,0);assert.notEqual(rejected.status,0);assert.match(rejected.err,/42501/);
    assert.equal(sql(`select count(*) from buyer_writer.dispatches where job_id=${literal(d.jobId)}`),'1');
    assert.equal(sql(`select state from buyer_writer.dispatches where id=${literal(d.dispatchId)}`),change==='cancel'?'cancelled':'pending');
  }
  checks.push('issuance rechecks captured criteria cancellation and precise revision after waiting on the job lock');
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
    const issuerCredential=randomBytes(32).toString('base64url');
    const httpRawSales=Array.from({length:201},(_,i)=>({OWNER:'HTTP ISOLATED LLC',PIN_NUM:`HTTP-${i}`,TOTSALPRICE:120000,
      SALE_DATE:Date.parse('2026-08-01T00:00:00Z'),ADDR1:'TEST ONLY',ADDR2:'NC',SITE_ADDRESS:'TEST ONLY',_source_type:'arcgis_wake'}));
    const httpRawBytes=Buffer.from(JSON.stringify(httpRawSales));
    const httpSourceContext={...sourceContext,sources:[{...sourceContext.sources[0],sourceType:'arcgis_wake'}],mode:'frontend_payload',rawPayload:{digest:createHash('sha256').update(httpRawBytes).digest('hex'),rowCount:201,byteCount:httpRawBytes.length}};
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
    const issuerQuery=async(statement,parameters)=>{
      assert.equal(statement,'select buyer_writer.issue($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::timestamptz,$8::uuid) as result');
      const result=run(['exec','-i',name,'psql','-X','-qAt','-U','buyer_writer_issuer','-d','writer_test','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],
        `set statement_timeout='10s';set lock_timeout='5s';prepare issuer_http(uuid,uuid,text,text,jsonb,jsonb,timestamptz,uuid) as ${statement};execute issuer_http(${parameters.map(v=>v===null?'null':literal(v)).join(',')});`);
      if(result.status!==0)throw Object.assign(new Error('isolated issuer database rejected'),{code:result.stderr.match(/ERROR:\s+([0-9A-Z]{5})/)?.[1]});
      return{rows:[{result:JSON.parse(result.stdout.trim())}]};
    };
    const server=createBuyerWriterHttpServer({credential:workload,workspace,query,isAvailable:()=>true,issuer:{credential:issuerCredential,query:issuerQuery}});
    try {
      await new Promise((resolve,reject)=>{
        server.once('error',reject);
        server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});
      });
      const prior=issue();const captured=capture(prior.jobId);
      const issuedResponse=await fetch(`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1/jobs/${prior.jobId}/issuance`,{
        method:'POST',redirect:'error',headers:{'content-type':'application/json','x-buyer-issuer-key':issuerCredential},
        body:JSON.stringify({version:1,ownerId:owner,requestId:randomUUID(),criteria:captured.criteria,updatedAt:captured.updatedAt,sourceContext:httpSourceContext})});
      assert.equal(issuedResponse.status,200);const issuedBody=await issuedResponse.json();
      const d={...prior,...issuedBody,permitDigest:createHash('sha256').update(issuedBody.permit).digest('hex')};
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
      assert.equal(contextResponse.status,200);assert.deepEqual((await contextResponse.json()).sourceContext,httpSourceContext);

      const criteria={county:'Wake',state:'NC',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31'};
      const normalized=normalizeBuyerSales({...criteria,raw_sales:httpRawSales});
      const plan=planBuyerWrites({...d,criteria,...normalized});
      for(const item of plan)assert.equal((await send(item.operation,item.payload,{}, {chunkIndex:item.chunkIndex,chunkCount:item.chunkCount})).status,200);
      for(const table of ['RawSale','CleanSale'])assert.equal(sql(`select count(*) from public."${table}" where search_job_id=${literal(d.jobId)}`),'201');
      assert.equal(sql(`select count(*) from public."BuyerReport" where search_job_id=${literal(d.jobId)}`),'1');
      assert.equal(sql(`select status from public."SearchJob" where id=${literal(d.jobId)}`),'completed');
      assert.equal(sql(`select count(*) from public."BuyerProfile" where buyer_name='HTTP ISOLATED LLC'`),'1');
      checks.push('real loopback HTTP issues through separate issuer login then executes multi-chunk plan through dedicated runtime and all five tables');
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
  sql('begin;'+admissionSql+'commit;');
  {
    const issuer='race-operator',jti=randomUUID(),requestId=randomUUID();
    const args=[issuer,jti,requestId,randomBytes(32).toString('hex'),owner,
      'b'.repeat(40),randomUUID(),randomUUID(),workspace];
    const reserve=`select buyer_writer.reserve_operation(${args.map(literal).join(',')},
      'apply',clock_timestamp()+interval '1 minute')`;
    const calls=await Promise.all([
      asyncSql(`set session authorization buyer_writer_runtime;${reserve};`),
      asyncSql(`set session authorization buyer_writer_runtime;${reserve};`)
    ]);
    assert.deepEqual(calls.map(x=>x.status),[0,0]);
    assert.deepEqual(calls.map(x=>x.out.trim()).sort(),['f','t']);
    assert.equal(sql(`select count(*) from buyer_writer.operation_admissions
      where issuer=${literal(issuer)} and jti=${literal(jti)}`),'1');
    checks.push('separate PostgreSQL processes race one admission reservation without duplicate authority');
  }
  {
    const label='admission_rollback_reservation',issuer='rollback-operator';
    const args=[issuer,randomUUID(),randomUUID(),randomBytes(32).toString('hex'),
      owner,'c'.repeat(40),randomUUID(),randomUUID(),workspace];
    const reserve=`select buyer_writer.reserve_operation(${args.map(literal).join(',')},
      'apply',clock_timestamp()+interval '1 minute')`;
    const rolledBack=asyncSql(`set application_name=${literal(label)};
      set session authorization buyer_writer_runtime;begin;${reserve};
      select pg_sleep(2);rollback;`);
    await waitForSleeper(label);
    const successor=await asyncSql(`set session authorization buyer_writer_runtime;${reserve};`);
    assert.equal((await rolledBack).status,0);assert.equal(successor.status,0);
    assert.equal(successor.out.trim(),'t');
    assert.equal(sql(`select count(*) from buyer_writer.operation_admissions
      where issuer=${literal(issuer)} and jti=${literal(args[1])}`),'1');
    checks.push('rolled-back reservation leaves no uniqueness tombstone and successor reserves exactly once');
  }
  check('same-database admission binds canonical apply and receipt atomically',()=>{
    const d=issue(),q=request(d,'start');
    const meta={issuer:'fixture-operator',jti:randomUUID(),requestId:randomUUID(),
      rawDigest:randomBytes(32).toString('hex'),release:'a'.repeat(40),
      operationId:randomUUID(),attemptId:randomUUID()};
    const args=[meta.issuer,meta.jti,meta.requestId,meta.rawDigest,owner,
      meta.release,meta.operationId,meta.attemptId,workspace];
    const reserve=`select buyer_writer.reserve_operation(${args.map(literal).join(',')},'apply',clock_timestamp()+interval '1 minute')`;
    assert.equal(role('buyer_writer_runtime',reserve),'t');
    assert.equal(role('buyer_writer_runtime',reserve),'f');
    const correlate=`select buyer_writer.correlate_admission(${args.map(literal).join(',')})`;
    assert.deepEqual(JSON.parse(role('buyer_writer_runtime',correlate)),
      {state:'reserved',automaticRetry:false});
    const execute=`select buyer_writer.execute_admitted_apply(${args.map(literal).join(',')},
      ${literal(d.permitDigest)},${literal(JSON.stringify(q))}::jsonb)`;
    assert.deepEqual(JSON.parse(role('buyer_writer_runtime',execute)),
      {ok:true,operation:'start',chunkIndex:0});
    assert.deepEqual(JSON.parse(role('buyer_writer_runtime',correlate)),
      {state:'succeeded',result:{ok:true,operation:'start',chunkIndex:0},
       automaticRetry:false,requestCorrelated:true});
    assert.equal(sql(`select count(*) from buyer_writer.receipts
      where dispatch_id=${literal(d.dispatchId)} and operation='start' and chunk_index=0`),'1');
    role('buyer_writer_runtime','select * from buyer_writer.operation_admissions',{fail:true});
    role('buyer_writer_runtime',execute,{fail:true});
    assert.equal(sql(`select count(*) from buyer_writer.receipts
      where dispatch_id=${literal(d.dispatchId)} and operation='start' and chunk_index=0`),'1');
  });
  console.log(JSON.stringify({postgres:'17.6',checksPassed:checks.length,checks,productionConnections:0,providerCalls:0,outreach:0}));
} finally {
  cleanup();
}
