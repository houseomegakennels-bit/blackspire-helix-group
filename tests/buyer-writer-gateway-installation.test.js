import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GATEWAY_CONFIG_PATH,GATEWAY_NODE,GATEWAY_SERVICE,assertGatewayOnlyEffects,decodeGatewayInstallState,encodeGatewayInstallState,
  gatewayActivationActions,gatewayArtifactPath,gatewayInstallEffects,gatewayRollbackActions,inspectGatewayArtifact,renderGatewayUnit,
  validateGatewayRestoredServiceState,validateGatewayRuntimeObservation,
} from '../packages/buyer-writer/gateway-installation.js';

const sha='a'.repeat(40);
const template=`[Service]\nWorkingDirectory=/opt/blackspire-command/releases/@BLACKSPIRE_GATEWAY_RELEASE_SHA@\nEnvironment=BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG=@BLACKSPIRE_GATEWAY_CONFIG_PATH@\nExecStart=/opt/node/bin/node /opt/blackspire-command/releases/@BLACKSPIRE_GATEWAY_RELEASE_SHA@/packages/buyer-writer/gateway-entry.js\n`;

test('gateway unit authority resolves only to an immutable exact-SHA artifact',()=>{
  const unit=renderGatewayUnit(template,{sha});
  assert.match(unit,new RegExp(`/releases/${sha}/packages/buyer-writer/gateway-entry\\.js`));
  assert.doesNotMatch(unit,/\/current|\/HEAD|@BLACKSPIRE_GATEWAY_/);
  assert.throws(()=>renderGatewayUnit(template.replace('/releases/@BLACKSPIRE_GATEWAY_RELEASE_SHA@','/current'),{sha}),/mutable executable authority|binding is incomplete/);
  assert.throws(()=>renderGatewayUnit(template,{sha:'a'.repeat(39)}),/exact full release SHA/);
});

test('artifact inspection rejects a mismatched packaged SHA and unsafe markers',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-gateway-artifact-'));
  const artifact=gatewayArtifactPath(sha,{releaseRoot:root});
  fs.mkdirSync(path.join(artifact,'packages/buyer-writer'),{recursive:true});
  fs.mkdirSync(path.join(artifact,'ops/runtime-ownership'),{recursive:true});
  for(const [file,value] of [['.release-complete',''],['COMMIT_SHA',`${'b'.repeat(40)}\n`],['packages/buyer-writer/gateway-entry.js','export {};\n'],
    ['packages/buyer-writer/gateway-readiness.js','export {};\n'],[`ops/runtime-ownership/${GATEWAY_SERVICE}`,template]]){
    fs.writeFileSync(path.join(artifact,file),value,{mode:0o644});
  }
  assert.throws(()=>inspectGatewayArtifact({sha,releaseRoot:root}),/artifact SHA rejected/);
  fs.writeFileSync(path.join(artifact,'COMMIT_SHA'),`${sha}\n`);fs.chmodSync(path.join(artifact,'COMMIT_SHA'),0o600);
  assert.throws(()=>inspectGatewayArtifact({sha,releaseRoot:root}),/file contract rejected/);
});

test('artifact inspection rejects a missing immutable readiness executable',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-gateway-readiness-'));
  const artifact=gatewayArtifactPath(sha,{releaseRoot:root});
  fs.mkdirSync(path.join(artifact,'packages/buyer-writer'),{recursive:true});
  fs.mkdirSync(path.join(artifact,'ops/runtime-ownership'),{recursive:true});
  for(const [file,value] of [['.release-complete',''],['COMMIT_SHA',`${sha}\n`],['packages/buyer-writer/gateway-entry.js','export {};\n'],
    [`ops/runtime-ownership/${GATEWAY_SERVICE}`,template]])fs.writeFileSync(path.join(artifact,file),value,{mode:0o644});
  assert.throws(()=>inspectGatewayArtifact({sha,releaseRoot:root}),/missing or unsafe/);
});

test('gateway installation effects cannot stop or replace API, worker, current, n8n, or migrations',()=>{
  const artifact=gatewayArtifactPath(sha);
  const effects=gatewayInstallEffects({sha,artifact,sourceUnit:path.join(artifact,'ops/runtime-ownership',GATEWAY_SERVICE)});
  assert.equal(assertGatewayOnlyEffects(effects),true);
  assert.match(effects.find(effect=>effect.kind==='provision-identity').source,/\.sysusers\.conf$/);
  assert.match(effects.find(effect=>effect.kind==='provision-directories').source,/\.tmpfiles\.conf$/);
  assert.deepEqual(effects.filter(effect=>effect.kind==='enable-start').map(effect=>effect.unit),[GATEWAY_SERVICE]);
  const text=JSON.stringify(effects);
  for(const forbidden of ['blackspire-command.service','blackspire-command-worker.service','n8n','release-switch','migration','/current'])assert.doesNotMatch(text,new RegExp(forbidden.replace('.','\\.')));
  assert.throws(()=>assertGatewayOnlyEffects([...effects,{kind:'stop',unit:'blackspire-command.service'}]),/out-of-scope/);
});

test('installer state is bounded, exact and contains no secret configuration',()=>{
  const unit=renderGatewayUnit(template,{sha});const encoded=encodeGatewayInstallState({sha,unitBackup:null,previousUnit:null,installedUnit:unit});
  const state=decodeGatewayInstallState(encoded);
  assert.equal(state.version,3);assert.equal(state.sha,sha);assert.equal(state.unitBackup,null);assert.equal(state.previousUnitSha256,null);
  assert.equal(state.previousEnabled,false);assert.equal(state.previousActive,false);assert.match(state.installedUnitSha256,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(encoded,/gatewayCapability|password|DATABASE_URL/);
  assert.throws(()=>decodeGatewayInstallState(JSON.stringify({...state,extra:true})),/state rejected/);
  assert.throws(()=>decodeGatewayInstallState(JSON.stringify({...state,unitBackup:'/tmp/old'})),/state rejected/);
  assert.throws(()=>encodeGatewayInstallState({sha,unitBackup:null,previousUnit:null,installedUnit:unit,previousActive:true}),/service state rejected/);
  assert.equal(GATEWAY_CONFIG_PATH,'/etc/blackspire-buyer-writer-gateway/gateway.json');
});

test('activation replaces an already-active process and rollback restores enablement and activity independently',()=>{
  assert.deepEqual(gatewayActivationActions(),[['enable',GATEWAY_SERVICE],['restart',GATEWAY_SERVICE]]);
  const digest='b'.repeat(64);
  assert.deepEqual(gatewayRollbackActions({previousUnitSha256:null,previousEnabled:false,previousActive:false}),
    [['disable','--now',GATEWAY_SERVICE],['daemon-reload']]);
  assert.deepEqual(gatewayRollbackActions({previousUnitSha256:digest,previousEnabled:true,previousActive:false}),
    [['disable','--now',GATEWAY_SERVICE],['daemon-reload'],['enable',GATEWAY_SERVICE]]);
  assert.deepEqual(gatewayRollbackActions({previousUnitSha256:digest,previousEnabled:false,previousActive:true}),
    [['disable','--now',GATEWAY_SERVICE],['daemon-reload'],['start',GATEWAY_SERVICE]]);
  assert.deepEqual(gatewayRollbackActions({previousUnitSha256:digest,previousEnabled:true,previousActive:true}),
    [['disable','--now',GATEWAY_SERVICE],['daemon-reload'],['enable',GATEWAY_SERVICE],['start',GATEWAY_SERVICE]]);
  assert.equal(validateGatewayRestoredServiceState({unitExists:false,enabled:false,active:false},
    {previousUnitSha256:null,previousEnabled:false,previousActive:false}),true);
  assert.equal(validateGatewayRestoredServiceState({unitExists:true,enabled:false,active:true},
    {previousUnitSha256:digest,previousEnabled:false,previousActive:true}),true);
  assert.throws(()=>validateGatewayRestoredServiceState({unitExists:false,enabled:false,active:true},
    {previousUnitSha256:null,previousEnabled:false,previousActive:false}),/restoration rejected/);
});

test('installer runtime proof binds the active MainPID to exact node, artifact, entrypoint and configuration',()=>{
  const artifact=`/opt/blackspire-command/releases/${sha}`,entry=`${artifact}/packages/buyer-writer/gateway-entry.js`;
  const observation={state:{ActiveState:'active',SubState:'running',MainPID:'42',User:'blackspire-writer',Group:'blackspire-api'},
    exe:GATEWAY_NODE,cwd:artifact,cmdline:[GATEWAY_NODE,entry,'--configuration',GATEWAY_CONFIG_PATH]};
  assert.equal(validateGatewayRuntimeObservation(observation,{sha}),true);
  for(const mutate of [v=>{v.state.MainPID='0';},v=>{v.cwd='/opt/blackspire-command/current';},v=>{v.cmdline[1]=entry.replace(sha,'c'.repeat(40));},
    v=>{v.cmdline.push('--extra');},v=>{v.exe='/usr/bin/node';}]){const changed=structuredClone(observation);mutate(changed);
    assert.throws(()=>validateGatewayRuntimeObservation(changed,{sha}),/runtime exact authority rejected/);}
});

test('gateway installer CLI is explicit, gateway-only, and never switches the mutable release',()=>{
  const source=fs.readFileSync('scripts/buyer-writer-gateway-install.js','utf8');
  assert.match(source,/--inspect','--install','--rollback/);
  assert.match(source,/const mode=explicitMode\?args\[0\]:'--inspect'/);
  assert.match(source,/inspectSealedBuyerWriterArtifact/);
  assert.match(source,/timeout,maxBuffer,killSignal:'SIGKILL'/);
  assert.match(source,/blackspire-buyer-writer-gateway-install\.lock/);
  assert.match(source,/\/usr\/bin\/flock/);
  assert.match(source,/parent\.uid!==0\|\|\(parent\.mode&0o022\)!==0/);
  assert.doesNotMatch(source,/parentMode!==0o1777/);
  assert.match(source,/fs\.fsyncSync\(fd\)/);
  assert.match(source,/syncDirectory\(path\.dirname\(filename\)\)/);
  assert.match(source,/safeDirectory\(directory,\{uid:0,gid:0,mode:0o700\}\);syncDirectory\(directory\);syncDirectory\(parent\)/);
  assert.match(source,/atomicRootFile\(backup,previous,0o600\)/);
  assert.ok(source.indexOf('atomicRootFile(stateFile')<source.indexOf('atomicRootFile(unitDestination'),'rollback intent must precede unit replacement');
  assert.match(source,/authority\.releaseSha!==sha/);
  assert.match(source,/gatewayActivationActions/);
  assert.match(source,/gatewayRollbackActions/);
  assert.match(source,/validateGatewayRuntimeObservation/);
  assert.doesNotMatch(source,/enable','--now',GATEWAY_SERVICE/);
  assert.doesNotMatch(source,/release-switch\.sh|systemctl',\['(?:stop|restart)',(?:'blackspire-command\.service'|'blackspire-command-worker\.service')/);
  assert.doesNotMatch(source,/n8n|BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG=.*(?:password|capability)/i);
});
