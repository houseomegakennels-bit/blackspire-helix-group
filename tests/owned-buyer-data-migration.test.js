import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNED_BUYER_RELATIONS,OWNED_BUYER_COPY_ORDER,OWNED_BUYER_FOREIGN_KEYS,prepareOwnedBuyerMigrationExecution,executeOwnedBuyerMigration} from '../packages/buyer-writer/owned-data-migration.js';
const h='a'.repeat(64);
function input(){return {releaseSha:'b'.repeat(40),source:{clusterId:'1234567890123456789',database:'postgres',snapshotId:'00000001-00000002-1',snapshotDigest:h,quiescenceDigest:h},
 target:{kind:'owned-postgres-v1',clusterId:'2234567890123456789',database:'postgres',profileDigest:h,schemaDigest:h},rollbackDigest:h,
 inventory:{schemaDigest:h,relations:OWNED_BUYER_RELATIONS.map(name=>({schema:'public',name,owner:'postgres',rls:true,forceRls:false,primaryKey:['id'],rowCount:1,dataDigest:h,definitionDigest:h})),foreignKeys:OWNED_BUYER_FOREIGN_KEYS.map(([from,column,to,onDelete],index)=>({name:`fk_${index}`,from,to,columns:[column],referencedColumns:['id'],onDelete,definitionDigest:h})),dependencies:[{kind:'function',identity:'auth.uid()',definitionDigest:h}]}};}
function fixture(data){
 const events=[];let intent=null,receipt=null,staged=null,rows=[],pending=[];
 const host={async acquireFence(){events.push('fence');},async releaseFence(){events.push('release');},
  async observe(){events.push('observe');return {...structuredClone(data),releaseSha:undefined};},
  async readIntent(){return intent;},async writeIntent(value){events.push('intent');intent=structuredClone(value);},async readReceipt(){return receipt;},
  async begin(){events.push('begin');pending=[];},async copyRelation(row,options){assert.equal(options.preserveIds,true);assert.equal(options.snapshotId,data.source.snapshotId);events.push(`copy:${row.name}`);pending.push(row.name);},
  async verifyTarget(expected,mode){events.push('verify');assert.equal(expected.relations.length,6);if(mode.empty)assert.equal(rows.length,0);else assert.deepEqual(mode.committed?rows:pending,OWNED_BUYER_COPY_ORDER);},
  async writeReceipt(value){events.push('receipt');staged=structuredClone(value);},async commit(){events.push('commit');rows=pending;receipt=staged;},async rollback(){events.push('rollback');pending=[];staged=null;}};
 host.observe=async()=>{events.push('observe');const {releaseSha,...rest}=structuredClone(data);return {...rest,soleWriter:'NONE',sourceWritesDisabled:true,destinationWritesDisabled:true};};
 return {host,events,get rows(){return rows;},get receipt(){return receipt;},set receipt(value){receipt=value;}};
}
test('planner binds complete six-table closure and excludes unknown/auth credential dependencies',()=>{
 const good=input();assert.equal(prepareOwnedBuyerMigrationExecution(good).kind,'owned-buyer-data-migration-v1');
 for(const mutate of [v=>v.inventory.relations.pop(),v=>v.inventory.foreignKeys.pop(),v=>v.inventory.foreignKeys[4].onDelete='NO ACTION',v=>v.inventory.relations[0].rls=false,v=>v.inventory.relations[0].primaryKey=['other'],v=>v.inventory.relations[0].rowCount=-1,
 v=>v.target.clusterId=v.source.clusterId,v=>v.target.schemaDigest='c'.repeat(64),v=>v.inventory.dependencies.push({kind:'table',identity:'auth.users',definitionDigest:h}),
 v=>v.inventory.foreignKeys.push({name:'outside',from:'exports',to:'auth.users',columns:['user_id'],referencedColumns:['id'],definitionDigest:h}),v=>v.credentials='not-accepted']){
  const bad=structuredClone(good);mutate(bad);assert.throws(()=>prepareOwnedBuyerMigrationExecution(bad));
 }
});
test('copy retains IDs and receipt is committed with all rows; caller changes cannot rewrite opaque plan',async()=>{
 const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(structuredClone(data));data.inventory.relations.pop();
 const result=await executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'});assert.equal(result.status,'OWNED_BUYER_DATA_COMMITTED');assert.equal(result.productionAcceptance,false);
 assert.deepEqual(f.rows,OWNED_BUYER_COPY_ORDER);assert.ok(f.events.indexOf('intent')<f.events.indexOf('begin'));assert.ok(f.events.indexOf('receipt')<f.events.indexOf('commit'));
 assert.equal(f.events.filter(e=>e==='observe').length,2);assert.equal(f.events.at(-1),'release');
});
test('quiescence, snapshot and profile drift reject before intent or roll back before commit',async()=>{
 for(const late of [false,true])for(const change of [v=>v.soleWriter='SOURCE',v=>v.sourceWritesDisabled=false,v=>v.target.profileDigest='c'.repeat(64),v=>v.source.snapshotId='changed']){
  const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(data),observe=f.host.observe;let count=0;
  f.host.observe=async()=>{const value=await observe();if(++count===(late?2:1))change(value);return value;};
  await assert.rejects(executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'}));assert.equal(f.receipt,null);assert.equal(f.events.includes('commit'),false);
  assert.equal(f.events.includes('intent'),late);assert.equal(f.events.includes('rollback'),late);
 }
});
test('partial copy failure rolls back; retained intent denies redispatch',async()=>{
 const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(data);let count=0;
 f.host.copyRelation=async()=>{count++;throw new Error('driver details must not escape');};
 await assert.rejects(executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'}),error=>error.code==='MIGRATION_FAILED'&&!error.message.includes('driver details'));
 assert.ok(f.events.includes('rollback'));assert.equal((await executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'})).status,'OWNED_BUYER_DATA_OUTCOME_UNKNOWN');assert.equal(count,1);
});
test('lost commit acknowledgement reconciles atomic receipt without recopy or recommit',async()=>{
 const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(data),commit=f.host.commit;
 f.host.commit=async()=>{await commit();throw new Error('lost connection');};
 await assert.rejects(executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'}),error=>error.code==='OUTCOME_UNKNOWN');
 const count=f.events.filter(e=>e.startsWith('copy:')).length;
 assert.equal((await executeOwnedBuyerMigration({plan,host:f.host,mode:'reconcile'})).status,'OWNED_BUYER_DATA_RECONCILED');
 assert.equal(f.events.filter(e=>e.startsWith('copy:')).length,count);assert.equal(f.events.filter(e=>e==='commit').length,1);
 f.receipt.manifestDigest='f'.repeat(64);await assert.rejects(executeOwnedBuyerMigration({plan,host:f.host,mode:'reconcile'}));
});
test('unknown outcome with no receipt never starts a transaction on reconciliation',async()=>{
 const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(data);
 assert.equal((await executeOwnedBuyerMigration({plan,host:f.host,mode:'reconcile'})).status,'OWNED_BUYER_DATA_OUTCOME_UNKNOWN');assert.equal(f.events.includes('begin'),false);
 await assert.rejects(executeOwnedBuyerMigration({plan:{...plan},host:f.host,mode:'apply'}));
});
test('JSONB object-key ordering does not invalidate the same atomic receipt',async()=>{
 const data=input(),plan=prepareOwnedBuyerMigrationExecution(data),f=fixture(data);
 await executeOwnedBuyerMigration({plan,host:f.host,mode:'apply'});
 const reorder=value=>Array.isArray(value)?value.map(reorder):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).reverse().map(key=>[key,reorder(value[key])])):value;
 f.receipt=reorder(f.receipt);
 assert.equal((await executeOwnedBuyerMigration({plan,host:f.host,mode:'reconcile'})).status,'OWNED_BUYER_DATA_RECONCILED');
});
