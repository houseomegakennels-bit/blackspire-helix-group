import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {
  inspectBuyerWriterGatewayConfigurationUpgrade,
  upgradeBuyerWriterGatewayConfiguration,
} from '../packages/buyer-writer/gateway-configuration-upgrade.js';

const secret=()=>randomBytes(32).toString('base64url');
const ca=readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const clone=value=>structuredClone(value);

function configurationFixture(){
  const workspace='blackspire-command',gatewayCapability=secret();
  const runtime={host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',
    password:secret(),ca};
  const issuer={...runtime,password:secret()};
  const oldAuthority={releaseSha:'a'.repeat(40),operationId:randomUUID(),attemptId:randomUUID(),
    workspace,gatewayIdentity:'blackspire-writer'};
  const oldConfiguration={version:2,workspace,socketPath:'/run/blackspire/buyer-writer.sock',
    gatewayCapability,creatorOid:16384,authority:oldAuthority,runtime,issuer};
  const authority={...oldAuthority,releaseSha:'b'.repeat(40),operationId:randomUUID(),
    attemptId:randomUUID()};
  const keyId='active-2026-09';
  const publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  const permit={issuer:'zola-control',audience:'buyer-writer',subject:randomUUID(),keyId,
    origin:'https://blackspirehelix.com',releaseSha:authority.releaseSha,
    operationId:authority.operationId,attemptId:authority.attemptId,workspace};
  const newConfiguration={...oldConfiguration,version:4,mode:'research-admission',authority,
    admission:{connection:{host:runtime.host,port:runtime.port,database:runtime.database,
      user:'buyer_writer_admission_login',password:secret(),ca},
    operationPermitConfiguration:JSON.stringify(permit),
    verificationConfiguration:{version:2,keys:[{keyId,publicKeyPem,lifecycle:'current',
      verifyNotBefore:0,verifyNotAfter:null}]}}};
  return {oldConfiguration,newConfiguration};
}

function harness({failure=null}={}){
  const config=configurationFixture(),events=[],calls=[],failed=new Set();
  let active='old';
  const invoke=async(name,result=true)=>{
    calls.push(name);
    if(failure===name&&!failed.has(name)){
      failed.add(name);
      throw new Error('PRIVATE failure');
    }
    return result;
  };
  const controls={
    assertQuiesced:()=>invoke('assertQuiesced'),
    prepareReplacement:async()=>{
      await invoke('prepareReplacement');
      return {opaque:true};
    },
    publishReplacement:async()=>{
      await invoke('publishReplacement');
      active='new';
      return true;
    },
    verifyReplacement:async value=>{
      await invoke('verifyReplacement');
      return active===(value.version===4?'new':'old');
    },
    restoreReplacement:async()=>{
      await invoke('restoreReplacement');
      active='old';
      return true;
    },
    finalizeReplacement:(_prepared,mode)=>invoke('finalizeReplacement:'+mode),
  };
  return {...config,operationId:randomUUID(),controls,events,calls,
    appendJournal:async event=>{
      calls.push('journal:'+event.phase);
      if(failure==='journal:'+event.phase)throw new Error('PRIVATE journal');
      events.push(event);
    },
    now:()=>Date.UTC(2026,8,18,10,0,0),
    active:()=>active};
}

test('inspection accepts only an invariant-preserving v2 to v4 upgrade and exposes no secrets',()=>{
  const f=harness();
  const result=inspectBuyerWriterGatewayConfigurationUpgrade(f);
  assert.equal(result.status,'UPGRADE_PREPARED');
  assert.equal(result.requiresQuiescence,true);
  assert.equal(result.mutationEnabled,false);
  assert.match(result.oldConfigDigest,/^[a-f0-9]{64}$/);
  assert.match(result.newConfigDigest,/^[a-f0-9]{64}$/);
  const serialized=JSON.stringify(result);
  for(const value of [f.oldConfiguration.runtime.password,f.oldConfiguration.issuer.password,
    f.oldConfiguration.gatewayCapability,f.newConfiguration.admission.connection.password])
    assert.equal(serialized.includes(value),false);
});
test('inspection rejects credential, database identity, authority and direction drift',()=>{
  const base=harness();
  const mutations=[
    value=>{value.newConfiguration.gatewayCapability=secret();},
    value=>{value.newConfiguration.runtime.password=secret();},
    value=>{value.newConfiguration.issuer.database='other';},
    value=>{value.newConfiguration.creatorOid++;},
    value=>{value.newConfiguration.workspace='other';},
    value=>{value.newConfiguration.authority.releaseSha=value.oldConfiguration.authority.releaseSha;
      const permit=JSON.parse(value.newConfiguration.admission.operationPermitConfiguration);
      permit.releaseSha=value.newConfiguration.authority.releaseSha;
      value.newConfiguration.admission.operationPermitConfiguration=JSON.stringify(permit);},
    value=>{value.oldConfiguration=clone(value.newConfiguration);},
  ];
  for(const mutate of mutations){
    const value={...base,oldConfiguration:clone(base.oldConfiguration),
      newConfiguration:clone(base.newConfiguration)};
    mutate(value);
    assert.throws(()=>inspectBuyerWriterGatewayConfigurationUpgrade(value),
      /^Error: Buyer writer gateway configuration upgrade failed$/);
  }
});

test('successful upgrade is quiesced, journaled, verified and finalized in order',async()=>{
  const f=harness();
  const result=await upgradeBuyerWriterGatewayConfiguration(f);
  assert.equal(result.status,'UPGRADED');
  assert.equal(f.active(),'new');
  assert.deepEqual(f.events.map(row=>[row.phase,row.status]),[
    ['started','IN_PROGRESS'],['quiesced','IN_PROGRESS'],['prepared','IN_PROGRESS'],
    ['configuration-published','IN_PROGRESS'],['configuration-verified','IN_PROGRESS'],
    ['completed','COMPLETED'],
  ]);
  assert.deepEqual(f.calls.filter(value=>!value.startsWith('journal:')),[
    'assertQuiesced','prepareReplacement','publishReplacement','verifyReplacement',
    'finalizeReplacement:commit',
  ]);
  const serialized=JSON.stringify([result,f.events]);
  for(const value of [f.oldConfiguration.runtime.password,
    f.newConfiguration.admission.connection.password])
    assert.equal(serialized.includes(value),false);
});

test('pre-publication failure restores prepared state and reports rollback-safe',async()=>{
  for(const failure of ['publishReplacement','verifyReplacement']){
    const f=harness({failure});
    await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f),
      error=>error.message==='Buyer writer gateway configuration upgrade failed'
        &&error.rollbackSafe===true);
    assert.equal(f.active(),'old');
    assert.ok(f.calls.includes('restoreReplacement'));
    assert.ok(f.calls.includes('finalizeReplacement:rollback'));
    assert.equal(f.events.at(-1).status,'ROLLED_BACK');
  }
});

test('post-publication verification or finalization failure restores the exact old state',async()=>{
  for(const failure of ['verifyReplacement','finalizeReplacement:commit']){
    const f=harness({failure});
    await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f),
      error=>error.message==='Buyer writer gateway configuration upgrade failed'
        &&error.rollbackSafe===true);
    assert.equal(f.active(),'old');
    assert.ok(f.calls.includes('restoreReplacement'));
    assert.ok(f.calls.includes('finalizeReplacement:rollback'));
    assert.equal(f.events.at(-1).phase,'rolled-back');
  }
});

test('quiescence and journal failures never publish a replacement',async()=>{
  for(const failure of ['assertQuiesced','journal:started']){
    const f=harness({failure});
    await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f),
      error=>error.message==='Buyer writer gateway configuration upgrade failed'
        &&error.rollbackSafe===false);
    assert.equal(f.active(),'old');
    assert.equal(f.calls.includes('publishReplacement'),false);
  }
});

test('failed restore is explicitly not rollback-safe and records fail-closed',async()=>{
  const f=harness({failure:'restoreReplacement'});
  f.controls.verifyReplacement=async()=>{f.calls.push('verifyReplacement');return false;};
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f),
    error=>error.message==='Buyer writer gateway configuration upgrade failed'
      &&error.rollbackSafe===false);
  assert.equal(f.active(),'new');
  assert.equal(f.events.at(-1).status,'FAIL_CLOSED');
});
