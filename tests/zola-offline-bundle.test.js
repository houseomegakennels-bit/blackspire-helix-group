import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {prepareBuyerWriterExtensionAcl} from '../packages/buyer-writer/extension-acl.js';
import {prepareOfflineReleaseBundle,writeOfflineReleaseBundle} from '../packages/zola-release/offline-bundle.js';
import {WORKFLOW_ID} from '../packages/zola-release/commander-n8n.js';
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

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function input(){
 const releaseSha='a'.repeat(40),versionId='cdd141ba-8d20-4981-b598-6af8e35aff86';
 const backup={id:WORKFLOW_ID,name:'PRIVATE_LEGACY_VALUE',nodes:[],connections:{},settings:{},active:true,versionId,activeVersionId:versionId,
  activeVersion:{workflowId:WORKFLOW_ID,versionId,nodes:[],connections:{}}};
 const backupBytes=JSON.stringify(backup);
 return{releaseSha,backupBytes,providerManifest:prepareBuyerWriterExtensionAcl(fixture()).manifest,n8nConfiguration:{version:1,workflowId:WORKFLOW_ID,
  workflowVersion:versionId,releaseSha,backupSha256:digest(backupBytes),gatewayOrigin:'https://jarvis.blackspirehelix.com',webhookId:'buyer-engine',ingressCredentialId:'intake',writerCredentialId:'writer'}};
}
test('bundle regenerates exact-SHA packages without carrying backup secrets or live readiness claims',()=>{
 const configuration=input(),bundle=prepareOfflineReleaseBundle(configuration);
 assert.deepEqual(bundle,prepareOfflineReleaseBundle(configuration));
 const manifest=JSON.parse(bundle.files['manifest.json']);
 assert.equal(manifest.productionAccepted,false);assert.equal(manifest.liveApplied,false);
 assert.equal(Object.keys(manifest.files).length,9);
 for(const [name,sha] of Object.entries(manifest.files))assert.equal(digest(bundle.files[name]),sha);
 assert.equal(Object.values(bundle.files).join('').includes('PRIVATE_LEGACY_VALUE'),false);
 assert.deepEqual(Object.keys(JSON.parse(bundle.files['n8n-update.json'])).sort(),['connections','name','nodes','settings']);
 assert.equal(JSON.parse(bundle.files['n8n-rollback.json']).restoresLegacy,false);
 const next=input();next.releaseSha='b'.repeat(40);next.n8nConfiguration.releaseSha=next.releaseSha;
 assert.notEqual(prepareOfflineReleaseBundle(next).manifestSha256,bundle.manifestSha256);
 assert.equal(JSON.parse(bundle.files['migration-manifest.json']).releaseSha,configuration.releaseSha);
});
test('mixed SHA, unresolved references, backup drift and provider manifest drift refuse without diagnostic leakage',()=>{
 for(const change of [c=>c.n8nConfiguration.releaseSha='b'.repeat(40),c=>c.n8nConfiguration.writerCredentialId=null,
  c=>c.backupBytes+=' ',c=>c.providerManifest.publicEdges=0,c=>c.n8nConfiguration.secret='PRIVATE_VALUE']){
  const c=input();change(c);assert.throws(()=>prepareOfflineReleaseBundle(c),{message:'Offline release bundle rejected'});
 }
});
test('protected bundle write is durable and exact rerun refuses partial, altered or aliased output',{skip:process.getuid?.()!==0},t=>{
 const parent=fs.mkdtempSync('/root/.zola-bundle-test-');fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const bundle=prepareOfflineReleaseBundle(input()),root=path.join(parent,'bundle');
 assert.equal(writeOfflineReleaseBundle(root,bundle).status,'OFFLINE_BUNDLE_WRITTEN');
 assert.equal(writeOfflineReleaseBundle(root,bundle).status,'OFFLINE_BUNDLE_REVERIFIED');
 assert.throws(()=>writeOfflineReleaseBundle(path.join(parent,'forged'),{...bundle}));
 const target=path.join(root,'application.sql'),original=fs.readFileSync(target,'utf8');
 fs.appendFileSync(target,'--altered');assert.throws(()=>writeOfflineReleaseBundle(root,bundle));assert.ok(fs.readFileSync(target,'utf8').endsWith('--altered'));
 fs.writeFileSync(target,original);fs.linkSync(target,path.join(parent,'alias'));assert.throws(()=>writeOfflineReleaseBundle(root,bundle));fs.unlinkSync(path.join(parent,'alias'));
 fs.unlinkSync(path.join(root,'manifest.json'));assert.throws(()=>writeOfflineReleaseBundle(root,bundle));assert.equal(fs.existsSync(path.join(root,'manifest.json')),false);
 const link=path.join(parent,'link');fs.symlinkSync(root,link);assert.throws(()=>writeOfflineReleaseBundle(link,bundle));
});
