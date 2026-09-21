import {createHash} from 'node:crypto';
import {verifyOwnedBuyerWriterProductionEvidence} from '../buyer-writer/production-verifier.js';
import {OWNED_DATABASE_ACL_SQL,OWNED_DATABASE_BOUNDARY_SQL,verifyOwnedDatabaseBoundary,ownedDatabaseAclParameters} from '../buyer-writer/owned-database-evidence.js';
import {BUYER_WRITER_PRODUCTION_VERIFY_SQL} from '../buyer-writer/production-verifier.js';
const fail=()=>{throw new Error('Owned ACL scoped observation refused');};
const actorSql='select session_user::text as session_actor,current_user::text as current_actor';
export async function observeOwnedAclScoped(client,profile,values){
 if(JSON.stringify(values)!==JSON.stringify(ownedDatabaseAclParameters(profile)))fail();
 const actor=async expected=>{const r=await client.query(actorSql,[]),v=r.rows?.[0];if(r.rows?.length!==1||!v||Object.keys(v).sort().join(',')!=='current_actor,session_actor'||v.session_actor!=='postgres'||v.current_actor!==expected)fail();};
 await actor('postgres');const boundary=await client.query(OWNED_DATABASE_BOUNDARY_SQL,[]);
 if(boundary.rows?.length!==1||Object.keys(boundary.rows[0]).join(',')!=='boundary')fail();
 verifyOwnedDatabaseBoundary(boundary.rows[0].boundary,profile);
 let writer;
 try{await client.query('set role buyer_writer_owner',[]);await actor('buyer_writer_owner');
  writer=await client.query(BUYER_WRITER_PRODUCTION_VERIFY_SQL,values);
  if(writer.rows?.length!==1||Object.keys(writer.rows[0]).join(',')!=='evidence')fail();
 }finally{await client.query('reset role',[]);await actor('postgres');}
 return {rows:[{boundary:boundary.rows[0].boundary,writer:writer.rows[0].evidence}]};
}
// Keep canonical credential/profile/TLS fencing and result validators unchanged.
// Only the exact combined catalog query is split, on its existing transaction.
export function createOwnedAclObserverPool(Pool,profile){return class ScopedPool{
 constructor(options){this.pool=new Pool(options);}
 async connect(){const client=await this.pool.connect();return {query:(sql,values)=>sql===OWNED_DATABASE_ACL_SQL?observeOwnedAclScoped(client,profile,values):client.query(sql,values),release:destroy=>client.release(destroy)};}
 end(){return this.pool.end();}
};}

export function verifyOwnedOperatorAclResult(result,profile){
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1||Object.keys(result.rows[0]).sort().join(',')!=='boundary,writer')fail();
 const {boundary:raw,writer}=result.rows[0],boundary=verifyOwnedDatabaseBoundary(raw,profile);
 const verified=verifyOwnedBuyerWriterProductionEvidence(writer,profile);
 if(verified.pgNet.some(v=>v.signature!==null||v.owner!==null||['publicExecute','ownerExecute','runtimeExecute','issuerExecute','admissionExecute'].some(k=>v[k]!==false)))fail();
 return Object.freeze({...boundary,writerIsolationVerified:true,targetTablePublicPrivilegeCount:0,targetColumnPublicPrivilegeCount:0,directTableAccessDenied:true,directSequenceAccessDenied:true,schemaCreateDenied:true,crossRoutineAccessDenied:true,writerCatalogDigest:createHash('sha256').update(JSON.stringify(writer)).digest('hex')});
}
