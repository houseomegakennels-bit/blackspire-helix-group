import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareBuyerWorkflowPackage} from '../packages/buyer-writer/n8n-package.js';
const config={version:1,workflowId:'isolated-workflow',workflowVersion:'cdd141ba-8d20-4981-b598-6af8e35aff86',
 releaseSha:'a'.repeat(40),backupSha256:'b'.repeat(64),gatewayOrigin:'https://writer.example.invalid',
 webhookId:'isolated-webhook',ingressCredentialId:'isolated-intake',writerCredentialId:'isolated-writer'};
test('offline workflow packages are byte deterministic and bind source, backup, revision and inputs',()=>{
 const a=prepareBuyerWorkflowPackage(config),b=prepareBuyerWorkflowPackage({...config});
 const mutable={...config};const detached=prepareBuyerWorkflowPackage(mutable);mutable.workflowId='changed';assert.equal(detached.manifest.configuration.workflowId,config.workflowId);
 assert.deepEqual(a,b);assert.equal(a.manifest.status,'offline-candidate');assert.equal(a.manifest.credentialResolution,'UNVERIFIED');
 assert.equal(a.manifest.payloadSha256,createHash('sha256').update(a.payload).digest('hex'));
 const payload=JSON.parse(a.payload);assert.equal(new Set(payload.nodes.map(n=>n.id)).size,payload.nodes.length);
 for(const n of payload.nodes)assert.match(n.id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
 assert.notEqual(prepareBuyerWorkflowPackage({...config,writerCredentialId:'changed-writer'}).manifest.payloadSha256,a.manifest.payloadSha256);
 assert.notEqual(prepareBuyerWorkflowPackage({...config,backupSha256:'c'.repeat(64)}).manifestBytes,a.manifestBytes);
 assert.ok(Object.keys(a.manifest.sourceSha256).length>=6);
});
test('unresolved actual references produce only requirements, never a placeholder update payload',()=>{
 const p=prepareBuyerWorkflowPackage({...config,writerCredentialId:null,ingressCredentialId:null,gatewayOrigin:null});
 assert.equal(p.payload,null);assert.equal(p.manifest.status,'requirements-pending');
 assert.deepEqual(p.manifest.missing,['gatewayOrigin','ingressCredentialId','writerCredentialId']);
 assert.equal(p.manifest.payloadSha256,null);
});
test('rejects hidden configuration, malformed identities and duplicate credentials without echoing values',()=>{
 for(const candidate of [{...config,secret:'SENSITIVE_VALUE'},{...config,writerCredentialId:config.ingressCredentialId},
  {...config,releaseSha:'bad'},{...config,gatewayOrigin:'http://unsafe.invalid'},{...config,workflowVersion:'bad'},
  {...config,writerCredentialId:''},{...config,webhookId:null}]){
  assert.throws(()=>prepareBuyerWorkflowPackage(candidate),{message:'Buyer workflow package configuration rejected'});
 }
});
