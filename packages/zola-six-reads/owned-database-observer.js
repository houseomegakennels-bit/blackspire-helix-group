import {createHash,randomBytes} from 'node:crypto';
export const OWNED_OBSERVER_TABLES=Object.freeze(['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob','exports']);
export const RETAINED_OBSERVER_TABLES=Object.freeze(['CountyDataSource','buyer_group_registry','buyer_matches','data_sources','deal_analysis','deal_leads','nexus_contacts','owners','properties','seller_conversations','seller_leads']);
const digest=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const fail=()=>{throw new Error('Owned dual-source database observation rejected');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const endpoints={source:'postgresql://db.kchtrvfcixnimvxxctkj.supabase.co:5432/postgres',owned:'postgresql://127.0.0.1:55432/postgres'};
const begin="BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;\nSET LOCAL statement_timeout='15s';SET LOCAL lock_timeout='1s';SET LOCAL idle_in_transaction_session_timeout='20s';SET LOCAL search_path=pg_catalog;SET LOCAL timezone='UTC';SET LOCAL row_security=off;\n";
function bind(config,phase){
 if(![6,7].includes(config.version)||config.backendProfile!=='owned-postgres-v1'||!hex(config.profileDigest)||!uuid(config.acceptanceSearchJobId)||!/^[a-f0-9]{40}$/.test(config.releaseSha??'')||!/^[A-Za-z0-9._:-]{1,128}$/.test(config.runId??'')||!['before','after'].includes(phase))fail();
 return `'version',2,'releaseSha','${config.releaseSha}','runId','${config.runId}','phase','${phase}','profileDigest','${config.profileDigest}'`;
}
function envelope(config,phase){return `${bind(config,phase)},'capturedAt',clock_timestamp(),'database',current_database(),'role',current_user,'readOnly',current_setting('transaction_read_only')='on'`;}
export function ownedObservationSQL(config,phase,kind,prior={}){
 const common=envelope(config,phase),job=config.acceptanceSearchJobId;
 if(['snapshot_source','snapshot_owned'].includes(kind)){
  const source=kind==='snapshot_source'?'source':'owned',tables=source==='source'?RETAINED_OBSERVER_TABLES:OWNED_OBSERVER_TABLES;
  const selects=tables.map(table=>`select '${table}' as name,count(*)::int as rows,encode(sha256(convert_to(coalesce(string_agg(row_hash,'' order by row_hash),''),'UTF8')),'hex') as digest,encode(sha256(convert_to(coalesce(string_agg(version_hash,'' order by version_hash),''),'UTF8')),'hex') as version_digest from (select encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') as row_hash,encode(sha256(convert_to(to_jsonb(t)::text||':'||xmin::text,'UTF8')),'hex') as version_hash from public."${table}" t limit 250001) bounded`).join(' union all ');
  return `${begin}with observed as (${selects}) select jsonb_build_object(${common},'source','${source}','primary',not pg_is_in_recovery(),'bypassRls',(select rolbypassrls from pg_roles where rolname=current_user),'ordinaryTables',(select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname in (${tables.map(t=>`'${t}'`).join(',')})),'tables',(select jsonb_agg(to_jsonb(observed) order by name) from observed)) as observation;ROLLBACK;`;
 }
 if(kind==='target')return `${begin}select jsonb_build_object(${common},'jobId','${job}','ownerId',(select user_id::text from public."SearchJob" where id='${job}'::uuid),'targetCount',(select count(*)::int from public."SearchJob" where id='${job}'::uuid)) as observation;ROLLBACK;`;
 if(kind==='auth'){
  if(!uuid(prior.target?.ownerId)||prior.target.jobId!==job)fail();const owner=prior.target.ownerId;
  return `${begin}select jsonb_build_object(${common},'ownerId','${owner}','ownerExists',exists(select from auth.users where id='${owner}'::uuid),'foreignId',(select id::text from auth.users where id<>'${owner}'::uuid order by id limit 1)) as observation;ROLLBACK;`;
 }
 if(kind==='owner'){
  const owner=prior.auth?.ownerId,foreign=prior.auth?.foreignId;
  if(!uuid(owner)||!uuid(foreign)||owner===foreign||owner!==prior.target?.ownerId||prior.auth.ownerExists!==true)fail();
  const configured=(name,value)=>`select true as configured from (select set_config('${name}','${value}',true)) q;`;
  return `${begin}${configured('zola.owner',owner)}${configured('zola.foreign',foreign)}${configured('zola.job',job)}
select true as configured from (select set_config('zola.target_owner_valid',(select (count(*)=1)::text from public."SearchJob" where id='${job}'::uuid and user_id='${owner}'::uuid),true)) q;
SET LOCAL row_security=on;SET LOCAL ROLE authenticated;
select true as configured from (select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('zola.owner'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',current_setting('zola.owner'),true)) q;
select true as configured from (select set_config('zola.own_count',(select count(*)::text from public."SearchJob" where id='${job}'::uuid),true)) q;
select true as configured from (select set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('zola.foreign'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',current_setting('zola.foreign'),true)) q;
select jsonb_build_object(${common},'witness',encode(sha256(convert_to(current_setting('zola.owner')||':'||current_setting('zola.foreign')||':'||current_setting('zola.job'),'UTF8')),'hex'),'authObservationDigest','${digest(prior.auth)}','realDistinctUsers',current_setting('zola.target_owner_valid')='true','ownVisible',current_setting('zola.own_count')::int,'foreignVisible',(select count(*)::int from public."SearchJob" where id='${job}'::uuid)) as observation;ROLLBACK;`;
 }
 fail();
}
const commonKeys=['version','releaseSha','runId','phase','profileDigest','capturedAt','database','role','readOnly'];
function common(value,config,phase){
 bind(config,phase);if(value?.version!==2||value.releaseSha!==config.releaseSha||value.runId!==config.runId||value.phase!==phase||value.profileDigest!==config.profileDigest||value.database!=='postgres'||value.readOnly!==true||typeof value.capturedAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.capturedAt)||!Number.isFinite(Date.parse(value.capturedAt)))fail();
}
export function validateOwnedObservation(value,config,phase,kind,prior={}){
 common(value,config,phase);
 if(kind.startsWith('snapshot_')){
  const source=kind==='snapshot_source'?'source':'owned',tables=source==='source'?RETAINED_OBSERVER_TABLES:OWNED_OBSERVER_TABLES;
  if(!exact(value,[...commonKeys,'source','primary','bypassRls','ordinaryTables','tables'])||value.source!==source||value.role!=='postgres'||value.primary!==true||value.bypassRls!==true||value.ordinaryTables!==tables.length||!Array.isArray(value.tables)||value.tables.length!==tables.length||value.tables.map(t=>t.name).sort().join(',')!==tables.join(','))fail();
  for(const row of value.tables)if(!exact(row,['name','rows','digest','version_digest'])||!Number.isInteger(row.rows)||row.rows<0||row.rows>250000||!hex(row.digest)||!hex(row.version_digest))fail();
 }else if(kind==='target'){
  if(!exact(value,[...commonKeys,'jobId','ownerId','targetCount'])||value.role!=='postgres'||value.jobId!==config.acceptanceSearchJobId||!uuid(value.ownerId)||value.targetCount!==1)fail();
 }else if(kind==='auth'){
  if(!exact(value,[...commonKeys,'ownerId','ownerExists','foreignId'])||value.role!=='postgres'||value.ownerId!==prior.target?.ownerId||value.ownerExists!==true||!uuid(value.foreignId)||value.foreignId===value.ownerId)fail();
 }else if(kind==='owner'){
  if(!exact(value,[...commonKeys,'witness','authObservationDigest','realDistinctUsers','ownVisible','foreignVisible'])||value.role!=='authenticated'||value.realDistinctUsers!==true||value.ownVisible!==1||value.foreignVisible!==0||!hex(value.witness)||!hex(value.authObservationDigest))fail();
  if(prior.auth&&(value.authObservationDigest!==digest(prior.auth)||value.witness!==digest(`${prior.auth.ownerId}:${prior.auth.foreignId}:${config.acceptanceSearchJobId}`)))fail();
 }else fail();return structuredClone(value);
}
export function validateOwnedDivisionSnapshot(value,config,phase){
 if(!exact(value,['version','profileDigest','source','owned'])||value.version!==2||value.profileDigest!==config.profileDigest)fail();
 validateOwnedObservation(value.source,config,phase,'snapshot_source');validateOwnedObservation(value.owned,config,phase,'snapshot_owned');return structuredClone(value);
}
export const validateOwnedOwnerWitness=(value,config,phase)=>validateOwnedObservation(value,config,phase,'owner');
export function compareOwnedDivisionSnapshots(before,after,config){
 validateOwnedDivisionSnapshot(before,config,'before');validateOwnedDivisionSnapshot(after,config,'after');let rows=0;
 for(const source of ['source','owned']){
  if(Date.parse(after[source].capturedAt)<Date.parse(before[source].capturedAt))fail();
  for(const a of before[source].tables){const b=after[source].tables.find(row=>row.name===a.name);if(!b||a.rows!==b.rows||a.digest!==b.digest||a.version_digest!==b.version_digest)fail();rows+=a.rows;}
 }
 return {status:'PASS_UNCHANGED_DIVISION_ROWS',version:2,backendProfile:config.backendProfile,profileDigest:config.profileDigest,tableCount:17,rowCount:rows,snapshotDigest:digest({source:before.source.tables,owned:before.owned.tables}),netMutationDelta:0,tupleVersionDelta:0,scope:'All rows in six owned Buyer tables and eleven retained Supabase division tables, before/after collection; no claim of complete attempted/transient writes or provider egress'};
}

export function createJournaledOwnedObserver(config,execute){
 return async(phase,{generation,store})=>{
  bind(config,phase);
  if(!generation||!['apiGeneration','workerGeneration'].every(k=>typeof generation[k]==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(generation[k])))fail();
  const configDigest=digest(config),generationDigest=digest(generation),initial=store.events();
  if(initial[0]?.type!=='run'||initial[0].binding!==configDigest||initial[0].releaseSha!==config.releaseSha)fail();
  if(phase==='after'&&!Array.from({length:6},(_,i)=>i).every(i=>initial.some(e=>e.type==='intent'&&e.index===i)&&initial.some(e=>e.type==='collected'&&e.index===i)))fail();
  const observed={};
  for(const kind of ['snapshot_source','snapshot_owned','target','auth','owner']){
   const source=['snapshot_source','auth'].includes(kind)?'source':'owned',events=store.events();
   const matches=events.map((event,index)=>({event,index})).filter(({event})=>event.type==='database_query_intent'&&event.binding?.phase===phase&&event.binding?.kind===kind);
   if(matches.length>1)fail();let intent,index;
   const query=b=>ownedObservationSQL(config,phase,kind,observed).replace("'capturedAt',clock_timestamp()",`'collectorBinding','${digest(b)}','capturedAt',clock_timestamp()`);
   if(matches.length){({event:intent,index}=matches[0]);}else{
    if(phase==='before'&&events.some(e=>e.type==='intent'))fail();
    const binding={version:2,releaseSha:config.releaseSha,runId:config.runId,configDigest,generationDigest,phase,kind,endpoint:endpoints[source],profileDigest:config.profileDigest,nonce:randomBytes(32).toString('hex'),sequence:events.length,previousDigest:digest(events)};
    index=events.length;intent={type:'database_query_intent',binding,queryDigest:digest(query(binding)),startedAt:Date.now()};store.append(intent);
   }
   const b=intent.binding;
   if(!exact(intent,['type','binding','queryDigest','startedAt'])||!exact(b,['version','releaseSha','runId','configDigest','generationDigest','phase','kind','endpoint','profileDigest','nonce','sequence','previousDigest'])||b.version!==2||b.releaseSha!==config.releaseSha||b.runId!==config.runId||b.configDigest!==configDigest||b.generationDigest!==generationDigest||b.phase!==phase||b.kind!==kind||b.endpoint!==endpoints[source]||b.profileDigest!==config.profileDigest||!hex(b.nonce)||b.sequence!==index||b.previousDigest!==digest(store.events().slice(0,index))||intent.queryDigest!==digest(query(b)))fail();
   if(phase==='after'&&store.events().slice(index+1).some(e=>e.type==='intent'||e.type==='collected'))fail();
   const results=store.events().map((event,i)=>({event,index:i})).filter(({event})=>event.type==='database_query_result'&&event.intentDigest===digest(intent));if(results.length>1)fail();
   const check=(value,completedAt)=>{
    if(!value||value.collectorBinding!==digest(b)||!Number.isSafeInteger(intent.startedAt)||!Number.isSafeInteger(completedAt)||completedAt<intent.startedAt||completedAt-intent.startedAt>30000)fail();
    const {collectorBinding:_binding,...body}=value,checked=validateOwnedObservation(body,config,phase,kind,observed),captured=Date.parse(body.capturedAt);
    if(captured<intent.startedAt-1000||captured>completedAt+1000)fail();return checked;
   };
   let result;if(results.length){if(results[0].index!==index+1)fail();result=results[0].event;}else{
    if(matches.length)fail();const observation=await execute({source,sql:query(b)}),completedAt=Date.now();check(observation,completedAt);
    if(digest(store.events().at(-1))!==digest(intent))fail();result={type:'database_query_result',intentDigest:digest(intent),queryDigest:intent.queryDigest,observation,observationDigest:digest(observation),completedAt};store.append(result);
   }
   if(!exact(result,['type','intentDigest','queryDigest','observation','observationDigest','completedAt'])||result.queryDigest!==intent.queryDigest||result.observationDigest!==digest(result.observation))fail();
   if(phase==='before'){const admission=store.events().findIndex(e=>e.type==='intent');if(admission>=0&&index+1>=admission)fail();}
   observed[kind]=check(result.observation,result.completedAt);
  }
  return {snapshot:{version:2,profileDigest:config.profileDigest,source:observed.snapshot_source,owned:observed.snapshot_owned},owner:observed.owner};
 };
}
