import {createHash} from 'node:crypto';

export const OWNED_BUYER_RELATIONS=Object.freeze(['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob','exports']);
export const OWNED_BUYER_COPY_ORDER=Object.freeze(['SearchJob','BuyerProfile','RawSale','CleanSale','BuyerReport','exports']);
export const OWNED_BUYER_FOREIGN_KEYS=Object.freeze([
 ['BuyerReport','buyer_profile_id','BuyerProfile','NO ACTION'],['BuyerReport','search_job_id','SearchJob','NO ACTION'],
 ['CleanSale','search_job_id','SearchJob','NO ACTION'],['RawSale','search_job_id','SearchJob','NO ACTION'],['exports','search_job_id','SearchJob','CASCADE'],
].map(Object.freeze));
const plans=new WeakMap();
const fail=()=>{throw new Error('Owned Buyer data migration rejected');};
const hex=(value,length)=>typeof value==='string'&&new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keys=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...names].sort().join(',');
const id=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(value);
const clone=value=>JSON.parse(JSON.stringify(value));
function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
function same(a,b){return digest(a)===digest(b);}

// Metadata only: no rows, credentials, SQL bodies or implicit schema creation.
// schemaDigest binds the complete reviewed columns/types/defaults/indexes/ACLs,
// policies/triggers and dependency inventory, not a selected-column projection.
export function prepareOwnedBuyerMigrationExecution(input){
 if(!keys(input,['releaseSha','source','target','inventory','rollbackDigest'])||!hex(input.releaseSha,40)||!hex(input.rollbackDigest,64))fail();
 const {source,target,inventory}=input;
 if(!keys(source,['clusterId','database','snapshotId','snapshotDigest','quiescenceDigest'])
  ||!/^\d{10,20}$/.test(source.clusterId)||source.database!=='postgres'
  ||typeof source.snapshotId!=='string'||!/^[A-Za-z0-9:-]{1,128}$/.test(source.snapshotId)
  ||!hex(source.snapshotDigest,64)||!hex(source.quiescenceDigest,64))fail();
 if(!keys(target,['kind','clusterId','database','profileDigest','schemaDigest'])||target.kind!=='owned-postgres-v1'
  ||!/^\d{10,20}$/.test(target.clusterId)||target.clusterId===source.clusterId||target.database!=='postgres'
  ||!hex(target.profileDigest,64)||!hex(target.schemaDigest,64))fail();
 if(!keys(inventory,['relations','foreignKeys','dependencies','schemaDigest'])||!hex(inventory.schemaDigest,64)
  ||target.schemaDigest!==inventory.schemaDigest||!Array.isArray(inventory.relations)||inventory.relations.length!==6
  ||!Array.isArray(inventory.foreignKeys)||!Array.isArray(inventory.dependencies))fail();
 const names=inventory.relations.map(row=>row.name);
 if(!same(names,OWNED_BUYER_RELATIONS))fail();
 for(const row of inventory.relations){
  if(!keys(row,['schema','name','owner','rls','forceRls','primaryKey','rowCount','dataDigest','definitionDigest'])
   ||row.schema!=='public'||row.owner!=='postgres'||row.rls!==true||row.forceRls!==false
   ||!same(row.primaryKey,['id'])||!Number.isSafeInteger(row.rowCount)||row.rowCount<0
   ||!hex(row.dataDigest,64)||!hex(row.definitionDigest,64))fail();
 }
 if(inventory.foreignKeys.length!==5)fail();
 const fkKeys=new Set(),edges=[];
 for(const fk of inventory.foreignKeys){
  if(!keys(fk,['name','from','to','columns','referencedColumns','onDelete','definitionDigest'])||!id(fk.name)
   ||!names.includes(fk.from)||!names.includes(fk.to)||!Array.isArray(fk.columns)||!fk.columns.length||!fk.columns.every(id)
   ||!Array.isArray(fk.referencedColumns)||fk.columns.length!==fk.referencedColumns.length||!fk.referencedColumns.every(id)
   ||!hex(fk.definitionDigest,64)||fkKeys.has(`${fk.from}.${fk.name}`))fail();
  fkKeys.add(`${fk.from}.${fk.name}`);
  if(fk.columns.length!==1||!same(fk.referencedColumns,['id']))fail();
  edges.push([fk.from,fk.columns[0],fk.to,fk.onDelete]);
 }
 if(!same(edges.sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0),OWNED_BUYER_FOREIGN_KEYS))fail();
 // Current source has no auth.users FK. Never copy auth credentials or silently
 // widen closure. Shared Supabase CountyDataSource/registry readers stay separate.
 if(inventory.dependencies.length!==1||!keys(inventory.dependencies[0],['kind','identity','definitionDigest'])
  ||inventory.dependencies[0].kind!=='function'||inventory.dependencies[0].identity!=='auth.uid()'
  ||!hex(inventory.dependencies[0].definitionDigest,64))fail();
 const data=freeze(clone(input));
 const plan=freeze({schema:1,kind:'owned-buyer-data-migration-v1',releaseSha:input.releaseSha,
  manifestDigest:digest(data),sourceClusterId:source.clusterId,targetClusterId:target.clusterId});
 plans.set(plan,data);return plan;
}

function observation(value,data){
 if(!keys(value,['source','target','inventory','rollbackDigest','soleWriter','sourceWritesDisabled','destinationWritesDisabled'])
  ||!same(value.source,data.source)||!same(value.target,data.target)||!same(value.inventory,data.inventory)
  ||value.rollbackDigest!==data.rollbackDigest||value.soleWriter!=='NONE'
  ||value.sourceWritesDisabled!==true||value.destinationWritesDisabled!==true)fail();
}
function result(plan,status){return freeze({status,manifestDigest:plan.manifestDigest,releaseSha:plan.releaseSha,productionAcceptance:false});}
function receipt(plan,data){return {schema:1,kind:'owned-buyer-data-copy-receipt-v1',manifestDigest:plan.manifestDigest,
 releaseSha:plan.releaseSha,sourceClusterId:data.source.clusterId,targetClusterId:data.target.clusterId,
 snapshotDigest:data.source.snapshotDigest,schemaDigest:data.inventory.schemaDigest,rollbackDigest:data.rollbackDigest,
 relations:data.inventory.relations.map(({name,rowCount,dataDigest})=>({name,rowCount,dataDigest}))};}

// This orchestrator has no ambient connection discovery and no production CLI.
// Host must hold the source snapshot and database fences continuously, pin both
// physical clusters, supply full closure observations, and use one dedicated
// target transaction. It must copy every column with preserved IDs, verify all
// constraints/RLS/ACLs, and commit the receipt atomically with the copied rows.
// Opening either business writer is deliberately outside this operation.
export async function executeOwnedBuyerMigration({plan,host,mode}){
 const data=plans.get(plan);
 const methods=['acquireFence','observe','readIntent','writeIntent','readReceipt','begin','copyRelation','verifyTarget','writeReceipt','commit','rollback','releaseFence'];
 if(!data||!host||!methods.every(name=>typeof host[name]==='function')||!['apply','reconcile'].includes(mode))fail();
 const expected=receipt(plan,data);let fence=false,began=false,commitSent=false;
 try{
  await host.acquireFence(plan);fence=true;
  const prior=await host.readIntent(plan);
  const retained=await host.readReceipt(plan);
  if(prior!==null&&!same(prior,expected))fail();
  if(retained!==null){
   if(prior===null||!same(retained,expected))fail();
   await host.verifyTarget(expected,{committed:true});
   // Reconciliation verifies retained copy; no source read/copy or new commit.
   return result(plan,'OWNED_BUYER_DATA_RECONCILED');
  }
  if(mode==='reconcile'||prior!==null)return result(plan,'OWNED_BUYER_DATA_OUTCOME_UNKNOWN');
  observation(await host.observe(plan),data);
  await host.writeIntent(expected); // durable before any destination write
  await host.begin(plan);began=true;
  await host.verifyTarget(expected,{empty:true});
  // Host transaction must use a reviewed FK-safe loading strategy and defer
  // validation only until all six relations are loaded, never omit constraints.
  for(const name of OWNED_BUYER_COPY_ORDER)await host.copyRelation(data.inventory.relations.find(row=>row.name===name),{snapshotId:data.source.snapshotId,preserveIds:true});
  await host.verifyTarget(expected,{committed:false});
  observation(await host.observe(plan),data);
  await host.writeReceipt(expected);
  commitSent=true;await host.commit();began=false;
  return result(plan,'OWNED_BUYER_DATA_COMMITTED');
 }catch{
  if(began&&!commitSent){try{await host.rollback();}catch{/* no inferred rollback or redispatch */}}
  const error=new Error(commitSent?'Owned Buyer data commit outcome unknown; reconcile only':'Owned Buyer data migration failed; retain intent and reconcile');
  error.code=commitSent?'OUTCOME_UNKNOWN':'MIGRATION_FAILED';throw error;
 }finally{if(fence)await host.releaseFence();}
}
