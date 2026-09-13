import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  GATEWAY_CONFIG_PATH,GATEWAY_SERVICE,assertGatewayOnlyEffects,decodeGatewayInstallState,encodeGatewayInstallState,
  gatewayArtifactPath,gatewayInstallEffects,inspectGatewayArtifact,renderGatewayUnit,
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
  assert.equal(state.sha,sha);assert.equal(state.unitBackup,null);assert.equal(state.previousUnitSha256,null);assert.match(state.installedUnitSha256,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(encoded,/gatewayCapability|password|DATABASE_URL/);
  assert.throws(()=>decodeGatewayInstallState(JSON.stringify({...state,extra:true})),/state rejected/);
  assert.throws(()=>decodeGatewayInstallState(JSON.stringify({...state,unitBackup:'/tmp/old'})),/state rejected/);
  assert.equal(GATEWAY_CONFIG_PATH,'/etc/blackspire-buyer-writer-gateway/gateway.json');
});

test('gateway installer CLI is explicit, gateway-only, and never switches the mutable release',()=>{
  const source=fs.readFileSync('scripts/buyer-writer-gateway-install.js','utf8');
  assert.match(source,/--inspect','--install','--rollback/);
  assert.match(source,/const mode=explicitMode\?args\[0\]:'--inspect'/);
  assert.match(source,/inspectSealedBuyerWriterArtifact/);
  assert.match(source,/timeout,maxBuffer,killSignal:'SIGKILL'/);
  assert.ok(source.indexOf('atomicRootFile(stateFile')<source.indexOf('atomicRootFile(unitDestination'),'rollback intent must precede unit replacement');
  assert.match(source,/authority\.releaseSha!==sha/);
  assert.match(source,/enable','--now',GATEWAY_SERVICE/);
  assert.match(source,/disable','--now',GATEWAY_SERVICE/);
  assert.doesNotMatch(source,/release-switch\.sh|systemctl',\['(?:stop|restart)',(?:'blackspire-command\.service'|'blackspire-command-worker\.service')/);
  assert.doesNotMatch(source,/n8n|BLACKSPIRE_BUYER_WRITER_GATEWAY_CONFIG=.*(?:password|capability)/i);
});
