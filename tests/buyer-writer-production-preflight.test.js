import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {validateBuyerWriterProductionPlan} from '../scripts/lib/buyer-writer-production-preflight.mjs';

const repo=path.resolve(new URL('..',import.meta.url).pathname);
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`
 :value&&typeof value==='object'?`{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
 :JSON.stringify(value);
const write=(filename,value,mode=0o600)=>fs.writeFileSync(filename,
 typeof value==='string'?value:JSON.stringify(value),{mode});
const edge={grantor:'buyer_writer_owner',grantee:'buyer_writer_runtime',privilege:'EXECUTE',grantable:false};

function projectedObservation(){
 return {
  version:1,
  roles:[{name:'buyer_writer_runtime',oid:'100',login:true,inherit:false,superuser:false,createDb:false,
   createRole:false,replication:false,bypassRls:false}],
  memberships:[{role:'buyer_writer_runtime',roleOid:'100',member:'postgres',memberOid:'10',grantor:'postgres',
   grantorOid:'10',memberLogin:true,grantorSuperuser:false,admin:true,inherit:false,set:false}],
  schema:{name:'buyer_writer',owner:'buyer_writer_owner',edges:[{...edge,privilege:'USAGE'}]},
  relations:[{schema:'buyer_writer',name:'dispatches',kind:'r',owner:'buyer_writer_owner',rlsEnabled:false,
   rlsForced:false,columns:[{name:'id',type:'uuid',notNull:true,default:'gen_random_uuid()'}],
   constraints:[{name:'dispatches_pkey',type:'p',definition:'PRIMARY KEY (id)'}],
   indexes:[{name:'dispatches_pkey',unique:true,primary:true,definition:'CREATE UNIQUE INDEX'}],edges:[]}],
  types:[{schema:'buyer_writer',name:'dispatches',kind:'composite',owner:'buyer_writer_owner',
   definition:'(id uuid)',edges:[]}],
  routines:[{signature:'buyer_writer.context(text)',owner:'buyer_writer_owner',ownerOid:'101',securityDefiner:true,
   language:'plpgsql',digest:'d'.repeat(64),config:['search_path=pg_catalog'],volatility:'v',kind:'f',strict:false,
   leakproof:false,parallel:'u',argumentNames:['p'],result:'jsonb',argumentDefaults:0,returnsSet:false,variadic:'0',
   hasAllArgumentTypes:false,hasArgumentModes:false,edges:[edge]}],
  defaultPrivileges:[{owner:'buyer_writer_owner',schema:'buyer_writer',objectType:'FUNCTION',edges:[]}],
  extensions:[{name:'pg_net',version:'0.19.5',schema:'extensions',owner:'supabase_admin'}],
  databasePrivileges:[{database:'postgres',grantee:'PUBLIC',connect:true,create:false,temporary:false}],
  targetRelations:['BuyerProfile'],targetPublicRelations:[],targetPublicColumns:[],directRelations:[],
  directSequences:[],schemaCreate:[],externalRoutines:[],bootstrapSuperuser:true,creatorOid:'10',
  relationPolicySafe:true,routinePolicySafe:true,ownerPolicySafe:true,crossDatabaseConnect:[],
  databaseCreate:{buyer_writer_runtime:false},databaseTemporary:{buyer_writer_runtime:false},pgNet:[],
 };
}
function fixture(modify=()=>{}){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-preflight-v3-'));fs.chmodSync(directory,0o700);
 const paths={directory,release:path.join(directory,'release.json'),catalog:path.join(directory,'catalog.json'),
  gateway:path.join(directory,'gateway.json'),management:path.join(directory,'management.json'),
  claims:path.join(directory,'claims'),installer:path.join(directory,'install.sql'),
  provisioner:path.join(directory,'provisioner.js'),verifier:path.join(directory,'verifier.js')};
 fs.mkdirSync(paths.claims,{mode:0o700});
 for(const [name,source] of Object.entries({installer:'packages/buyer-writer/sql/install.sql',
  provisioner:'packages/buyer-writer/production-provisioner.js',verifier:'packages/buyer-writer/production-verifier.js'}))
  fs.copyFileSync(path.join(repo,source),paths[name]),fs.chmodSync(paths[name],0o600);
 write(paths.gateway,'{"version":3,"secret":"gateway"}',0o640);
 write(paths.management,'{"password":"protected"}');
 const artifacts=Object.fromEntries(['installer','provisioner','verifier'].map(name=>[
  name,{path:paths[name],sha256:sha(fs.readFileSync(paths[name]))},
 ]));
 const after=projectedObservation(),before=structuredClone(after);before.roles[0].login=false;
 const target={environment:'production',host:'db.example.supabase.co',port:5432,database:'postgres',
  actor:'postgres',creatorOid:10,serverMajor:17};
 const release={version:2,releaseSha:'a'.repeat(40),nonce:randomBytes(32).toString('hex'),target,artifacts,
  configDigests:{gateway:sha(fs.readFileSync(paths.gateway)),management:sha(fs.readFileSync(paths.management))},
  canonicalObservationSha256:sha(Buffer.from(canonical(after)))};
 write(paths.release,release);
 const catalog={version:2,capturedAt:'2026-09-18T01:58:00.000Z',releaseSha:release.releaseSha,nonce:release.nonce,
  target:structuredClone(target),releaseManifestSha256:sha(fs.readFileSync(paths.release)),
  artifactHashes:Object.fromEntries(Object.entries(artifacts).map(([name,row])=>[name,row.sha256])),
  baselineObservation:before,projectedObservation:after};
 write(paths.catalog,catalog);
 const state={paths,release,catalog};modify(state);
 const options={mode:'apply',releaseManifestPath:paths.release,catalogSnapshotPath:paths.catalog,
  gatewayConfigPath:paths.gateway,managementConfigPath:paths.management,nonceClaimDirectory:paths.claims,
  now:()=>new Date('2026-09-18T02:00:00.000Z')};
 return {paths,state,options,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
const reject=options=>assert.throws(()=>validateBuyerWriterProductionPlan(options),
 error=>error.message==='Buyer writer production preflight failed');

test('validates offline inputs but explicitly establishes neither readiness nor reversibility',()=>{
 const f=fixture();try{
  const result=validateBuyerWriterProductionPlan(f.options);
  assert.equal(result.status,'OFFLINE_INPUTS_VALIDATED');
  assert.equal(result.productionReadinessEstablished,false);
  assert.equal(result.executionClassification,'IRREVERSIBLE_FORWARD_ONLY');
  assert.equal(result.executed,false);assert.equal(result.connectionAttempted,false);
  assert.deepEqual(result.limitations,
   ['no production connection','no production identity attestation','no reversible restore established']);
  assert.match(result.configs.gateway.sha256,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('protected'),false);
 }finally{f.cleanup();}
});
test('rejects omission or mutation across every complete observation field family',()=>{
 const mutations=[
  o=>delete o.roles[0].superuser,
  o=>delete o.memberships[0].grantorSuperuser,
  o=>delete o.schema.owner,
  o=>delete o.relations[0].owner,
  o=>delete o.relations[0].rlsEnabled,
  o=>delete o.relations[0].columns[0].type,
  o=>delete o.relations[0].columns[0].default,
  o=>delete o.relations[0].constraints[0].definition,
  o=>delete o.relations[0].indexes[0].definition,
  o=>delete o.relations[0].edges,
  o=>delete o.types[0].owner,
  o=>delete o.routines[0].digest,
  o=>delete o.routines[0].owner,
  o=>delete o.routines[0].securityDefiner,
  o=>delete o.routines[0].config,
  o=>delete o.routines[0].volatility,
  o=>delete o.routines[0].language,
  o=>delete o.routines[0].result,
  o=>delete o.routines[0].argumentNames,
  o=>delete o.defaultPrivileges[0].edges,
  o=>delete o.extensions[0].owner,
  o=>delete o.databasePrivileges[0].temporary,
  o=>delete o.databaseCreate,
  o=>delete o.targetPublicColumns,
 ];
 for(const mutate of mutations){
  const f=fixture(state=>{mutate(state.catalog.projectedObservation);write(state.paths.catalog,state.catalog);});
  try{reject(f.options);}finally{f.cleanup();}
 }
});

test('rejects stale, future, invalid clock and every binding mismatch',()=>{
 const changes=[
  state=>{state.catalog.capturedAt='2026-09-18T01:54:59.000Z';},
  state=>{state.catalog.capturedAt='2026-09-18T02:00:31.000Z';},
  state=>{state.catalog.nonce='b'.repeat(64);},
  state=>{state.catalog.releaseSha='b'.repeat(40);},
  state=>{state.catalog.target.creatorOid=999;},
  state=>{state.catalog.artifactHashes.verifier='0'.repeat(64);},
  state=>{state.catalog.releaseManifestSha256='0'.repeat(64);},
 ];
 for(const change of changes){const f=fixture(state=>{change(state);write(state.paths.catalog,state.catalog);});
  try{reject(f.options);}finally{f.cleanup();}}
 for(const now of [()=>new Date('invalid'),()=>({getTime:()=>0}),()=>new Date(Infinity)]){
  const f=fixture();try{reject({...f.options,now});}finally{f.cleanup();}
 }
});
test('secure-open config digests reject content changes, mode drift and symlink swaps',()=>{
 const cases=[
  state=>fs.appendFileSync(state.paths.gateway,'x'),
  state=>fs.appendFileSync(state.paths.management,'x'),
  state=>fs.chmodSync(state.paths.gateway,0o600),
  state=>fs.chmodSync(state.paths.management,0o640),
  state=>{const real=state.paths.gateway+'.real';fs.renameSync(state.paths.gateway,real);fs.symlinkSync(real,state.paths.gateway);},
 ];
 for(const change of cases){const f=fixture(change);try{reject(f.options);}finally{f.cleanup();}}
});

test('authenticates verifier bytes before use and rejects any artifact tamper',()=>{
 for(const name of ['installer','provisioner','verifier']){
  const f=fixture(state=>fs.appendFileSync(state.paths[name],'\n// tampered'));
  try{reject(f.options);}finally{f.cleanup();}
 }
});

test('rejects replay, fake executors and every restore/reversible claim',()=>{
 const f=fixture();try{
  assert.equal(validateBuyerWriterProductionPlan(f.options).status,'OFFLINE_INPUTS_VALIDATED');
  reject(f.options);
 }finally{f.cleanup();}
 for(const extra of [{executor:async()=>({safe:true})},{restoreArtifactPath:'/tmp/fake'},{reversible:true}]){
  const x=fixture();try{reject({...x.options,...extra});}finally{x.cleanup();}
 }
});

test('CLI emits redacted 0600 evidence and refuses executor, restore and connect switches',()=>{
 const f=fixture();const evidence=path.join(f.paths.directory,'evidence.json');
 try{
  f.state.catalog.capturedAt=new Date().toISOString();write(f.paths.catalog,f.state.catalog);
  const cli=path.join(repo,'scripts/preflight-buyer-writer-production.mjs');
  const args=[cli,'--mode','verify','--release-manifest',f.paths.release,'--catalog-snapshot',f.paths.catalog,
   '--gateway-config',f.paths.gateway,'--management-config',f.paths.management,
   '--nonce-claim-dir',f.paths.claims,'--output',evidence];
  const result=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);assert.equal(report.status,'OFFLINE_INPUTS_VALIDATED');
  assert.equal(report.productionReadinessEstablished,false);
  assert.equal(report.executionClassification,'IRREVERSIBLE_FORWARD_ONLY');
  assert.equal(fs.statSync(evidence).mode&0o777,0o600);
  for(const flag of ['--executor','--restore-artifact','--connect']){
   const denied=spawnSync(process.execPath,[cli,flag,'true'],{encoding:'utf8'});
   assert.notEqual(denied.status,0);assert.match(denied.stderr,/did not establish production readiness/);
  }
 }finally{f.cleanup();}
});
