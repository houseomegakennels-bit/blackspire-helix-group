import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNED_BUYER_RELATIONS,OWNED_BUYER_FOREIGN_KEYS,prepareOwnedBuyerMigrationExecution,ownedBuyerMigrationReceipt} from '../packages/buyer-writer/owned-data-migration.js';
import {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest} from '../packages/buyer-writer/owned-postgres.js';
import {OWNED_DATABASE_IDENTITY_SQL} from '../packages/buyer-writer/database-profile.js';
import {prepareOwnedTargetHardening,executeOwnedTargetHardening,inspectOwnedTargetHardeningHistory,ownedTargetHardeningBody,OWNED_TARGET_HARDENING_CHECK_SQL,OWNED_TARGET_HARDENING_RECEIPT_SQL} from '../packages/buyer-writer/owned-target-hardening.js';
const h='a'.repeat(64);
function input(){return {releaseSha:'b'.repeat(40),source:{clusterId:'1234567890123456789',database:'postgres',snapshotId:'00000001-00000002-1',snapshotDigest:h,quiescenceDigest:h},
 target:{kind:'owned-postgres-v1',clusterId:'2234567890123456789',database:'postgres',profileDigest:h,schemaDigest:h},rollbackDigest:h,
 inventory:{schemaDigest:h,relations:OWNED_BUYER_RELATIONS.map(name=>({schema:'public',name,owner:'postgres',rls:true,forceRls:false,primaryKey:['id'],rowCount:1,dataDigest:h,definitionDigest:h})),foreignKeys:OWNED_BUYER_FOREIGN_KEYS.map(([from,column,to,onDelete],index)=>({name:`fk_${index}`,from,to,columns:[column],referencedColumns:['id'],onDelete,definitionDigest:h})),dependencies:[{kind:'function',identity:'auth.uid()',definitionDigest:h}]}};}

function setup(){
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'2234567890123456789',caSha256:h};
 const migration=input();migration.target.profileDigest=ownedPostgresProfileDigest(profile);
 const plan=prepareOwnedTargetHardening({releaseSha:migration.releaseSha,operationId:'11111111-1111-4111-8111-111111111111',profile,migration});
 const copy=structuredClone(ownedBuyerMigrationReceipt(prepareOwnedBuyerMigrationExecution(migration)));
 let receipt=null,staged=null,bodyCalls=0,loseCommit=false,badCheck=false;const events=[],calls=[];
 const client={async query(sql,args){calls.push(sql);
 if(sql===OWNED_DATABASE_IDENTITY_SQL)return{rows:[{systemIdentifier:profile.systemIdentifier,database:'postgres',actor:'postgres',creatorOid:profile.creatorOid,version:170006,recovery:false}]};
 if(sql.includes('AS safe FROM pg_class'))return{rows:[{safe:true}]};
 if(sql.includes('pg_try_advisory'))return{rows:[{acquired:true}]};
 if(sql.startsWith('SELECT receipt FROM owned_buyer_migration.copy_receipts'))return{rows:[{receipt:copy}]};
 if(sql.startsWith('SELECT to_regclass'))return{rows:[{present:receipt!==null}]};
 if(sql===OWNED_TARGET_HARDENING_RECEIPT_SQL)return{rows:receipt?[{receipt}]:[]};
 if(sql===OWNED_TARGET_HARDENING_CHECK_SQL)return{rows:[{evidence:{browserDenied:!badCheck,anonymousJobsDenied:true,boundedRolesNoWebMembership:true,inertWebRoles:true,ownReadPreserved:true}}]};
 if(sql===ownedTargetHardeningBody(plan)){bodyCalls++;return{rows:[]};}
 if(sql.startsWith('INSERT INTO owned_buyer_migration.hardening_receipts')){staged=JSON.parse(args[1]);return{rowCount:1};}
 if(sql==='COMMIT'){receipt=staged;if(loseCommit)throw Error('lost ACK');}
 return{rows:[]};}};
 const journal={events:()=>events,append:e=>events.push(structuredClone(e))};
 return{plan,client,journal,events,calls,copy,get bodyCalls(){return bodyCalls;},set loseCommit(v){loseCommit=v;},set badCheck(v){badCheck=v;}};
}
test('hardening applies only exact Buyer SQL inside six-table row-preserving transaction and commits receipt',async()=>{
 const f=setup();const r=await executeOwnedTargetHardening({...f,mode:'apply',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations});
 assert.equal(r.status,'OWNED_TARGET_HARDENING_VERIFIED');assert.equal(r.rowsPreserved,true);assert.equal(f.bodyCalls,1);
 const body=ownedTargetHardeningBody(f.plan);assert.equal((body.match(/EXCEPT ALL/g)||[]).length,12);assert.equal(body.includes('nexus_contacts'),false);
 assert.equal(inspectOwnedTargetHardeningHistory(f.events).result.status,'VERIFIED');
 await assert.rejects(executeOwnedTargetHardening({...f,mode:'apply',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations}));
});
test('lost commit ACK and repeated verification never replay SQL or duplicate terminal journal result',async()=>{
 const f=setup();f.loseCommit=true;await assert.rejects(executeOwnedTargetHardening({...f,mode:'apply',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations}));
 assert.equal(f.events.length,1);for(let i=0;i<2;i++)assert.equal((await executeOwnedTargetHardening({...f,mode:'reconcile',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations})).status,'OWNED_TARGET_HARDENING_VERIFIED');
 assert.equal(f.bodyCalls,1);assert.equal(f.events.length,2);
 const before=JSON.stringify(f.events);f.badCheck=true;await assert.rejects(executeOwnedTargetHardening({...f,mode:'reconcile',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations}));assert.equal(JSON.stringify(f.events),before);
});
test('copy mismatch and lost precommit attempt refuse replay and preserve unknown outcome',async()=>{
 const f=setup();f.copy.manifestDigest='f'.repeat(64);await assert.rejects(executeOwnedTargetHardening({...f,mode:'apply',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations}));assert.equal(f.bodyCalls,0);
 await assert.rejects(executeOwnedTargetHardening({...f,mode:'reconcile',fence:async()=>{}},{inspectSnapshot:async()=>f.copy.relations}));assert.equal(f.bodyCalls,0);
});
