import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {validateBuyerWriterConfiguration,validateBuyerWriterGatewayProvisioningConfiguration} from '../packages/buyer-writer/configuration.js';
const fixture=()=>({version:1,workspace:'isolated',bindingFile:'/etc/blackspire/writer-binding.json',writerCredential:randomBytes(32).toString('base64url'),issuerCredential:randomBytes(32).toString('base64url'),creatorOid:16384,
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
    v=>{v.runtime.ca='PRIVATE';},v=>{delete v.issuer;},v=>{v.creatorOid=0;},v=>{v.creatorOid='16384';},
  ]){const value=fixture();mutate(value);assert.throws(()=>validateBuyerWriterConfiguration(value,{workspace:'isolated'}),error=>error.message==='Buyer writer configuration rejected'&&!error.cause);}
});
test('only verified staging configuration accepts a distinct noncanonical unit pair',()=>{
  const config=fixture();config.units={api:'zola-isolated-api.service',worker:'zola-isolated-worker.service'};
  assert.throws(()=>validateBuyerWriterConfiguration(config,{workspace:'isolated',environment:'production'}));
  assert.throws(()=>validateBuyerWriterConfiguration(config,{workspace:'isolated'}));
  for(const environment of ['staging','disposable-staging']){
    assert.deepEqual(validateBuyerWriterConfiguration(config,{workspace:'isolated',environment}).units,config.units);
  }
  for(const units of [{api:'blackspire-command.service',worker:'zola-worker.service'},{api:'zola-api.service',worker:'blackspire-command-worker.service'},
    {api:'same.service',worker:'same.service'},{api:'../other.service',worker:'zola-worker.service'},{api:'one.service'},
  ])assert.throws(()=>validateBuyerWriterConfiguration({...config,units},{workspace:'isolated',environment:'disposable-staging'}));
});

const gatewayFixture=()=>{
  const secret=()=>randomBytes(32).toString('base64url'),workspace='blackspire-command';
  const authority={releaseSha:'a'.repeat(40),operationId:randomUUID(),attemptId:randomUUID(),workspace,gatewayIdentity:'blackspire-writer'};
  const permit={issuer:'zola-control',audience:'buyer-writer',subject:randomUUID(),keyId:'fixture-key',origin:'https://zola.example',
    releaseSha:authority.releaseSha,operationId:authority.operationId,attemptId:authority.attemptId,workspace};
  const verification={version:2,keys:[{keyId:'fixture-key',
    publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),
    lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]};
  const ca='-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n';
  return {version:4,workspace,bindingFile:'/etc/blackspire/buyer-writer-binding.json',writerCredential:secret(),
    issuerCredential:secret(),admissionCredential:secret(),gatewayCapability:secret(),creatorOid:16384,authority,
    runtime:{host:'db.example.test',port:5432,database:'postgres',password:secret(),ca},
    issuer:{host:'db.example.test',port:5432,database:'postgres',password:secret(),ca},
    operationPermitConfiguration:JSON.stringify(permit),operationPermitVerificationConfiguration:verification,
    operationPermitSignerConfiguration:{version:1,activeKeyId:'fixture-key',
      activePrivateKeyPath:'/etc/blackspire/buyer-writer-signing-key.pem',verification}};
};
test('gateway v4 provisioning accepts only pinned exact admission and public permit authority',()=>{
  const valid=gatewayFixture();
  assert.deepEqual(validateBuyerWriterGatewayProvisioningConfiguration(valid,{workspace:valid.workspace}),valid);
  for(const mutate of [
    v=>{v.admissionCredential=v.runtime.password;},v=>{v.runtime.connectionString='postgres://forbidden';},
    v=>{delete v.runtime.ca;},v=>{v.issuer.ca+='drift';},v=>{v.issuer.host='other.example.test';},
    v=>{v.operationPermitConfiguration=JSON.stringify({...JSON.parse(v.operationPermitConfiguration),workspace:'other'});},
    v=>{v.operationPermitConfiguration+=' ';},v=>{v.operationPermitVerificationConfiguration.keys[0].publicKeyPem=generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'});},
    v=>{v.privateKey='forbidden';},
  ]){const value=gatewayFixture();mutate(value);
    assert.throws(()=>validateBuyerWriterGatewayProvisioningConfiguration(value,{workspace:value.workspace}),/^Error: Buyer writer gateway provisioning configuration rejected$/);
  }
});
