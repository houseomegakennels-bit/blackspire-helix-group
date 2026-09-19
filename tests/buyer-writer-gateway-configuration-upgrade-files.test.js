import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createBuyerWriterGatewayConfigurationFileControls,
  reconcileBuyerWriterGatewayConfigurationFile,
  rollbackBuyerWriterGatewayConfigurationFile} from
  '../packages/buyer-writer/gateway-configuration-upgrade-files.js';
import {upgradeBuyerWriterGatewayConfiguration} from
  '../packages/buyer-writer/gateway-configuration-upgrade.js';

const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const secret=()=>randomBytes(32).toString('base64url');
const rootOnly={skip:process.getuid?.()!==0};

function configs(){
  const workspace='blackspire-command',runtime={host:'db.kchtrvfcixnimvxxctkj.supabase.co',
    port:5432,database:'postgres',password:secret(),ca},issuer={...runtime,password:secret()};
  const base={workspace,socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:secret(),
    creatorOid:16384,authority:{releaseSha:'a'.repeat(40),operationId:randomUUID(),
      attemptId:randomUUID(),workspace,gatewayIdentity:'blackspire-writer'},runtime,issuer};
  const oldConfiguration={version:2,...base};
  const authority={...base.authority,releaseSha:'b'.repeat(40),operationId:randomUUID(),
    attemptId:randomUUID()},keyId='active';
  const permit={issuer:'zola-control',audience:'buyer-writer',subject:randomUUID(),keyId,
    origin:'https://blackspirehelix.com',releaseSha:authority.releaseSha,
    operationId:authority.operationId,attemptId:authority.attemptId,workspace};
  const publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
  const newConfiguration={version:4,mode:'research-admission',...base,authority,
    admission:{connection:{host:runtime.host,port:5432,database:'postgres',
      user:'buyer_writer_admission_login',password:secret(),ca},
    operationPermitConfiguration:JSON.stringify(permit),
    verificationConfiguration:{version:2,keys:[{keyId,publicKeyPem,lifecycle:'current',
      verifyNotBefore:0,verifyNotAfter:null}]}}};
  return {oldConfiguration,newConfiguration};
}
function fixture(t,{quiesced=true}={}){
  const root=fs.mkdtempSync('/root/zola-gateway-upgrade-'),configDirectory=path.join(root,'gateway'),
    stateDirectory=path.join(root,'state'),configurationFile=path.join(configDirectory,'gateway.json'),
    writerGroupId=982,values=configs(),events=[];
  const bound={releaseSha:values.newConfiguration.authority.releaseSha,
    operationId:values.newConfiguration.authority.operationId,
    attemptId:values.newConfiguration.authority.attemptId,
    artifactDigest:'c'.repeat(64),candidateDigest:'d'.repeat(64)};
  const {operationId}=bound;
  fs.mkdirSync(configDirectory,{mode:0o750});fs.chownSync(configDirectory,0,writerGroupId);
  fs.mkdirSync(stateDirectory,{mode:0o700});fs.chownSync(stateDirectory,0,0);
  fs.writeFileSync(configurationFile,JSON.stringify(values.oldConfiguration)+'\n',{mode:0o640});
  fs.chownSync(configurationFile,0,writerGroupId);fs.chmodSync(configurationFile,0o640);
  const controls=createBuyerWriterGatewayConfigurationFileControls({...bound,writerGroupId,
    configurationFile,stateDirectory,proveQuiesced:async()=>quiesced});
  const input={...bound,...values,controls,appendJournal:async event=>events.push(event),
    now:()=>Date.UTC(2026,8,18,10,30,0)};
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,configDirectory,stateDirectory,configurationFile,writerGroupId,operationId,bound,
    values,events,controls,input};
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function journalPrefix(f,phases=['started','quiesced','prepared']){
  const digest=value=>createHash('sha256').update(JSON.stringify(value)+'\n').digest('hex');
  return phases.map(phase=>({version:1,kind:'buyer_writer_gateway_configuration_upgrade',
    ...f.bound,phase,status:'IN_PROGRESS',oldConfigDigest:digest(f.values.oldConfiguration),
    newConfigDigest:digest(f.values.newConfiguration),updatedAt:'2026-09-19T00:00:00.000Z'}));
}

test('actual files atomically upgrade, retain a root-only exact backup and durable completed state',rootOnly,async t=>{
  const f=fixture(t);
  const result=await upgradeBuyerWriterGatewayConfiguration(f.input);
  assert.equal(result.status,'UPGRADED');
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  const backup=path.join(f.stateDirectory,f.operationId+'.backup.json');
  const state=path.join(f.stateDirectory,f.operationId+'.state.json');
  assert.deepEqual(read(backup),f.values.oldConfiguration);
  assert.equal(fs.statSync(backup).mode&0o777,0o600);
  assert.equal(fs.statSync(backup).uid,0);assert.equal(fs.statSync(backup).gid,0);
  assert.equal(read(state).phase,'COMPLETED');
  assert.equal(fs.statSync(f.configurationFile).mode&0o777,0o640);
  assert.equal(fs.statSync(f.configurationFile).gid,f.writerGroupId);
  const serialized=JSON.stringify([result,f.events,read(state)]);
  for(const value of [f.values.oldConfiguration.runtime.password,
    f.values.newConfiguration.admission.connection.password])
    assert.equal(serialized.includes(value),false);
});
test('quiescence refusal creates no upgrade artifacts and preserves the old inode',rootOnly,async t=>{
  const f=fixture(t,{quiesced:false}),before=fs.statSync(f.configurationFile);
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f.input),
    error=>error.rollbackSafe===false);
  assert.equal(fs.statSync(f.configurationFile).ino,before.ino);
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.deepEqual(fs.readdirSync(f.stateDirectory),[]);
});

test('replacement race is detected and the exact backup is restored',rootOnly,async t=>{
  const f=fixture(t),base=f.controls;
  const controls={...base,publishReplacement:async(prepared,value)=>{
    fs.writeFileSync(f.configurationFile,JSON.stringify({...f.values.oldConfiguration,
      creatorOid:99999})+'\n');
    fs.chownSync(f.configurationFile,0,f.writerGroupId);fs.chmodSync(f.configurationFile,0o640);
    return base.publishReplacement(prepared,value);
  }};
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration({...f.input,controls}),
    error=>error.rollbackSafe===true);
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('hard-linked current configuration and pre-existing state are refused without replacement',rootOnly,async t=>{
  const f=fixture(t),link=path.join(f.configDirectory,'alias.json');
  fs.linkSync(f.configurationFile,link);
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(f.input),
    error=>error.rollbackSafe===false);
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
});

test('completed upgrade can be explicitly rolled back from durable state',rootOnly,async t=>{
  const f=fixture(t);
  await upgradeBuyerWriterGatewayConfiguration(f.input);
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  const result=await rollbackBuyerWriterGatewayConfigurationFile({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('manual rollback refuses a running service, state drift and current configuration drift',rootOnly,async t=>{
  const running=fixture(t);await upgradeBuyerWriterGatewayConfiguration(running.input);
  await assert.rejects(()=>rollbackBuyerWriterGatewayConfigurationFile({
    ...running.bound,writerGroupId:running.writerGroupId,
    configurationFile:running.configurationFile,stateDirectory:running.stateDirectory,
    proveQuiesced:async()=>false,
  }));
  assert.deepEqual(read(running.configurationFile),running.values.newConfiguration);

  const drift=fixture(t);await upgradeBuyerWriterGatewayConfiguration(drift.input);
  fs.writeFileSync(drift.configurationFile,JSON.stringify({...drift.values.oldConfiguration,
    creatorOid:99999})+'\n');
  fs.chownSync(drift.configurationFile,0,drift.writerGroupId);fs.chmodSync(drift.configurationFile,0o640);
  await assert.rejects(()=>rollbackBuyerWriterGatewayConfigurationFile({
    ...drift.bound,writerGroupId:drift.writerGroupId,
    configurationFile:drift.configurationFile,stateDirectory:drift.stateDirectory,
    proveQuiesced:async()=>true,
  }));
});


test('rollback recovers a crash after prepare before publication',rootOnly,async t=>{
  const f=fixture(t),prepared=await f.controls.prepareReplacement(
    f.values.oldConfiguration,f.values.newConfiguration);
  assert.ok(prepared);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'PREPARED');
  const result=await rollbackBuyerWriterGatewayConfigurationFile({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('rollback recovers a crash after rename before published-state update',rootOnly,async t=>{
  const f=fixture(t);
  await f.controls.prepareReplacement(f.values.oldConfiguration,f.values.newConfiguration);
  fs.renameSync(path.join(f.stateDirectory,'.'+f.operationId+'.candidate'),f.configurationFile);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'PREPARED');
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  const result=await rollbackBuyerWriterGatewayConfigurationFile({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('rollback closes an intent-only crash without requiring a backup',rootOnly,async t=>{
  const f=fixture(t),stateFile=path.join(f.stateDirectory,f.operationId+'.state.json');
  const digest=value=>createHash('sha256').update(JSON.stringify(value)+'\n').digest('hex');
  fs.writeFileSync(stateFile,JSON.stringify({
    version:2,kind:'buyer_writer_gateway_configuration_upgrade',...f.bound,
    phase:'INTENT',configurationFile:f.configurationFile,
    backupFile:path.join(f.stateDirectory,f.operationId+'.backup.json'),
    oldConfigDigest:digest(f.values.oldConfiguration),
    newConfigDigest:digest(f.values.newConfiguration),
  })+'\n',{mode:0o600});
  fs.chownSync(stateFile,0,0);fs.chmodSync(stateFile,0o600);
  const result=await rollbackBuyerWriterGatewayConfigurationFile({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(stateFile).phase,'ROLLED_BACK');
});


test('a service start immediately before publish aborts and restores old configuration',rootOnly,async t=>{
  const f=fixture(t),checks={count:0};
  const controls=createBuyerWriterGatewayConfigurationFileControls({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>++checks.count!==3,
  });
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration({...f.input,controls}),
    error=>error.rollbackSafe===true);
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('a service start immediately before manual rollback preserves the new configuration',rootOnly,async t=>{
  const f=fixture(t);await upgradeBuyerWriterGatewayConfiguration(f.input);
  let checks=0;
  await assert.rejects(()=>rollbackBuyerWriterGatewayConfigurationFile({
    ...f.bound,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>++checks===1,
  }));
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  assert.equal(fs.existsSync(path.join(f.stateDirectory,'.'+f.operationId+'.manual-restore')),false);
});


test('completed-journal failure retains the plan and restores the exact old file',rootOnly,async t=>{
  const f=fixture(t);
  const appendJournal=async event=>{
    f.events.push(event);
    if(event.phase==='completed')throw new Error('PRIVATE journal failure');
  };
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration({...f.input,appendJournal}),
    error=>error.rollbackSafe===true);
  assert.deepEqual(read(f.configurationFile),f.values.oldConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
  assert.equal(f.events.at(-1).phase,'rolled-back');
});

test('reconcile completes an exact post-publication v4 observation without redispatch',rootOnly,async t=>{
  const f=fixture(t),events=journalPrefix(f);
  await f.controls.prepareReplacement(f.values.oldConfiguration,f.values.newConfiguration);
  fs.renameSync(path.join(f.stateDirectory,'.'+f.operationId+'.candidate'),f.configurationFile);
  const result=await reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,...f.values,journalEvents:events,appendJournal:async row=>events.push(row),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true,
    now:()=>Date.UTC(2026,8,19,0,1,0),
  });
  assert.equal(result.status,'UPGRADED');assert.equal(result.reconciled,true);
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'COMPLETED');
  assert.deepEqual(events.map(row=>row.phase),['started','quiesced','prepared',
    'configuration-published','configuration-verified','completed']);
});

test('completed journal with PUBLISHED state finalizes idempotently after atomic-state crash',rootOnly,async t=>{
  const f=fixture(t),events=journalPrefix(f,
    ['started','quiesced','prepared','configuration-published','configuration-verified']);
  const prepared=await f.controls.prepareReplacement(
    f.values.oldConfiguration,f.values.newConfiguration);
  assert.equal(await f.controls.publishReplacement(prepared,f.values.newConfiguration),true);
  const stateFile=path.join(f.stateDirectory,f.operationId+'.state.json');
  assert.equal(read(stateFile).phase,'PUBLISHED');
  let armed=true;
  const io=new Proxy(fs,{get(target,property){
    if(property==='renameSync')return (from,to)=>{
      if(armed&&to===stateFile&&events.at(-1)?.phase==='completed'){
        armed=false;throw new Error('lost after completed journal append');
      }
      return target.renameSync(from,to);
    };
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  await assert.rejects(()=>reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,...f.values,journalEvents:events,appendJournal:async row=>events.push(row),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true,io,
  }));
  assert.equal(read(stateFile).phase,'PUBLISHED');
  assert.equal(events.filter(row=>row.phase==='completed').length,1);
  const input={...f.bound,...f.values,journalEvents:events,
    appendJournal:async()=>assert.fail('completed journal must not be duplicated'),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true};
  assert.equal((await reconcileBuyerWriterGatewayConfigurationFile(input)).status,'UPGRADED');
  assert.equal(read(stateFile).phase,'COMPLETED');
  assert.equal((await reconcileBuyerWriterGatewayConfigurationFile(input)).status,'UPGRADED');
  assert.equal(events.filter(row=>row.phase==='completed').length,1);
});

test('reconcile closes durable INTENT without requiring a backup',rootOnly,async t=>{
  const f=fixture(t),events=journalPrefix(f,['started','quiesced']);
  const digest=value=>createHash('sha256').update(JSON.stringify(value)+'\n').digest('hex');
  const stateFile=path.join(f.stateDirectory,f.operationId+'.state.json');
  fs.writeFileSync(stateFile,JSON.stringify({
    version:2,kind:'buyer_writer_gateway_configuration_upgrade',...f.bound,
    phase:'INTENT',configurationFile:f.configurationFile,
    backupFile:path.join(f.stateDirectory,f.operationId+'.backup.json'),
    oldConfigDigest:digest(f.values.oldConfiguration),
    newConfigDigest:digest(f.values.newConfiguration),
  })+'\n',{mode:0o600});
  fs.chownSync(stateFile,0,0);fs.chmodSync(stateFile,0o600);
  const result=await reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,...f.values,journalEvents:events,appendJournal:async row=>events.push(row),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.equal(fs.existsSync(path.join(f.stateDirectory,f.operationId+'.backup.json')),false);
  assert.deepEqual(events.map(row=>row.phase),['started','quiesced','rolled-back']);
});

test('reconcile bridges quiesced journal to durable PREPARED state before rollback',rootOnly,async t=>{
  const f=fixture(t),events=journalPrefix(f,['started','quiesced']);
  await f.controls.prepareReplacement(f.values.oldConfiguration,f.values.newConfiguration);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'PREPARED');
  const result=await reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,...f.values,journalEvents:events,appendJournal:async row=>events.push(row),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.deepEqual(events.map(row=>row.phase),['started','quiesced','prepared','rolled-back']);
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
});

test('reconcile closes a prepared old observation as rollback and rejects binding drift',rootOnly,async t=>{
  const f=fixture(t),events=journalPrefix(f);
  await f.controls.prepareReplacement(f.values.oldConfiguration,f.values.newConfiguration);
  const result=await reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,...f.values,journalEvents:events,appendJournal:async row=>events.push(row),
    writerGroupId:f.writerGroupId,configurationFile:f.configurationFile,
    stateDirectory:f.stateDirectory,proveQuiesced:async()=>true,
  });
  assert.equal(result.status,'ROLLED_BACK');
  assert.equal(read(path.join(f.stateDirectory,f.operationId+'.state.json')).phase,'ROLLED_BACK');
  assert.equal(events.at(-1).phase,'rolled-back');
  await assert.rejects(()=>reconcileBuyerWriterGatewayConfigurationFile({
    ...f.bound,candidateDigest:'e'.repeat(64),...f.values,journalEvents:events,
    appendJournal:async()=>{},writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>true,
  }));
});

test('extended and inherited ACLs are rejected before credential copies are created',rootOnly,async t=>{
  const current=fixture(t);
  execFileSync('/usr/bin/setfacl',['-m','u:65534:r--',current.configurationFile]);
  fs.chmodSync(current.configurationFile,0o640);
  await assert.rejects(()=>upgradeBuyerWriterGatewayConfiguration(current.input),
    error=>error.rollbackSafe===false);
  assert.deepEqual(fs.readdirSync(current.stateDirectory),[]);

  const inherited=fixture(t);
  execFileSync('/usr/bin/setfacl',['-m','d:u:65534:r-x',inherited.stateDirectory]);
  fs.chmodSync(inherited.stateDirectory,0o700);
  assert.throws(()=>createBuyerWriterGatewayConfigurationFileControls({
    ...inherited.bound,writerGroupId:inherited.writerGroupId,
    configurationFile:inherited.configurationFile,stateDirectory:inherited.stateDirectory,
    proveQuiesced:async()=>true,
  }));
  assert.deepEqual(fs.readdirSync(inherited.stateDirectory),[]);
});
