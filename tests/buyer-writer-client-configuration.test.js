import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes} from 'node:crypto';
import {validateBuyerWriterClientConfiguration} from '../packages/buyer-writer/configuration.js';
import {DIRECT_DATABASE_ENV_KEYS,validateApplicationDatabaseIsolation} from '../packages/shared/security.js';

const secret=()=>randomBytes(32).toString('base64url');
function clientConfig(){
  return {version:2,workspace:'blackspire-command',socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:secret()};
}

test('application Buyer Writer configuration contains only local transport and ingress capabilities',()=>{
  const value=validateBuyerWriterClientConfiguration(clientConfig(),{workspace:'blackspire-command'});
  assert.deepEqual(Object.keys(value).sort(),['gatewayCapability','socketPath','version','workspace']);
  assert.equal(value.socketPath,'/run/blackspire/buyer-writer.sock');
  assert.equal(JSON.stringify(value).match(/(?:database|postgres|password|host|port|\buri\b)/gi),null);
});

test('client configuration rejects database fields, extra keys, alternate sockets and shared capabilities',()=>{
  for(const mutate of [
    v=>{v.password='secret';},v=>{v.database='postgres';},v=>{v.host='db.example';},v=>{v.port=5432;},
    v=>{v.url='postgresql://example';},v=>{v.runtime={password:'secret'};},v=>{v.socketPath='/tmp/writer.sock';},
    v=>{v.writerCredential=secret();},v=>{v.issuerCredential=secret();},v=>{v.bindingFile='/etc/blackspire/binding.json';},v=>{v.version=1;},
  ]){const value=clientConfig();mutate(value);assert.throws(()=>validateBuyerWriterClientConfiguration(value,{workspace:'blackspire-command'}),/client configuration rejected/);}
});

test('API and worker production environments reject every direct database credential key without exposing values',()=>{
  for(const role of ['blackspire-api','blackspire-worker'])for(const key of DIRECT_DATABASE_ENV_KEYS){
    const value='do-not-disclose-'+key;
    const result=validateApplicationDatabaseIsolation({BLACKSPIRE_RUNTIME_USER:role,[key]:value});
    assert.equal(result.ok,false);assert.deepEqual(result.forbidden,[key]);assert.doesNotMatch(JSON.stringify(result),new RegExp(value));
  }
});

test('frontend production source contains no direct database credential environment reference',()=>{
  const root=fileURLToPath(new URL('../frontend/',import.meta.url)),forbidden=new Set(DIRECT_DATABASE_ENV_KEYS);
  const files=[];
  const visit=directory=>{for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    if(['node_modules','.next','dist','coverage'].includes(entry.name))continue;
    const filename=path.join(directory,entry.name);
    if(entry.isDirectory())visit(filename);else if(/\.(?:[cm]?[jt]sx?|json)$/.test(entry.name))files.push(filename);
  }};
  visit(root);
  for(const filename of files){
    const source=fs.readFileSync(filename,'utf8');
    for(const key of forbidden)assert.equal(source.includes(key),false,`${path.relative(root,filename)} references ${key}`);
  }
});
