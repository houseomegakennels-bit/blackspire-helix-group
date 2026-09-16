import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
 BUYER_WRITER_ISSUER_ROUTINES,BUYER_WRITER_PG_NET_FUNCTIONS,BUYER_WRITER_PRODUCTION_VERIFY_SQL,
 BUYER_WRITER_ROUTINES,BUYER_WRITER_RUNTIME_ROUTINES,
} from '../packages/buyer-writer/production-verifier.js';
import {BUYER_WRITER_INSTALLER_SHA256,provisionBuyerWriterProduction} from '../packages/buyer-writer/production-provisioner.js';
import {BUYER_WRITER_ROUTINES as ROUTINE_POLICY} from '../packages/buyer-writer/routine-policy.js';

const runtimeSecret='runtime-password-never-disclose';
const issuerSecret='issuer-password-never-disclose';
const managementSecret='management-password-never-disclose';
const ca='-----BEGIN CERTIFICATE-----\nfixture-only\n-----END CERTIFICATE-----\n';
const identity=(gid,mode)=>({uid:0,gid,mode,nlink:1,size:100,dev:1,ino:gid+10,mtimeMs:1,ctimeMs:1});
const gateway={version:2,workspace:'blackspire-command',socketPath:'/run/blackspire/buyer-writer.sock',
 gatewayCapability:'a'.repeat(43),creatorOid:16384,authority:{releaseSha:'a'.repeat(40),operationId:'01234567-89ab-cdef-0123-456789abcdef',
  attemptId:'11234567-89ab-cdef-0123-456789abcdef',workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'},
 runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:runtimeSecret,ca},
 issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:issuerSecret,ca}};
const management={host:gateway.runtime.host,password:managementSecret,ca};
const ownerOid='16390';
const acl=(grantee,privilege,grantable=false,grantor='buyer_writer_owner')=>({grantor,grantee,privilege,grantable});
const evidence=()=>({
 roles:['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer'].map(name=>({name,login:name!=='buyer_writer_owner',inherit:false,
  superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false})),
 memberships:[{role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(gateway.creatorOid),grantor:'postgres',grantorOid:String(gateway.creatorOid),admin:false,inherit:false,set:true},
  {role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(gateway.creatorOid),grantor:'fixture_admin',grantorOid:'10',admin:true,inherit:false,set:false},
  {role:'buyer_writer_runtime',roleOid:'16391',member:'postgres',memberOid:String(gateway.creatorOid),grantor:'fixture_admin',grantorOid:'10',admin:true,inherit:false,set:false},
  {role:'buyer_writer_issuer',roleOid:'16392',member:'postgres',memberOid:String(gateway.creatorOid),grantor:'fixture_admin',grantorOid:'10',admin:true,inherit:false,set:false}],
 schema:{name:'buyer_writer',owner:'buyer_writer_owner',edges:[acl('buyer_writer_owner','CREATE'),acl('buyer_writer_owner','USAGE'),
  acl('buyer_writer_runtime','USAGE'),acl('buyer_writer_issuer','USAGE')]},
 routines:BUYER_WRITER_ROUTINES.map(signature=>{const policy=ROUTINE_POLICY.find(value=>value.signature===signature),creator=policy.owner==='creator';
  const runtime=BUYER_WRITER_RUNTIME_ROUTINES.includes(signature),issuer=BUYER_WRITER_ISSUER_ROUTINES.includes(signature),owner=creator?'postgres':'buyer_writer_owner';
  return {signature,owner,ownerOid:creator?String(gateway.creatorOid):ownerOid,securityDefiner:policy.securityDefiner,
   language:policy.language,digest:policy.digest,config:[...policy.config],volatility:policy.volatility,kind:'f',strict:false,leakproof:false,parallel:'u',
   argumentNames:[...policy.arguments],result:policy.result,argumentDefaults:0,returnsSet:false,variadic:'0',hasAllArgumentTypes:false,hasArgumentModes:false,
   edges:[acl(owner,'EXECUTE',false,owner),...(signature==='buyer_writer.lock_public_scope()'?[acl('buyer_writer_owner','EXECUTE',false,owner)]:[]),
    ...(runtime?[acl('buyer_writer_runtime','EXECUTE',false,owner)]:[]),...(issuer?[acl('buyer_writer_issuer','EXECUTE',false,owner)]:[])],
   runtimeExecute:runtime,runtimeGrant:false,issuerExecute:issuer,issuerGrant:false};}),
 targetRelations:['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob'],targetPublicRelations:[],targetPublicColumns:[],directRelations:[],directSequences:[],schemaCreate:[],externalRoutines:[],
 creatorOid:String(gateway.creatorOid),relationPolicySafe:true,routinePolicySafe:true,ownerPolicySafe:true,crossDatabaseConnect:[],
 databaseCreate:{buyer_writer_owner:false,buyer_writer_runtime:false,buyer_writer_issuer:false},
 pgNet:BUYER_WRITER_PG_NET_FUNCTIONS.map(name=>({name,signature:`net.${name}()`,owner:'supabase_admin',publicExecute:true,
  ownerExecute:true,runtimeExecute:true,issuerExecute:true})),
});

function harness({exists=false,login=exists,compliant=exists,authWorks=exists,authority=true,drift=false,readinessFailure=false,journalFailure,
 commitFailure=false}={}){
 const state={exists,ownerLogin:false,runtimeLogin:login,issuerLogin:login,compliant,authWorks,failClosed:0,commitFailures:commitFailure?1:0};
 const calls=[],journals=[],clients=[];let gatewayReads=0;
 const roles=()=>['buyer_writer_issuer','buyer_writer_owner','buyer_writer_runtime'].map(name=>({name,exists:state.exists,
  login:state.exists&&(name==='buyer_writer_owner'?state.ownerLogin:name==='buyer_writer_runtime'?state.runtimeLogin:state.issuerLogin),
  inherit:false,superuser:false,createDb:false,createRole:false,replication:false,bypassRls:false}));
 const readSnapshot=filename=>{
  if(filename.includes('gateway')){gatewayReads++;return {value:structuredClone(gateway),identity:{...identity(44,0o640),mtimeMs:drift&&gatewayReads>1?2:1}};}
  return {value:structuredClone(management),identity:identity(0,0o600)};
 };
 const connect=async()=>{
  const client={ended:false,async query(text,values=[]){calls.push({text,values,client});
    if(text.includes("current_setting('server_version_num')"))return {rows:authority?[{actor:'postgres',creatorOid:16384,database:'postgres',version:170006,
      superuser:false,createDb:true,createRole:true,replication:true,bypassRls:true}]:[{actor:'postgres',creatorOid:16384,database:'postgres',version:170006,
      superuser:false,createDb:true,createRole:false,replication:true,bypassRls:true}]};
    if(text.includes('pg_try_advisory_lock'))return {rows:[{acquired:true}]};
    if(text.includes('pg_advisory_unlock'))return {rows:[{released:true}]};
    if(text.includes('wanted.name')){if(readinessFailure)throw new Error(`catalog ${managementSecret}`);return {rows:[{roles:roles()}]};}
    if(text===BUYER_WRITER_PRODUCTION_VERIFY_SQL)return {rows:[{evidence:state.compliant?evidence():{}}]};
    if(text.startsWith('-- Explicitly installed')){assert.equal(createHash('sha256').update(text).digest('hex'),BUYER_WRITER_INSTALLER_SHA256);
      assert.ok(calls.some(row=>row.text?.includes("set_config('blackspire.buyer_writer_creator_oid'")&&row.values?.[0]==='16384'));
      state.exists=true;state.ownerLogin=state.runtimeLogin=state.issuerLogin=false;state.compliant=false;return {rows:[]};}
    if(text.includes('blackspire_fail_closed')){state.ownerLogin=state.runtimeLogin=state.issuerLogin=false;state.compliant=false;state.failClosed++;return {rows:[]};}
    if(text.includes('count(*)::int as count'))return {rows:[{count:Number(state.runtimeLogin||state.issuerLogin)}]};
    if(text.includes("current_setting('log_duration')"))return {rows:[{safe:true}]};
    if(text.startsWith('select pg_temp.blackspire_bind')){assert.ok(values[0].startsWith('buyer_writer_'));assert.ok([runtimeSecret,issuerSecret].includes(values[1]));return {rows:[]};}
    if(text.startsWith('alter role buyer_writer_owner')){state.ownerLogin=false;state.runtimeLogin=state.issuerLogin=true;state.compliant=true;state.authWorks=true;return {rows:[]};}
    if(text==='commit'&&state.commitFailures-->0)throw new Error(`commit error ${managementSecret}`);
    return {rows:[]};
   },async end(){this.ended=true;}};clients.push(client);return client;
 };
 const authenticate=async kind=>{calls.push({authenticate:kind});if(!state.authWorks)throw new Error(`auth ${kind} ${runtimeSecret}`);};
 const writeJournal=value=>{journals.push(value);if(value.phase===journalFailure)throw new Error(`journal ${managementSecret}`);return value;};
 return {state,calls,journals,clients,options:{managementConfigPath:'/var/lib/blackspire-operator/management.json',
  readSnapshot,lookupWriterGroup:()=> 'blackspire-writer:x:44:',connect,authenticate,writeJournal}};
}

test('protected input and management authority failures are sanitized and non-mutating',async()=>{
 const missing=harness();missing.options.readSnapshot=()=>{throw new Error(`missing ${runtimeSecret}`);};
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'inspect',...missing.options}),
  error=>error.message==='Buyer writer production provisioning failed'&&!error.message.includes(runtimeSecret));
 const wrong=harness({authority:false});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'apply',...wrong.options}),/production provisioning failed/);
 assert.equal(wrong.state.failClosed,0);
});

test('absent roles install exact canonical SQL, bind only as parameters, verify, authenticate and journal',async()=>{
 const h=harness();const result=await provisionBuyerWriterProduction({mode:'apply',...h.options});
 assert.equal(result.status,'PROVISIONED');assert.equal(result.evidence.compliant,true);
 assert.equal(h.state.runtimeLogin,true);assert.equal(h.state.issuerLogin,true);assert.equal(h.state.ownerLogin,false);
 assert.deepEqual(h.journals.map(row=>[row.phase,row.status]),[['started','IN_PROGRESS'],['roles-disabled','IN_PROGRESS'],
  ['installer-committed','IN_PROGRESS'],['credential-transaction-started','IN_PROGRESS'],['verified-committed','COMPLETED']]);
 const queryText=h.calls.filter(row=>row.text).map(row=>row.text).join('\n');
 for(const secret of [runtimeSecret,issuerSecret,managementSecret])assert.equal(queryText.includes(secret),false);
 assert.equal(JSON.stringify(result).includes(runtimeSecret),false);
 assert.deepEqual(h.calls.filter(row=>row.authenticate).map(row=>row.authenticate),['runtime','issuer']);
});

test('second apply is authentication-proved idempotent and never rotates or journals',async()=>{
 const h=harness({exists:true});const result=await provisionBuyerWriterProduction({mode:'apply',...h.options});
 assert.equal(result.status,'ALREADY_COMPLIANT');assert.equal(result.idempotent,true);assert.deepEqual(h.journals,[]);
 assert.equal(h.calls.some(row=>row.text?.startsWith('-- Explicitly installed')),false);
 assert.equal(h.calls.some(row=>row.text?.startsWith('select pg_temp.blackspire_bind')),false);
});

test('explicit reconcile recovers a partial disabled install and rotates only there',async()=>{
 const h=harness({exists:true,login:false,compliant:false,authWorks:false});
 const result=await provisionBuyerWriterProduction({mode:'reconcile',...h.options});
 assert.equal(result.status,'PROVISIONED');assert.equal(h.state.runtimeLogin,true);assert.equal(h.state.issuerLogin,true);
 assert.ok(h.calls.some(row=>row.text?.startsWith('select pg_temp.blackspire_bind')));
 assert.equal(h.journals[0].mode,'reconcile');
});

test('apply refuses partial or unauthenticated roles and leaves both LOGIN disabled',async()=>{
 for(const options of [{exists:true,login:false,compliant:false,authWorks:false},{exists:true,login:true,compliant:true,authWorks:false}]){
  const h=harness(options);
  await assert.rejects(()=>provisionBuyerWriterProduction({mode:'apply',...h.options}),/production provisioning failed/);
  assert.equal(h.state.runtimeLogin,false);assert.equal(h.state.issuerLogin,false);assert.ok(h.state.failClosed>=1);
  assert.equal(JSON.stringify(h.journals).includes(runtimeSecret),false);
 }
});

test('verify failure and protected snapshot drift fail closed',async()=>{
 const invalid=harness({exists:true,login:true,compliant:false,authWorks:true});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'verify',...invalid.options}),/production provisioning failed/);
 assert.equal(invalid.state.runtimeLogin,false);assert.equal(invalid.state.issuerLogin,false);
 const drifted=harness({exists:true,login:true,compliant:true,authWorks:true,drift:true});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'verify',...drifted.options}),/production provisioning failed/);
 assert.equal(drifted.state.runtimeLogin,false);assert.equal(drifted.state.issuerLogin,false);
});

test('journal failure cannot prevent fail-close and errors disclose no secrets',async()=>{
 const h=harness({exists:true,login:true,compliant:false,journalFailure:'started'});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'apply',...h.options}),
  error=>!error.message.includes(runtimeSecret)&&!error.message.includes(managementSecret));
 assert.equal(h.state.runtimeLogin,false);assert.equal(h.state.issuerLogin,false);assert.ok(h.state.failClosed>=1);
});

test('catalog readiness failure is journaled only under lock and fails closed',async()=>{
 const h=harness({exists:true,login:true,readinessFailure:true});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'apply',...h.options}),/production provisioning failed/);
 assert.equal(h.state.runtimeLogin,false);assert.equal(h.state.issuerLogin,false);
 assert.deepEqual(h.journals.slice(-3).map(row=>row.phase),['started','roles-disabled','fail-closed']);
});

test('rollback disables roles even when its journal fails, and reports the safe degraded outcome',async()=>{
 const h=harness({exists:true,login:true,compliant:true,journalFailure:'started'});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'rollback',...h.options}),error=>error.rollbackSafe===true);
 assert.equal(h.state.runtimeLogin,false);assert.equal(h.state.issuerLogin,false);
 const clean=harness({exists:true,login:true,compliant:true});
 assert.equal((await provisionBuyerWriterProduction({mode:'rollback',...clean.options})).status,'LOGIN_DISABLED');
});

test('ambiguous fail-close commit reconnects and verifies disabled LOGIN state',async()=>{
 const h=harness({exists:true,login:true,compliant:false,commitFailure:true});
 await assert.rejects(()=>provisionBuyerWriterProduction({mode:'verify',...h.options}),/production provisioning failed/);
 assert.ok(h.clients.length>=3);assert.equal(h.state.runtimeLogin,false);assert.equal(h.state.issuerLogin,false);
});
