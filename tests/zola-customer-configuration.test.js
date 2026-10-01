import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeCustomer} from '../scripts/init-zola-customer.mjs';
import {loadCustomerInstallation,customerProviderStatus,selectCustomerProvider} from '../packages/shared/customer-installation.js';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-config-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const a=initializeCustomer({directory:path.join(root,'a'),origin:'https://customer.example',provider:'openai'});
 return {root,a,file:path.join(a.directory,'secrets/providers.json')};
}
test('status exposes no credentials and never marks runtime ready',t=>{
 const {a,file}=fixture(t);
 const c={schemaVersion:1,installationId:a.installationId,providers:{openai:{provider:'openai',installationId:a.installationId,apiKey:'test-only-secret'}}};
 fs.writeFileSync(file,JSON.stringify(c));
 const status=customerProviderStatus(loadCustomerInstallation(a.directory));
 assert.equal(status.status,'configured_not_verified');assert.equal(status.runtimeReady,false);
 assert.ok(!JSON.stringify(status).includes('test-only-secret'));
});
test('other installation credential file fails closed',t=>{
 const {a,file}=fixture(t);const c=JSON.parse(fs.readFileSync(file));c.installationId='wrong-installation';
 fs.writeFileSync(file,JSON.stringify(c));assert.throws(()=>loadCustomerInstallation(a.directory),/CUSTOMER_CONFIGURATION_REJECTED/);
});
test('wrong provider binding does not become connected',t=>{
 const {a,file}=fixture(t);const c=JSON.parse(fs.readFileSync(file));
 c.providers.openai={provider:'anthropic',installationId:a.installationId,apiKey:'test-only'};
 fs.writeFileSync(file,JSON.stringify(c));
 assert.equal(customerProviderStatus(loadCustomerInstallation(a.directory)).status,'needs_credentials');
});
test('world-readable credential file rejected',t=>{
 const {a,file}=fixture(t);fs.chmodSync(file,0o644);
 assert.throws(()=>loadCustomerInstallation(a.directory),/CUSTOMER_CONFIGURATION_REJECTED/);
});
test('credential symlink rejected',t=>{
 const {root,a,file}=fixture(t);const outside=path.join(root,'outside');fs.renameSync(file,outside);fs.symlinkSync(outside,file);
 assert.throws(()=>loadCustomerInstallation(a.directory),/CUSTOMER_CONFIGURATION_REJECTED/);
});
test('credential hardlink rejected',t=>{
 const {root,a,file}=fixture(t);fs.linkSync(file,path.join(root,'alias'));
 assert.throws(()=>loadCustomerInstallation(a.directory),/CUSTOMER_CONFIGURATION_REJECTED/);
});
test('malformed content does not appear in error',t=>{
 const {a,file}=fixture(t);fs.writeFileSync(file,'test-only-secret invalid-json');
 assert.throws(()=>loadCustomerInstallation(a.directory),e=>e.message==='CUSTOMER_CONFIGURATION_REJECTED');
});
test('provider switch disables execution and never changes voice settings',t=>{
 const {a}=fixture(t);const m=loadCustomerInstallation(a.directory).manifest;m.modules.voice={enabled:true};
 const next=selectCustomerProvider(m,'anthropic');
 assert.equal(next.ai.provider,'anthropic');assert.equal(next.modules.cloudAi.enabled,false);
 assert.equal(next.modules.voice.enabled,true);assert.equal(next.ai.fallbackProvider,null);assert.equal(m.ai.provider,'openai');
 const skipped=selectCustomerProvider(next,'none');assert.equal(skipped.ai.connectionStatus,'skipped');
 assert.throws(()=>selectCustomerProvider(m,'unknown'));
});
test('ambient keys do not satisfy missing installation credentials',t=>{
 const {a}=fixture(t);const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-only-ambient';
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;});
 assert.equal(customerProviderStatus(loadCustomerInstallation(a.directory)).status,'needs_credentials');
});
test('tampered fallback policy and directory permissions rejected',t=>{
 const {a}=fixture(t);const f=path.join(a.directory,'installation.json');const m=JSON.parse(fs.readFileSync(f));m.fallbackCredentials=true;fs.writeFileSync(f,JSON.stringify(m));
 assert.throws(()=>loadCustomerInstallation(a.directory));
 m.fallbackCredentials=false;fs.writeFileSync(f,JSON.stringify(m));fs.chmodSync(path.join(a.directory,'secrets'),0o755);
 assert.throws(()=>loadCustomerInstallation(a.directory));
});
