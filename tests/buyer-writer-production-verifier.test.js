import test from 'node:test';
import assert from 'node:assert/strict';
import {
 BUYER_WRITER_ADMISSION_ROUTINES,BUYER_WRITER_ISSUER_ROUTINES,BUYER_WRITER_PG_NET_FUNCTIONS,BUYER_WRITER_PRODUCTION_VERIFY_SQL,
 BUYER_WRITER_ROUTINES,BUYER_WRITER_RUNTIME_ROUTINES,observeBuyerWriterProductionState,
 verifyBuyerWriterProductionEvidence,
} from '../packages/buyer-writer/production-verifier.js';
import {BUYER_WRITER_ROUTINES as ROUTINE_POLICY} from '../packages/buyer-writer/routine-policy.js';

const role=name=>({name,login:['buyer_writer_runtime','buyer_writer_issuer'].includes(name),inherit:false,superuser:false,createDb:false,
 createRole:false,replication:false,bypassRls:false});
const creatorOid=16388,ownerOid='16390';
const acl=(grantee,privilege,grantable,grantor='buyer_writer_owner')=>({grantor,grantee,privilege,grantable});
const fixture=()=>({
 roles:['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission'].map(role),
 memberships:[
  {role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(creatorOid),grantor:'postgres',grantorOid:String(creatorOid),memberLogin:true,grantorSuperuser:false,admin:false,inherit:false,set:true},
  {role:'buyer_writer_owner',roleOid:ownerOid,member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_runtime',roleOid:'16391',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_issuer',roleOid:'16392',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_admission',roleOid:'16393',member:'postgres',memberOid:String(creatorOid),grantor:'fixture_admin',grantorOid:'10',memberLogin:true,grantorSuperuser:true,admin:true,inherit:false,set:false},
  {role:'buyer_writer_admission',roleOid:'16393',member:'buyer_writer_admission_login',memberOid:'16394',grantor:'postgres',grantorOid:String(creatorOid),memberLogin:true,grantorSuperuser:false,admin:false,inherit:false,set:true},
 ],
 schema:{name:'buyer_writer',owner:'buyer_writer_owner',edges:[acl('buyer_writer_owner','CREATE',false),
  acl('buyer_writer_owner','USAGE',false),acl('buyer_writer_runtime','USAGE',false),acl('buyer_writer_issuer','USAGE',false),acl('buyer_writer_admission','USAGE',false)]},
 routines:BUYER_WRITER_ROUTINES.map(signature=>{
  const policy=ROUTINE_POLICY.find(value=>value.signature===signature),creator=policy.owner==='creator';
  const runtime=BUYER_WRITER_RUNTIME_ROUTINES.includes(signature),issuer=BUYER_WRITER_ISSUER_ROUTINES.includes(signature),admission=BUYER_WRITER_ADMISSION_ROUTINES.includes(signature);
  const owner=creator?'postgres':'buyer_writer_owner',grantor=owner;
  return {signature,owner,ownerOid:creator?String(creatorOid):ownerOid,securityDefiner:policy.securityDefiner,
   language:policy.language,digest:policy.digest,config:[...policy.config],volatility:policy.volatility,kind:'f',strict:false,leakproof:false,parallel:'u',
   argumentNames:[...policy.arguments],result:policy.result,argumentDefaults:0,returnsSet:false,variadic:'0',hasAllArgumentTypes:false,hasArgumentModes:false,
   edges:[acl(owner,'EXECUTE',false,grantor),...(signature==='buyer_writer.lock_public_scope()'?[acl('buyer_writer_owner','EXECUTE',false,grantor)]:[]),
    ...(runtime?[acl('buyer_writer_runtime','EXECUTE',false,grantor)]:[]),...(issuer?[acl('buyer_writer_issuer','EXECUTE',false,grantor)]:[]),
    ...(admission?[acl('buyer_writer_admission','EXECUTE',false,grantor)]:[])],
   runtimeExecute:runtime,runtimeGrant:false,issuerExecute:issuer,issuerGrant:false,admissionExecute:admission,admissionGrant:false};
 }),
 targetRelations:['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob'],targetPublicRelations:[],targetPublicColumns:[],directRelations:[],directSequences:[],schemaCreate:[],externalRoutines:[],
 bootstrapSuperuser:true,creatorOid:String(creatorOid),relationPolicySafe:true,routinePolicySafe:true,ownerPolicySafe:true,crossDatabaseConnect:[],
 databaseCreate:{buyer_writer_owner:false,buyer_writer_runtime:false,buyer_writer_issuer:false,buyer_writer_admission:false},
 pgNet:BUYER_WRITER_PG_NET_FUNCTIONS.map(name=>({name,signature:`net.${name}()`,owner:'supabase_admin',
  publicExecute:true,ownerExecute:true,runtimeExecute:true,issuerExecute:true,admissionExecute:true})),
});
const denied=raw=>assert.throws(()=>verifyBuyerWriterProductionEvidence(raw,creatorOid),
 error=>error.message==='Buyer writer production verification failed');

test('fixed verifier accepts exact security state and reports provider truth without force-pass',()=>{
 const evidence=verifyBuyerWriterProductionEvidence(fixture(),creatorOid);
 assert.equal(evidence.compliant,true);
 assert.equal(evidence.unexpectedMembershipCount,0);
 assert.equal(evidence.targetTablePublicPrivilegeCount,0);
 assert.equal(evidence.targetColumnPublicPrivilegeCount,0);
 assert.equal(evidence.directTableAccessDenied,true);
 assert.equal(evidence.crossRoutineAccessDenied,true);
 assert.deepEqual(evidence.pgNetTruth,{functionCount:12,publicExecuteCount:12,ownerEffectiveExecuteCount:12,
  runtimeEffectiveExecuteCount:12,issuerEffectiveExecuteCount:12,supabaseAclFixed:false,providerAcl:'DEFENSE_IN_DEPTH_OPEN'});
 const closed=fixture();for(const row of closed.pgNet)Object.assign(row,{publicExecute:false,ownerExecute:false,runtimeExecute:false,issuerExecute:false});
 assert.equal(verifyBuyerWriterProductionEvidence(closed,creatorOid).pgNetTruth.supabaseAclFixed,true);
});

test('catalog query ignores only inert bootstrap-owned template1 CONNECT',()=>{
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/datname='template1'[\s\S]*datistemplate[\s\S]*datdba=10[\s\S]*'CREATE'[\s\S]*'TEMP'/);
});

test('fixed verifier rejects unsafe role flags, absence and unexpected memberships',()=>{
 for(const mutation of [
  value=>{value.roles[1].login=false;},value=>{value.roles[2].inherit=true;},value=>{value.roles[0].superuser=true;},
  value=>{value.roles.pop();},value=>{value.roles[0]={...value.roles[1]};},
  value=>{value.bootstrapSuperuser=false;},value=>{value.memberships[0].admin=true;},
  value=>{value.memberships.push({role:'broad_admin',member:'buyer_writer_runtime',grantor:'postgres',admin:false,inherit:true,set:true});},
  value=>{value.memberships[2].set=true;},
 ]){const value=fixture();mutation(value);denied(value);}
});

test('fixed verifier rejects routine widening, external SECURITY DEFINER access and incomplete catalogs',()=>{
 for(const mutation of [
  value=>{value.routines.find(row=>row.signature.includes('.issue(')).runtimeExecute=true;},
  value=>{value.routines.find(row=>row.signature.includes('.apply(')).issuerExecute=true;},
  value=>{value.routines.find(row=>row.signature.includes('.apply(')).runtimeGrant=true;},
  value=>{value.routines.find(row=>row.signature.includes('.apply(')).argumentNames.reverse();},
  value=>{value.routines.find(row=>row.signature.includes('.apply(')).edges.push(acl('PUBLIC','EXECUTE',false));},
  value=>{value.externalRoutines.push({role:'buyer_writer_runtime',schema:'public',signature:'public.admin_bridge(text)',owner:'postgres'});},
  value=>{value.routines.pop();},value=>{value.schema.edges.pop();},
 ]){const value=fixture();mutation(value);denied(value);}
});

test('fixed verifier rejects direct relation, sequence, schema and database authority',()=>{
 for(const mutation of [
  value=>{value.targetPublicRelations.push({schema:'public',name:'SearchJob',privilege:'SELECT'});},
  value=>{value.targetRelations.pop();},
  value=>{value.targetPublicColumns.push({schema:'public',name:'SearchJob',column:'user_id',privilege:'UPDATE'});},
  value=>{value.directRelations.push({role:'buyer_writer_runtime',schema:'public',name:'Buyer','kind':'r',select:true});},
  value=>{value.directRelations.push({role:'buyer_writer_runtime',schema:'public',name:'Buyer','kind':'r',anyColumn:true});},
  value=>{value.directSequences.push({role:'buyer_writer_issuer',schema:'public',name:'ids',select:false,update:false,usage:true});},
  value=>{value.schemaCreate.push({role:'buyer_writer_runtime',schema:'public'});},
  value=>{value.databaseCreate.buyer_writer_issuer=true;},
 ]){const value=fixture();mutation(value);denied(value);}
});

test('pg_net observation must contain each expected function exactly once with typed truth',()=>{
 for(const mutation of [value=>{value.pgNet.pop();},value=>{value.pgNet[0].name=value.pgNet[1].name;},
  value=>{value.pgNet[0].signature=null;},value=>{value.pgNet[0].publicExecute='yes';}]){
  const value=fixture();mutation(value);denied(value);
 }
 const absent=fixture();Object.assign(absent.pgNet[0],{signature:null,owner:null,publicExecute:false,ownerExecute:false,runtimeExecute:false,issuerExecute:false,admissionExecute:false});
 assert.equal(verifyBuyerWriterProductionEvidence(absent,creatorOid).pgNetTruth.functionCount,11);
});

test('observer binds only creator OID and reviewed routine policy to one fixed statement and sanitizes failure',async()=>{
 const calls=[];
 const result=await observeBuyerWriterProductionState(async(text,values)=>{calls.push([text,values]);return{rows:[{evidence:fixture()}]};},creatorOid);
 assert.equal(result.compliant,true);assert.equal(calls[0][0],BUYER_WRITER_PRODUCTION_VERIFY_SQL);assert.equal(calls[0][1][0],creatorOid);assert.equal(JSON.parse(calls[0][1][1]).length,BUYER_WRITER_ROUTINES.length);
 await assert.rejects(()=>observeBuyerWriterProductionState(async()=>({rows:[]}),creatorOid),
  error=>error.message==='Buyer writer production verification failed');
 await assert.rejects(()=>observeBuyerWriterProductionState(async()=>{throw new Error('password=do-not-leak');},creatorOid),
  error=>error.message==='Buyer writer production verification failed');
});

test('catalog statement is read-only and cannot expose credential material',()=>{
 assert.doesNotMatch(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/pg_authid|rolpassword|password|credential|current_setting/iu);
 assert.doesNotMatch(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/(?:^|;)\s*(insert|update|delete|alter|create|drop|grant|revoke|call)\b/iu);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/directRelations/);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/targetPublicRelations/);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/targetPublicColumns/);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/externalRoutines/);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/p\.prosecdef/);
 assert.match(BUYER_WRITER_PRODUCTION_VERIFY_SQL,/publicExecute/);
});
