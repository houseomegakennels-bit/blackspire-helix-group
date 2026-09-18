import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {inspectBuyerWriterAdmissionSecretRotation,rotateBuyerWriterAdmissionSecret} from '../packages/buyer-writer/admission-secret-rotation.js';
import {appendAdmissionSecretRotationJournal,encodeAdmissionSecretRotationEvent,
  inspectAdmissionSecretRotationJournal} from '../packages/buyer-writer/admission-secret-rotation-journal.js';

const secret=()=>randomBytes(32).toString('base64url');
function configurations(){
  const releaseSha='a'.repeat(40),operationId=randomUUID(),attemptId=randomUUID(),workspace='blackspire-command';
  const authority={releaseSha,operationId,attemptId,workspace,gatewayIdentity:'blackspire-writer'};
  const runtime={host:'db.invalid',port:5432,database:'postgres',password:secret(),
    ca:fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8')};
  const issuer={...runtime,password:secret()};
  const permit=JSON.stringify({issuer:'issuer',audience:'buyer-writer',subject:randomUUID(),keyId:'key',
    origin:'https://writer.invalid',releaseSha,operationId,attemptId,workspace});
  const oldConfiguration={version:4,mode:'research-admission',workspace,socketPath:'/run/blackspire/buyer-writer.sock',
    gatewayCapability:secret(),creatorOid:16384,authority,runtime,issuer,admission:{
      connection:{host:runtime.host,port:runtime.port,database:runtime.database,user:'buyer_writer_admission_login',
        password:secret(),ca:runtime.ca},operationPermitConfiguration:permit,
      verificationConfiguration:{version:2,keys:[{keyId:'key',
        publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),
        lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]}}};
  const newConfiguration=structuredClone(oldConfiguration);
  newConfiguration.admission.connection.password=secret();
  return {oldConfiguration,newConfiguration,operationId:randomUUID()};
}

function fixture({bind='new',verify=true}={}){
  const config=configurations(),events=[],calls=[];let active='old',published='old';
  const controls={
    assertQuiesced:async()=>{calls.push('quiesced');return true;},
    stopGateway:async()=>{calls.push('stop');return true;},
    prepareConfiguration:async()=>{calls.push('prepare');return {token:'opaque'};},
    bindPassword:async password=>{calls.push('bind');
      if(bind==='throw'){active='new';throw new Error('driver included protected parameter');}
      active=password===config.newConfiguration.admission.connection.password?'new':'old';return true;},
    authenticate:async value=>active===(value.admission.connection.password===
      config.newConfiguration.admission.connection.password?'new':'old'),
    publishConfiguration:async()=>{calls.push('publish');published='new';return true;},
    startGateway:async()=>{calls.push('start');return true;},
    verify:async value=>{
      const expected=value.admission.connection.password===config.newConfiguration.admission.connection.password?'new':'old';
      return verify!==false&&!(verify==='new-fail'&&expected==='new')&&published===expected&&active===published;
    },
    restoreConfiguration:async()=>{calls.push('restore');published='old';return true;},
    finalizeConfiguration:async(_prepared,outcome)=>{calls.push('finalize-'+outcome);return true;},
  };
  return {...config,controls,calls,events,appendJournal:async event=>{events.push(structuredClone(event));return event;},
    now:()=>Date.parse('2026-09-18T01:00:00.000Z')};
}
test('read-only inspection returns only digests and keeps mutation disabled',()=>{
  const f=configurations(),result=inspectBuyerWriterAdmissionSecretRotation(f);
  assert.deepEqual(Object.keys(result).sort(),['mutationEnabled','newConfigDigest','oldConfigDigest',
    'operationId','requiresQuiescence','status']);
  assert.equal(result.status,'ROTATION_PREPARED');assert.equal(result.mutationEnabled,false);
  assert.equal(result.requiresQuiescence,true);
  const serialized=JSON.stringify(result);
  assert.equal(serialized.includes(f.oldConfiguration.admission.connection.password),false);
  assert.equal(serialized.includes(f.newConfiguration.admission.connection.password),false);
});

test('rotation proves the new verifier, publishes once, and records only sanitized phases',async()=>{
  const f=fixture(),result=await rotateBuyerWriterAdmissionSecret(f);
  assert.equal(result.status,'ROTATED');
  assert.deepEqual(f.events.map(event=>event.phase),['started','quiesced','prepared','database-commit-sent',
    'database-new-confirmed','configuration-published','gateway-ready','completed']);
  assert.deepEqual(f.calls,['quiesced','stop','prepare','bind','publish','start','finalize-commit']);
  const serialized=JSON.stringify([result,f.events]);
  for(const value of [f.oldConfiguration.admission.connection.password,f.newConfiguration.admission.connection.password])
    assert.equal(serialized.includes(value),false);
});

test('unknown bind outcome is reconciled by authentication truth without retrying the mutation',async()=>{
  const f=fixture({bind:'throw'}),result=await rotateBuyerWriterAdmissionSecret(f);
  assert.equal(result.status,'ROTATED');assert.equal(f.calls.filter(value=>value==='bind').length,1);
  assert.equal(f.events.at(-1).status,'COMPLETED');
});

test('post-commit verification failure restores the old password and configuration before restart',async()=>{
  const f=fixture({verify:'new-fail'});
  await assert.rejects(rotateBuyerWriterAdmissionSecret(f),error=>
    error.message==='Buyer writer admission secret rotation failed'&&error.rollbackSafe===true);
  assert.equal(f.calls.filter(value=>value==='bind').length,2);
  assert.equal(f.calls.filter(value=>value==='restore').length,1);
  assert.equal(f.calls.filter(value=>value==='finalize-rollback').length,1);
  assert.equal(f.events.at(-1).status,'ROLLED_BACK');
  assert.doesNotMatch(JSON.stringify(f.events),/driver included protected parameter/);
});

test('non-exclusive authentication proof fails closed with the gateway stopped',async()=>{
  const f=fixture();f.controls.authenticate=async()=>false;
  await assert.rejects(rotateBuyerWriterAdmissionSecret(f),error=>
    error.message==='Buyer writer admission secret rotation failed'&&error.rollbackSafe===false);
  assert.equal(f.calls.includes('publish'),false);assert.equal(f.events.at(-1).status,'FAIL_CLOSED');
});

test('plan rejects unrelated configuration drift and a reused admission secret',async()=>{
  for(const change of ['authority','same']){
    const f=fixture();
    if(change==='authority')f.newConfiguration.authority.attemptId=randomUUID();
    else f.newConfiguration.admission.connection.password=f.oldConfiguration.admission.connection.password;
    await assert.rejects(rotateBuyerWriterAdmissionSecret(f),/rotation failed/);
    assert.equal(f.events.length,0);assert.equal(f.calls.length,0);
  }
});
test('rotation journal rejects secret and error fields and verifies its hash chain',()=>{
  const value={version:1,kind:'buyer_writer_admission_secret_rotation',operationId:randomUUID(),
    phase:'started',status:'IN_PROGRESS',oldConfigDigest:'a'.repeat(64),newConfigDigest:'b'.repeat(64),
    updatedAt:'2026-09-18T01:00:00.000Z'};
  const first=encodeAdmissionSecretRotationEvent(value),second=encodeAdmissionSecretRotationEvent({
    ...value,phase:'quiesced',updatedAt:'2026-09-18T01:00:01.000Z'},first.eventDigest);
  const text=JSON.stringify(first)+'\n'+JSON.stringify(second)+'\n';
  assert.equal(inspectAdmissionSecretRotationJournal(text).lastDigest,second.eventDigest);
  const tampered=text.replace('quiesced','prepared');
  assert.throws(()=>inspectAdmissionSecretRotationJournal(tampered),/journal rejected/);
  for(const extra of [{password:'secret'},{error:'driver output'}])
    assert.throws(()=>encodeAdmissionSecretRotationEvent({...value,...extra}),/journal rejected/);
});

test('rotation journal appends root-private sanitized records',{
  skip:process.getuid?.()!==0?'root ownership unavailable':false,
},()=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'admission-rotation-journal-')),root=path.join(parent,'state');
  try{
    const operationId=randomUUID(),base={version:1,kind:'buyer_writer_admission_secret_rotation',operationId,
      phase:'started',status:'IN_PROGRESS',oldConfigDigest:'a'.repeat(64),newConfigDigest:'b'.repeat(64),
      updatedAt:'2026-09-18T01:00:00.000Z'};
    const first=appendAdmissionSecretRotationJournal(base,{root,uid:0});
    const last=appendAdmissionSecretRotationJournal({...base,phase:'quiesced',
      updatedAt:'2026-09-18T01:00:01.000Z'},{root,uid:0});
    assert.equal(last.previousDigest,first.eventDigest);
    const stat=fs.lstatSync(path.join(root,'journal.jsonl'));
    assert.equal(stat.mode&0o7777,0o600);assert.equal(stat.uid,0);assert.equal(stat.gid,0);
    assert.equal(inspectAdmissionSecretRotationJournal(fs.readFileSync(path.join(root,'journal.jsonl'),'utf8')).rows.length,2);
  }finally{fs.rmSync(parent,{recursive:true,force:true});}
});
