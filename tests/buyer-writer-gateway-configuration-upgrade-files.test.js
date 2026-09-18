import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {createBuyerWriterGatewayConfigurationFileControls,
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
    writerGroupId=982,operationId=randomUUID(),values=configs(),events=[];
  fs.mkdirSync(configDirectory,{mode:0o750});fs.chownSync(configDirectory,0,writerGroupId);
  fs.mkdirSync(stateDirectory,{mode:0o700});fs.chownSync(stateDirectory,0,0);
  fs.writeFileSync(configurationFile,JSON.stringify(values.oldConfiguration)+'\n',{mode:0o640});
  fs.chownSync(configurationFile,0,writerGroupId);fs.chmodSync(configurationFile,0o640);
  const controls=createBuyerWriterGatewayConfigurationFileControls({operationId,writerGroupId,
    configurationFile,stateDirectory,proveQuiesced:async()=>quiesced});
  const input={operationId,...values,controls,appendJournal:async event=>events.push(event),
    now:()=>Date.UTC(2026,8,18,10,30,0)};
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  return {root,configDirectory,stateDirectory,configurationFile,writerGroupId,operationId,
    values,events,controls,input};
}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));

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
    operationId:f.operationId,writerGroupId:f.writerGroupId,
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
    operationId:running.operationId,writerGroupId:running.writerGroupId,
    configurationFile:running.configurationFile,stateDirectory:running.stateDirectory,
    proveQuiesced:async()=>false,
  }));
  assert.deepEqual(read(running.configurationFile),running.values.newConfiguration);

  const drift=fixture(t);await upgradeBuyerWriterGatewayConfiguration(drift.input);
  fs.writeFileSync(drift.configurationFile,JSON.stringify({...drift.values.oldConfiguration,
    creatorOid:99999})+'\n');
  fs.chownSync(drift.configurationFile,0,drift.writerGroupId);fs.chmodSync(drift.configurationFile,0o640);
  await assert.rejects(()=>rollbackBuyerWriterGatewayConfigurationFile({
    operationId:drift.operationId,writerGroupId:drift.writerGroupId,
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
    operationId:f.operationId,writerGroupId:f.writerGroupId,
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
    operationId:f.operationId,writerGroupId:f.writerGroupId,
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
    version:1,kind:'buyer_writer_gateway_configuration_upgrade',operationId:f.operationId,
    phase:'INTENT',configurationFile:f.configurationFile,
    backupFile:path.join(f.stateDirectory,f.operationId+'.backup.json'),
    oldConfigDigest:digest(f.values.oldConfiguration),
    newConfigDigest:digest(f.values.newConfiguration),
  })+'\n',{mode:0o600});
  fs.chownSync(stateFile,0,0);fs.chmodSync(stateFile,0o600);
  const result=await rollbackBuyerWriterGatewayConfigurationFile({
    operationId:f.operationId,writerGroupId:f.writerGroupId,
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
    operationId:f.operationId,writerGroupId:f.writerGroupId,
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
    operationId:f.operationId,writerGroupId:f.writerGroupId,
    configurationFile:f.configurationFile,stateDirectory:f.stateDirectory,
    proveQuiesced:async()=>++checks===1,
  }));
  assert.deepEqual(read(f.configurationFile),f.values.newConfiguration);
  assert.equal(fs.existsSync(path.join(f.stateDirectory,'.'+f.operationId+'.manual-restore')),false);
});
