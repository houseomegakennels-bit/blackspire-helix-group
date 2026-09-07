import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {validateBuyerWriterConfiguration} from '../packages/buyer-writer/configuration.js';
const fixture=()=>({version:1,workspace:'isolated',bindingFile:'/etc/blackspire/writer-binding.json',writerCredential:randomBytes(32).toString('base64url'),issuerCredential:randomBytes(32).toString('base64url'),
  runtime:{host:'isolated.example.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')},
  issuer:{host:'isolated.example.test',port:5432,database:'postgres',password:randomBytes(32).toString('base64url')}});
test('explicit configuration preserves separate scoped identities without consulting ambient settings',()=>{
  const input=fixture(),output=validateBuyerWriterConfiguration(input,{workspace:'isolated'});
  assert.deepEqual(output,input);assert.notEqual(output,input);assert.notEqual(output.runtime,input.runtime);
  assert.equal(Object.isFrozen(output),true);assert.equal(Object.isFrozen(output.runtime),true);
  input.runtime.password='changed';assert.notEqual(output.runtime.password,input.runtime.password);
});
test('privileged role overrides, connection strings, cross-target pools and reused credentials are rejected',()=>{
  for(const mutate of [
    v=>{v.runtime.user='postgres';},v=>{v.runtime.connectionString='postgres://example';},v=>{v.issuer.host='other.example.test';},
    v=>{v.issuer.port=6432;},v=>{v.issuer.database='other';},v=>{v.issuer.password=v.runtime.password;},
    v=>{v.writerCredential=v.runtime.password;},v=>{v.issuerCredential=v.writerCredential;},v=>{v.runtime.ssl=false;},
  ]){const value=fixture();mutate(value);assert.throws(()=>validateBuyerWriterConfiguration(value,{workspace:'isolated'}),/^Error: Buyer writer configuration rejected$/);}
});
test('malformed scope, paths, secrets, database settings and unexpected fields fail without disclosing input',()=>{
  for(const mutate of [
    v=>{v.workspace='other';},v=>{v.extra='PRIVATE';},v=>{v.bindingFile='/etc/blackspire/../writer.json';},
    v=>{v.bindingFile='relative.json';},v=>{v.bindingFile='/';},v=>{v.writerCredential='PRIVATE';},
    v=>{v.runtime.password='x'.repeat(43);},v=>{v.runtime.port=0;},v=>{v.runtime.host='host/path';},
    v=>{v.runtime.ca='PRIVATE';},v=>{delete v.issuer;},
  ]){const value=fixture();mutate(value);assert.throws(()=>validateBuyerWriterConfiguration(value,{workspace:'isolated'}),error=>error.message==='Buyer writer configuration rejected'&&!error.cause);}
});
