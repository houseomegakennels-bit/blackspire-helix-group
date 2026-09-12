import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBuyerWriterRehearsal} from '../packages/buyer-writer/rehearsal.js';
import {validateBuyerWriterConfiguration} from '../packages/buyer-writer/configuration.js';
import {randomBytes} from 'node:crypto';
function fixture(){
  const id='00000000-0000-4000-8000-000000000001',releaseSha='a'.repeat(40),root=`/var/lib/blackspire-zola-rehearsal/activation/${id}`;
  const descriptor={version:1,kind:'isolated-production-rehearsal',id,releaseSha,workspace:'isolated',port:45000,postgresPort:45001};
  const config={rehearsalFile:`${root}/config/rehearsal.json`,bindingFile:`${root}/config/binding.json`,
    units:{api:`zola-writer-api-${id}.service`,worker:`zola-writer-worker-${id}.service`},
    runtime:{host:'localhost',port:45001,database:`zola_writer_${id.replaceAll('-','')}`,ca:'-----BEGIN CERTIFICATE-----\nsynthetic'},
    issuer:{host:'localhost',port:45001,database:`zola_writer_${id.replaceAll('-','')}`,ca:'-----BEGIN CERTIFICATE-----\nsynthetic'}};
  const context={configurationFile:`${root}/config/writer.json`,workspace:'isolated',releaseSha,environment:'production',
    startup:{stateOwner:'vps-production',releaseRoot:root,artifactRoot:`${root}/releases/${releaseSha}`,databasePath:`${root}/shared/database/command.sqlite`,dataDirectory:`${root}/shared`,host:'127.0.0.1',port:45000}};
  return{descriptor,config,context,root};
}
test('isolated production-profile descriptor binds the exact release, units, state and disposable database',()=>{
  const f=fixture(),proof=validateBuyerWriterRehearsal(f.descriptor,f.config,f.context);
  assert.equal(proof.root,f.root);assert.deepEqual(proof.units,f.config.units);assert.equal(Object.isFrozen(proof),true);
});
test('production targets, descriptor drift and labels alone cannot authorize a rehearsal',()=>{
  for(const mutate of [
    f=>{f.descriptor.releaseSha='b'.repeat(40);},f=>{f.descriptor.workspace='other';},f=>{f.descriptor.extra=true;},
    f=>{f.context.startup.databasePath='/var/lib/blackspire-command/command.sqlite';},f=>{f.context.startup.releaseRoot='/opt/blackspire-command';},
    f=>{f.context.startup.artifactRoot='/opt/blackspire-command/releases/'+f.descriptor.releaseSha;},f=>{f.context.startup.dataDirectory='/var/lib/blackspire-command';},
    f=>{f.config.bindingFile='/etc/blackspire/binding.json';},f=>{f.config.rehearsalFile='/etc/blackspire/rehearsal.json';},
    f=>{f.config.units.api='blackspire-command.service';},f=>{f.config.units.worker='blackspire-command-worker.service';},
    f=>{f.config.runtime.host='production.example.test';},f=>{f.config.issuer.database='postgres';},f=>{delete f.config.runtime.ca;},
    f=>{f.context.startup.host='0.0.0.0';},f=>{f.context.startup.port=8789;},f=>{f.descriptor.postgresPort=45000;},
    f=>{f.context.environment='staging';},f=>{f.context.startup.stateOwner='vps-staging';},f=>{delete f.context.startup;},
  ]){const f=fixture();mutate(f);assert.throws(()=>validateBuyerWriterRehearsal(f.descriptor,f.config,f.context),error=>error.message==='Buyer writer rehearsal configuration rejected'&&!error.cause);}
});
test('production unit override requires the exact protected-descriptor proof rather than a copied approval object',()=>{
  const f=fixture();
  Object.assign(f.config,{version:1,workspace:'isolated',writerCredential:randomBytes(32).toString('base64url'),issuerCredential:randomBytes(32).toString('base64url')});
  for(const target of [f.config.runtime,f.config.issuer])target.password=randomBytes(32).toString('base64url');
  const proof=validateBuyerWriterRehearsal(f.descriptor,f.config,f.context);
  assert.deepEqual(validateBuyerWriterConfiguration(f.config,{workspace:'isolated',environment:'production',rehearsal:proof}).units,f.config.units);
  for(const rehearsal of [undefined,true,{approved:true},structuredClone(proof)]){
    assert.throws(()=>validateBuyerWriterConfiguration(f.config,{workspace:'isolated',environment:'production',rehearsal}));
  }
  f.config.units.api='other.service';
  assert.throws(()=>validateBuyerWriterConfiguration(f.config,{workspace:'isolated',environment:'production',rehearsal:proof}));
});
