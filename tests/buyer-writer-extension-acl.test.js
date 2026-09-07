import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
const functions=['_await_response','_encode_url_with_params_array','_http_collect_response','_urlencode_string','check_worker_is_up','http_collect_response','http_delete','http_get','http_post','wait_until_running','wake','worker_restart'];
function fixture(){
 const roles=['postgres','supabase_admin','consumer'].map((name,i)=>({name,oid:String(i+10),superuser:false,inherit:true,login:false,createRole:false,createDb:false,replication:false,bypassRls:false}));
 const objects=[...functions.map(name=>({schema:'net',name,kind:'function',arguments:'',definitionDigest:'a'.repeat(32),securityDefiner:false})),
 ...['_http_response','http_request_queue'].map(name=>({schema:'net',name,kind:'r',arguments:null,definitionDigest:null,securityDefiner:null})),
 {schema:'net',name:'http_request_queue_id_seq',kind:'S',arguments:null,definitionDigest:null,securityDefiner:null},
 ...['pg_stat_statements','pg_stat_statements_info'].map(name=>({schema:'extensions',name,kind:'v',arguments:null,definitionDigest:null,securityDefiner:null}))];
 const privileges=o=>o.kind==='function'?['EXECUTE']:o.kind==='S'?['SELECT','UPDATE','USAGE']:['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE'];
 for(const [i,o] of objects.entries()){
  o.oid=String(i+100);o.owner=o.schema==='net'?'supabase_admin':'postgres';
  const publicPrivileges=o.kind==='v'?['SELECT']:privileges(o);
  o.edges=[...privileges(o).map(privilege=>({grantor:o.owner,grantee:o.owner,privilege,grantable:true})),...publicPrivileges.map(privilege=>({grantor:o.owner,grantee:'PUBLIC',privilege,grantable:false}))];
 }
 const columns=objects.filter(o=>['r','v'].includes(o.kind)).map(o=>({schema:o.schema,table:o.name,number:1,name:'synthetic',aclIsNull:true,edges:[]}));
 const inventory={serverVersion:'17.6',database:'fixture',roles,memberships:[],extensions:[],schemas:[],objects};
 const effective=roles.flatMap(r=>objects.flatMap(o=>privileges(o).map(p=>[r.name,o.schema,o.name,o.kind,o.arguments,p,true,r.name===o.owner])));
 return{inventory,columns:{columns},effective:{effective,schemaEffective:roles.flatMap(r=>['extensions','net'].map(s=>[r.name,s,true,false]))}};
}
test('deterministic ACL package preserves prior edges/options and records only missing owner grants',()=>{
 const f=fixture(),p=prepareBuyerWriterExtensionAcl(f);assert.deepEqual(p,prepareBuyerWriterExtensionAcl(f));
 assert.equal(p.manifest.objects.length,17);assert.equal(p.manifest.publicEdges,33);assert.equal(p.manifest.addedEdges,66);
 for(const o of p.manifest.objects){assert.ok(o.after.every(e=>e.grantee!=='PUBLIC'));assert.ok(o.before.filter(e=>e.grantee!=='PUBLIC').every(e=>o.after.some(x=>JSON.stringify(x)===JSON.stringify(e))));}
 assert.match(p.applySql,/BEGIN;/);assert.match(p.rollbackSql,/RESTRICT/);assert.doesNotMatch(p.applySql,/CASCADE|ALL FUNCTIONS IN SCHEMA/);
 const o=f.inventory.objects[0];o.edges.push({grantor:o.owner,grantee:'consumer',privilege:'EXECUTE',grantable:true});
 const changed=prepareBuyerWriterExtensionAcl(f);assert.equal(changed.manifest.addedEdges,65);
 assert.ok(changed.manifest.objects[0].after.some(e=>e.grantee==='consumer'&&e.grantable));
});
test('unsafe or incomplete captures fail before SQL is generated',()=>{
 for(const mutate of [
 f=>{f.columns.columns[0].edges=[{grantee:'consumer'}];},f=>{f.columns.columns[0].aclIsNull=false;},
 f=>{f.inventory.roles.push({...f.inventory.roles[0]});},f=>{f.inventory.roles[0].name='buyer_writer_runtime';},
 f=>{f.inventory.objects[0].edges.find(e=>e.grantee==='PUBLIC').grantable=true;},f=>{f.inventory.objects[0].edges.push({...f.inventory.objects[0].edges[0]});},
 f=>{f.inventory.objects[0].name='unrelated';},f=>{f.effective.effective.pop();},f=>{f.effective.effective.push(f.effective.effective[0]);},
 f=>{f.effective.schemaEffective.pop();},f=>{f.inventory.objects[0].edges[0].privilege='DROP';},
 ]){const f=fixture();mutate(f);assert.throws(()=>prepareBuyerWriterExtensionAcl(f),/Buyer writer extension ACL capture rejected/);}
});

test('captured text cannot terminate the DO body and server version remains a precondition',()=>{
 const f=fixture();f.columns.columns[0].name='column$zola_acl$';const p=prepareBuyerWriterExtensionAcl(f);
 assert.equal(p.manifest.baseline.serverVersion,'17.6');assert.match(p.applySql,/DO \$zola_acl_1\$/);
 delete f.inventory.serverVersion;assert.throws(()=>prepareBuyerWriterExtensionAcl(f));
});
