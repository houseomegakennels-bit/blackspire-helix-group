import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {prepareConsumerCredential,createConsumerCredentialStore,createConsumerCredentialTransport,
 CONSUMER_CREDENTIAL_PATHS as P,CONSUMER_CREDENTIAL_TARGETS as T} from '../packages/zola-release/consumer-credential-preparation.js';
const sourceSha='a'.repeat(40),input={sourceSha};
const secret=Buffer.alloc(32,7).toString('base64url'),token='fixture_vercel_auth_value_only';
function fixture(){
 const files=new Map(),calls=[];let generations=0,clock=0,locked=false,failAt=null,failAfter=false,changed=false;
 const metadata={repositoryId:12,projectId:T.project,teamId:T.team,
  github:{name:T.secret,createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-01-01T00:00:00Z'},
  preview:{id:T.preview,type:'sensitive',target:['preview'],gitBranch:T.branch,createdAt:1,updatedAt:1},
  production:{id:T.production,type:'sensitive',target:['production'],gitBranch:null,createdAt:1,updatedAt:1}};
 const auth={identity:{uid:0,gid:0,mode:0o100600},value:{token}};
 const store={exists:name=>files.has(name),read:name=>{if(!files.has(name))throw new Error('missing');return files.get(name);},
  publish(name,bytes){if(files.has(name)&&files.get(name)!==bytes)throw new Error('foreign');files.set(name,bytes);},
  acquire(){if(locked)throw new Error('locked');locked=true;return{assertCurrent(){if(!locked)throw new Error('lost');},close(){locked=false;}};}};
 const transport={async observe(){return structuredClone(metadata);},async apply(step,value,authToken){
  assert.equal(value,secret);assert.equal(authToken,token);assert.ok(files.has(P.root+'/'+step+'.intent.json'));
  calls.push({step,value});if(step===failAt&&!failAfter){failAt=null;throw new Error('private remote diagnostic');}
  metadata[step].updatedAt=step==='github'?`2026-09-21T00:00:${String(++clock).padStart(2,'0')}Z`:++clock+100;
  if(step===failAt&&failAfter){failAt=null;throw new Error('private remote diagnostic');}
 }};
 const deps={store,transport,readAuth:()=>structuredClone(changed?{...auth,value:{token:token+'_changed'}}:auth),generate:()=>{generations++;return secret;},getuid:()=>0};
 return{deps,files,calls,metadata,auth,get generations(){return generations;},fail(step,after){failAt=step;failAfter=after;},changeAuth(){changed=true;}};
}
test('retains one secret, acknowledges exactly three fixed destinations, and never claims deployment acceptance',async()=>{
 const f=fixture(),result=await prepareConsumerCredential(input,f.deps);
 assert.deepEqual(f.calls.map(c=>c.step),['github','preview','production']);assert.equal(f.generations,1);
 assert.equal(f.files.get(P.consumer),secret+'\n');assert.equal(f.files.get(P.vercel),token+'\n');
 assert.equal(result.deploymentAccepted,false);assert.equal(result.consumedPermitVerified,false);
 assert.equal(JSON.stringify(result).includes(secret),false);assert.equal(JSON.stringify(result).includes(token),false);
 await prepareConsumerCredential(input,f.deps);assert.equal(f.calls.length,3);assert.equal(f.generations,1);
});
test('unknown write results retain intent and retry only the same pending value without rotating',async()=>{
 for(const step of ['github','preview','production'])for(const after of [false,true]){
  const f=fixture();f.fail(step,after);
  await assert.rejects(prepareConsumerCredential(input,f.deps),/^Error: Consumer credential preparation stopped; retained state requires reconciliation$/);
  assert.ok(f.files.has(P.root+'/'+step+'.intent.json'));assert.equal(f.files.has(P.root+'/'+step+'.result.json'),false);
  const before=f.files.get(P.consumer);await prepareConsumerCredential(input,f.deps);
  assert.equal(f.files.get(P.consumer),before);assert.equal(f.generations,1);assert.equal(f.calls.filter(c=>c.step===step).length,2);
  assert.ok(f.calls.every(c=>c.value===secret));
 }
});
test('existing local credentials without our plan, source drift and auth drift never rotate',async()=>{
 for(const filename of [P.consumer,P.vercel,P.consumer+'.stage',P.root+'/github.intent.json']){
  const f=fixture();f.files.set(filename,'retained-other-value\n');await assert.rejects(prepareConsumerCredential(input,f.deps));
  assert.equal(f.calls.length,0);assert.equal(f.generations,0);assert.equal(f.files.get(filename),'retained-other-value\n');
 }
 const f=fixture();f.fail('github',false);await assert.rejects(prepareConsumerCredential(input,f.deps));
 await assert.rejects(prepareConsumerCredential({sourceSha:'b'.repeat(40)},f.deps));f.changeAuth();
 await assert.rejects(prepareConsumerCredential(input,f.deps));assert.equal(f.calls.length,1);assert.equal(f.generations,1);
});
test('remote scope drift and changed completed acknowledgements stop before another effect',async()=>{
 const f=fixture();let observations=0;const observe=f.deps.transport.observe;
 f.deps.transport.observe=async()=>{const m=await observe();if(++observations>1)m.preview.gitBranch='different';return m;};
 await assert.rejects(prepareConsumerCredential(input,f.deps));assert.equal(f.calls.length,0);
 const g=fixture();await prepareConsumerCredential(input,g.deps);g.metadata.github.updatedAt='2026-09-22T00:00:00Z';
 await assert.rejects(prepareConsumerCredential(input,g.deps));assert.equal(g.calls.length,3);
});
test('lost local result acknowledgement resumes retained result without another external write',async()=>{
 const f=fixture(),publish=f.deps.store.publish;let crash=true;
 f.deps.store.publish=(name,bytes)=>{publish(name,bytes);if(name===P.root+'/preview.result.json'&&crash){crash=false;throw new Error('crash');}};
 await assert.rejects(prepareConsumerCredential(input,f.deps));await prepareConsumerCredential(input,f.deps);
 assert.deepEqual(f.calls.map(c=>c.step),['github','preview','production']);assert.equal(f.generations,1);
});
function transportFixture(){
 const calls=[];let omitScopes=false;const repository={id:12,full_name:T.repository,owner:{login:'houseomegakennels-bit'},archived:false,disabled:false};
 const ghSecret={name:T.secret,created_at:'2026-01-01T00:00:00Z',updated_at:'2026-01-01T00:00:00Z'};
 const project={id:T.project,accountId:T.team};
 const envs=['preview','production'].map(step=>({id:T[step],key:T.key,type:'sensitive',target:[step],gitBranch:step==='preview'?T.branch:null,createdAt:1,updatedAt:1}));
 const run=(cmd,args,options)=>{
  assert.equal(cmd,'/usr/bin/gh');calls.push({cmd,args,options});
  if(args[0]==='secret')return{status:0,stdout:'',stderr:''};
  return{status:0,stdout:JSON.stringify(args[1].endsWith('/'+T.secret)?ghSecret:repository),stderr:''};
 };
 const fetchImpl=async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'error');assert.equal(options.headers.authorization,'Bearer '+token);
  assert.equal(new URL(url).hostname,'api.vercel.com');assert.equal(new URL(url).searchParams.get('teamId'),T.team);
  if(options.method==='PATCH'){
   assert.deepEqual(Object.keys(JSON.parse(options.body)),['value']);assert.equal(JSON.parse(options.body).value,secret);
   const row=envs.find(e=>url.includes('/env/'+e.id+'?'));assert.ok(row);return new Response(JSON.stringify(omitScopes?{id:row.id,key:row.key,type:row.type}:row));
  }
  return new Response(JSON.stringify(new URL(url).pathname.endsWith('/env')?{envs}:project));
 };
 return{calls,repository,project,envs,omitScopes:()=>{omitScopes=true;},transport:createConsumerCredentialTransport({run,fetchImpl})};
}
test('real transport fixes GH repository/stdin and Vercel IDs/scopes with value-only PATCH and no deploy',async()=>{
 const f=transportFixture();await f.transport.observe(token);
 for(const step of ['github','preview','production'])await f.transport.apply(step,secret,token);
 const gh=f.calls.find(c=>c.args?.[0]==='secret');assert.deepEqual(gh.args,['secret','set',T.secret,'--repo',T.repository,'--app','actions']);
 assert.equal(gh.options.input,secret);assert.equal(JSON.stringify(gh.args).includes(secret),false);assert.equal(JSON.stringify(gh.options.env).includes(secret),false);
 assert.equal(f.calls.filter(c=>c.options.method==='PATCH').length,2);assert.equal(f.calls.some(c=>c.url?.includes('/deployments')),false);
});
test('transport rejects foreign project, widened scopes, duplicate env rows and redirects',async()=>{
 for(const mutate of [f=>{f.project.accountId='other';},f=>{f.envs[0].gitBranch=null;},f=>{f.envs[1].type='plain';},f=>{f.envs.push({...f.envs[0],id:'other'});},f=>{f.repository.id=0;}]){
  const f=transportFixture();mutate(f);await assert.rejects(f.transport.observe(token));assert.equal(f.calls.some(c=>c.options.method==='PATCH'),false);
 }
});
test('root store uses private durable files, rejects symlinks and excludes concurrent holders',{skip:process.getuid?.()!==0},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-prep-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const map=v=>typeof v==='string'&&v.startsWith('/')?path.join(root,v):v;
 fs.mkdirSync(map(path.dirname(P.root)),{recursive:true,mode:0o700});
 const io={...fs};for(const key of ['lstatSync','openSync','mkdirSync','renameSync'])io[key]=(...args)=>fs[key](...args.map((a,i)=>i===0||key==='renameSync'&&i===1?map(a):a));
 const run=(cmd,args,options)=>spawnSync(cmd,args.map(v=>typeof v==='string'&&v.startsWith('/')&&!v.startsWith('/proc/')?map(v):v),options);
 const store=createConsumerCredentialStore({io,run}),lease=store.acquire();
 assert.throws(()=>store.acquire());store.publish(P.consumer,secret+'\n');store.publish(P.vercel,token+'\n');
 assert.equal(store.read(P.consumer),secret+'\n');assert.equal(fs.statSync(map(P.consumer)).mode&0o777,0o600);
 assert.throws(()=>store.publish(P.consumer,'different\n'));lease.assertCurrent();lease.close();
 const next=store.acquire();next.close();fs.unlinkSync(map(P.consumer));fs.symlinkSync(map(P.vercel),map(P.consumer));assert.throws(()=>store.read(P.consumer));
});

test('production missing branch and PATCH omitted scope fields are accepted only with strict fresh GET scopes',async()=>{
 const f=transportFixture();delete f.envs[1].gitBranch;f.omitScopes();
 const first=await f.transport.observe(token);assert.equal(first.production.gitBranch,null);
 await f.transport.apply('preview',secret,token);await f.transport.apply('production',secret,token);
 const verified=await f.transport.observe(token);assert.equal(verified.preview.gitBranch,T.branch);
 f.envs[0].target=['production'];await assert.rejects(f.transport.observe(token));
});

test('recovered stage and interrupted rename are resynchronized before durable publication',{skip:process.getuid?.()!==0},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-durable-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const map=v=>typeof v==='string'&&v.startsWith('/')?path.join(root,v):v;
 fs.mkdirSync(map(path.dirname(P.root)),{recursive:true,mode:0o700});
 const io={...fs},synced=[];
 for(const key of ['lstatSync','openSync','mkdirSync'])io[key]=(...args)=>fs[key](map(args[0]),...args.slice(1));
 io.fsyncSync=fd=>{synced.push(fs.fstatSync(fd).isDirectory()?'directory':'file');fs.fsyncSync(fd);};
 let interrupted=true;
 io.renameSync=(from,to)=>{fs.renameSync(map(from),map(to));if(interrupted){interrupted=false;throw new Error('interrupted after rename');}};
 const run=(cmd,args,options)=>spawnSync(cmd,args.map(v=>typeof v==='string'&&v.startsWith('/')&&!v.startsWith('/proc/')?map(v):v),options);
 const store=createConsumerCredentialStore({io,run}),lease=store.acquire();
 try{
  fs.writeFileSync(map(P.consumer+'.stage'),secret+'\n',{mode:0o600});
  assert.throws(()=>store.publish(P.consumer,secret+'\n'));
  assert.ok(synced.includes('file'),'retained stage must be fsynced before rename');
  synced.length=0;store.publish(P.consumer,secret+'\n');assert.deepEqual(synced,['file','directory']);
  assert.equal(store.read(P.consumer),secret+'\n');
 }finally{lease.close();}
});
