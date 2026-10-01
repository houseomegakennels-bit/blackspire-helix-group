import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {initializeCustomer} from '../scripts/init-zola-customer.mjs';
function fixture(t){const p=fs.mkdtempSync(path.join(os.tmpdir(),'zola-customer-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;}
test('fresh setup has unique identity, private files and no ambient credential import',t=>{
 const p=fixture(t); const old=process.env.OPENAI_API_KEY;process.env.OPENAI_API_KEY='test-ambient-must-not-copy';
 t.after(()=>{if(old===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=old;});
 const a=initializeCustomer({directory:path.join(p,'one'),origin:'https://customer.example'});
 const b=initializeCustomer({directory:path.join(p,'two'),origin:'https://other.example'});
 assert.notEqual(a.installationId,b.installationId);
 const m=JSON.parse(fs.readFileSync(path.join(a.directory,'installation.json')));
 assert.equal(m.status,'prepared_not_runnable');assert.equal(m.fallbackCredentials,false);
 for(const module of ['cloudAi','voice','telegram','social'])assert.equal(m.modules[module].enabled,false);
 const secret=fs.readFileSync(path.join(a.directory,'secrets/providers.json'),'utf8');
 assert.deepEqual(JSON.parse(secret).providers,{});assert.ok(!secret.includes('test-ambient'));
 for(const name of ['','data','secrets','backups'])assert.equal(fs.statSync(path.join(a.directory,name)).mode&0o777,0o700);
 for(const name of ['installation.json','secrets/providers.json','README.txt'])assert.equal(fs.statSync(path.join(a.directory,name)).mode&0o777,0o600);
});
test('existing target is never overwritten',t=>{
 const p=fixture(t);const dest=path.join(p,'existing');fs.mkdirSync(dest);fs.writeFileSync(path.join(dest,'keep'),'unchanged');
 assert.throws(()=>initializeCustomer({directory:dest,origin:'https://customer.example'}));
 assert.equal(fs.readFileSync(path.join(dest,'keep'),'utf8'),'unchanged');
});
test('destination symlink is refused',t=>{
 const p=fixture(t);fs.mkdirSync(path.join(p,'real'));fs.symlinkSync(path.join(p,'real'),path.join(p,'link'));
 assert.throws(()=>initializeCustomer({directory:path.join(p,'link'),origin:'https://customer.example'}));
 assert.deepEqual(fs.readdirSync(path.join(p,'real')),[]);
});
test('unsafe origins are rejected before filesystem writes',t=>{
 const p=fixture(t);
 for(const origin of ['http://customer.example','https://user:pass@customer.example','https://customer.example/path','https://customer.example?key=value','https://customer.example/#fragment','https://command.blackspirehelix.com','not-url']){
 const dest=path.join(p,'new');assert.throws(()=>initializeCustomer({directory:dest,origin}));assert.equal(fs.existsSync(dest),false);
 }
});
test('relative destination and missing parent are refused',t=>{
 const p=fixture(t);
 assert.throws(()=>initializeCustomer({directory:'relative',origin:'https://customer.example'}));
 assert.throws(()=>initializeCustomer({directory:path.join(p,'missing','new'),origin:'https://customer.example'}));
});

test('OpenAI and Claude choices are saved without enabling unconfigured providers',t=>{
 const p=fixture(t);
 for(const provider of ['openai','anthropic','none']){
 const result=initializeCustomer({directory:path.join(p,provider),origin:'https://customer.example',provider});
 const manifest=JSON.parse(fs.readFileSync(path.join(result.directory,'installation.json')));
 assert.equal(manifest.ai.provider,provider);assert.equal(manifest.ai.fallbackProvider,null);
 assert.equal(manifest.ai.connectionStatus,provider==='none'?'skipped':'needs_credentials');
 assert.equal(manifest.modules.cloudAi.enabled,false);
 }
 const dest=path.join(p,'invalid');
 assert.throws(()=>initializeCustomer({directory:dest,origin:'https://customer.example',provider:'unknown'}));
 assert.equal(fs.existsSync(dest),false);
});
