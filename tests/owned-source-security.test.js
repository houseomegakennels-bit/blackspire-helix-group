import test from 'node:test';import assert from 'node:assert/strict';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
import {providerFixture} from './helpers/owned-provider-fixture.js';
import {prepareOwnedSourceSecurityPackage,executeOwnedSourceSecurity,observeOwnedSourceSecurity,inspectOwnedSourceSecurityHistory,OWNED_SOURCE_FREEZE_CHECK_SQL,validateOwnedSourceSecurityInTransaction} from '../packages/buyer-writer/owned-source-security.js';
const input=()=>{const fixture=providerFixture();fixture.inventory.database='postgres';return {releaseSha:'a'.repeat(40),operationId:'11111111-1111-4111-8111-111111111111',profileDigest:'b'.repeat(64),sourceCreatorOid:16388,sourceSystemIdentifier:'1234567890123456789',providerManifest:prepareBuyerWriterExtensionAcl(fixture).manifest};};
const version='20260921150000';
function harness(){const prepared=prepareOwnedSourceSecurityPackage(input()),events=[],calls=[];let row=null,lost=false,frozen=true,busy=false,readOnly=true;
 const client={query:async(sql,values=[])=>{calls.push(sql);
  if(sql.includes('pg_try_advisory'))return{rows:[{acquired:!busy}]};
  if(sql.startsWith('SELECT version,name'))return{rows:row?[row]:[]};
  if(sql.startsWith('INSERT INTO supabase_migrations')){row={version:values[0],name:values[1],statements:values[2],idempotency_key:values[3]};return{rowCount:1};}
  if(sql==='COMMIT'&&lost)throw Error('lost acknowledgement');
  if(sql===OWNED_SOURCE_FREEZE_CHECK_SQL)return{rows:[{evidence:{transactionReadOnly:readOnly,sourceWritesDenied:frozen,browserDenied:true,anonymousJobsDenied:true,ownReadPreserved:true}}]};
  if(sql.includes("AS safe"))return{rows:[{safe:!readOnly}]};return{rows:[]};}};
 return{...prepared,events,calls,client,journal:{events:()=>structuredClone(events),append:event=>events.push(structuredClone(event))},get row(){return row;},set lost(v){lost=v;},set frozen(v){frozen=v;},set busy(v){busy=v;},set readOnly(v){readOnly=v;}};
}
test('source package retains reviewed security migrations and does not repoint or mutate provider ACLs',()=>{
 const value=prepareOwnedSourceSecurityPackage(input());assert.equal(value.manifest.kind,'owned-buyer-source-security-v1');assert.equal(value.manifest.frozenTables.length,6);
 assert.equal(value.manifest.ownedTargetMigrated,false);assert.equal(value.manifest.sourceProviderAclChanged,false);
 assert.match(value.body,/nexus_contacts_authenticated_all/);assert.match(value.body,/Source effective writes remain/);assert.doesNotMatch(value.body,/GRANT .* ON .*net\./i);
 for(const change of [{sourceSystemIdentifier:'0'},{profileDigest:'bad'},{sourceCreatorOid:10},{extra:true}])assert.throws(()=>prepareOwnedSourceSecurityPackage({...input(),...change}));
});
test('source intent precedes SQL and committed receipt reconciles with current effective freeze, never reapplies body',async()=>{
 const f=harness();let fenced=0;const args={...f,mode:'apply',migrationVersion:version,fence:async()=>{fenced++;assert.equal(f.events[0].type,'owned_source_security_intent');}};
 assert.equal((await executeOwnedSourceSecurity(args)).status,'OWNED_SOURCE_SECURITY_COMMITTED');assert.equal(fenced,2);
 const before=f.calls.filter(q=>q===f.body).length;assert.equal((await executeOwnedSourceSecurity({...args,mode:'reconcile'})).status,'OWNED_SOURCE_SECURITY_VERIFIED');
 assert.equal(f.calls.filter(q=>q===f.body).length,before);assert.equal(inspectOwnedSourceSecurityHistory(f.events).result.status,'VERIFIED');
 f.frozen=false;await assert.rejects(observeOwnedSourceSecurity(f.client,f.plan,version));
});
test('lost commit acknowledgement retains intent, forbids replay and observes exact durable receipt',async()=>{
 const f=harness();f.lost=true;const args={...f,mode:'apply',migrationVersion:version,fence:async()=>{}};
 await assert.rejects(executeOwnedSourceSecurity(args));assert.equal(f.events.at(-1).status,'OUTCOME_UNKNOWN');await assert.rejects(executeOwnedSourceSecurity(args));
 assert.equal((await executeOwnedSourceSecurity({...args,mode:'reconcile'})).status,'OWNED_SOURCE_SECURITY_VERIFIED');assert.equal(f.calls.filter(q=>q===f.body).length,1);
});
test('busy source lock and missing snapshot fences refuse observation; unknown event families rejected',async()=>{
 const f=harness();f.busy=true;await assert.rejects(observeOwnedSourceSecurity(f.client,f.plan,version));assert.ok(!f.calls.some(q=>q.startsWith('SELECT version,name')));
 f.busy=false;await assert.rejects(validateOwnedSourceSecurityInTransaction(f.client,f.plan,version));assert.throws(()=>inspectOwnedSourceSecurityHistory([{type:'other'}]));
});
