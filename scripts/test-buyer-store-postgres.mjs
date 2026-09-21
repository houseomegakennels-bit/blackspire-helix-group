import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,chmodSync,readFileSync,rmSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {createBuyerStoreRepository} from '../packages/buyer-store/repository.js';
assert.equal(process.versions.node,'22.23.1');
const image='postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94';
const socket=mkdtempSync('/tmp/zola-store-socket-');chmodSync(socket,0o777);
const label=randomUUID();let container;
const run=(args,input)=>{const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});assert.equal(r.status,0,(r.stderr??'').slice(0,500));return r.stdout.trim();};
try{
 container=run(['create','--network','none','--read-only','--memory','256m','--pids-limit','128','--label',`blackspire.test-owner=${label}`,'--tmpfs','/var/lib/postgresql/data:rw,size=128m','--tmpfs','/tmp:rw,size=16m','--mount',`type=bind,source=${socket},target=/var/run/postgresql`,'-e','POSTGRES_HOST_AUTH_METHOD=trust',image]);
 run(['start',container]);let ready=false;
 for(let i=0;i<60;i++){const r=spawnSync('docker',['exec',container,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres'],{encoding:'utf8'});if(r.status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 const fixture=readFileSync('tests/fixtures/buyer-writer/schema.sql','utf8');
 run(['exec','-i',container,'psql','-X','-q','-U','postgres','-v','ON_ERROR_STOP=1'],fixture+'\nCREATE POLICY legacy_public_jobs ON public."SearchJob" TO PUBLIC USING(true) WITH CHECK(true); CREATE POLICY legacy_public_reports ON public."BuyerReport" FOR SELECT TO PUBLIC USING(true);\nCREATE TABLE public.exports(id uuid PRIMARY KEY,user_id uuid NOT NULL,search_job_id uuid REFERENCES public."SearchJob"(id),file_name text NOT NULL,storage_path text NOT NULL,row_count integer,created_at timestamptz); REVOKE EXECUTE ON FUNCTION auth.uid() FROM PUBLIC; CREATE POLICY imported_exports_owner ON public.exports TO PUBLIC USING(auth.uid()=user_id) WITH CHECK(auth.uid()=user_id);\n'+readFileSync('packages/buyer-store/repository-schema.sql','utf8'));
 const connect=async user=>{const client=new pg.Client({host:socket,user,database:'postgres'});await client.connect();return client;};
 const repository=createBuyerStoreRepository({connect:()=>connect('buyer_repository_login'),connectCapability:()=>connect('buyer_capability_login')});
 const owner='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
 const job={id:randomUUID(),state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-01-02',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
 const created=await repository.execute('job-create',job,owner,'admin');assert.equal(created.user_id,owner);assert.equal(created.date_range_start,job.date_range_start);assert.match(created.updated_at,/\.\d{6}Z$/);
 assert.equal((await repository.execute('job-create',job,owner,'admin')).id,job.id);
 await assert.rejects(repository.execute('job-create',{...job,county:'changed'},owner,'admin'));
 assert.equal(await repository.execute('job-get',{id:job.id},foreign),null);
 assert.equal((await repository.execute('jobs-list',{ids:[],limit:10},owner)).length,1);
 assert.equal((await repository.execute('jobs-list',{ids:[],limit:10},foreign)).length,0);
 const exp={id:randomUUID(),searchJobId:job.id,fileName:'fixture.csv',rowCount:0};
 await assert.rejects(repository.execute('export-create',exp,foreign,'admin'));
 assert.equal((await repository.execute('export-create',exp,owner,'admin')).storage_path,`client-downloads/${owner}/${exp.id}/fixture.csv`);assert.equal((await repository.execute('counts',{},owner)).exportCount,1);assert.equal((await repository.execute('exports-list',{searchJobId:null,limit:5},owner)).length,1);assert.deepEqual(await repository.execute('exports-list',{searchJobId:null,limit:5},foreign),[]);
 assert.deepEqual((await repository.execute('reports-list',{searchJobId:null,limit:5,offset:0},foreign)).reports,[]);
 const profiles=await repository.readCapabilityProfiles({county:null,state:null,buyerName:null,propertyType:null,cashBuyer:null,llcBuyer:null,limit:5});assert.equal(profiles.observation.requests,2);
 const cap=await connect('buyer_capability_login');try{await cap.query('SET ROLE buyer_capability_reader');assert.equal((await cap.query("SELECT has_function_privilege(current_user,(SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth' AND p.proname='uid' AND p.pronargs=0),'EXECUTE') AS allowed")).rows[0].allowed,false);await assert.rejects(cap.query('SELECT * FROM public."SearchJob"'));await assert.rejects(cap.query('INSERT INTO public."BuyerProfile"(buyer_name) VALUES(\'forbidden\')'));}finally{await cap.end();}
 const actor=await connect('buyer_repository_login');try{await actor.query('SET ROLE buyer_repository_user');await assert.rejects(actor.query('DELETE FROM public."SearchJob"'));await assert.rejects(actor.query('SET ROLE buyer_capability_reader'));}finally{await actor.end();}
 // Fill each rolling window to one remaining slot, then race independent
 // native connections. RLS+owner advisory serialization admits exactly one.
 const freshJob=()=>({...job,id:randomUUID()});
 for(let i=1;i<24;i++)await repository.execute('job-create',freshJob(),owner,'beta_tester');
 const racedJobs=Array.from({length:5},freshJob);
 const jobResults=await Promise.allSettled(racedJobs.map(value=>repository.execute('job-create',value,owner,'beta_tester')));
 assert.equal(jobResults.filter(value=>value.status==='fulfilled').length,1);
 const winner=racedJobs[jobResults.findIndex(value=>value.status==='fulfilled')];
 assert.equal((await repository.execute('job-create',winner,owner,'beta_tester')).id,winner.id);
 await assert.rejects(repository.execute('job-create',freshJob(),owner));
 await repository.execute('job-create',freshJob(),foreign,'beta_tester');
 await repository.execute('job-create',freshJob(),owner,'admin');
 for(let i=1;i<49;i++)await repository.execute('export-create',{...exp,id:randomUUID()},owner,'beta_tester');
 const racedExports=Array.from({length:4},()=>({...exp,id:randomUUID()}));
 const exportResults=await Promise.allSettled(racedExports.map(value=>repository.execute('export-create',value,owner,'beta_tester')));
 assert.equal(exportResults.filter(value=>value.status==='fulfilled').length,1);
 await repository.execute('export-create',{...exp,id:randomUUID()},owner,'admin');
 console.log('PASS: actual native repository ownership, stable IDs, foreign export denial, read-only capability role and separate role grants');
}finally{if(container){const info=JSON.parse(run(['inspect',container]))[0];assert.equal(info.Config.Labels['blackspire.test-owner'],label);run(['rm','-f',container]);}rmSync(socket,{recursive:true,force:true});}
