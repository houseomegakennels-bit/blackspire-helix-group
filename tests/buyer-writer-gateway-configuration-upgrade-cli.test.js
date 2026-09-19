import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/upgrade-buyer-writer-gateway-configuration.js',import.meta.url));
const source=fs.readFileSync(script,'utf8');

test('upgrade CLI pins exact authority, protected paths, and all quiesced services',()=>{
  assert.match(source,/process\.versions\.node!=='22\.23\.1'/);
  assert.match(source,/process\.getuid\?\.\(\)!==0/);
  assert.match(source,/\/opt\/blackspire-command\/releases/);
  assert.match(source,/inspectSealedBuyerWriterArtifact/);
  assert.match(source,/artifact\.status!=='SEALED_ARTIFACT_VERIFIED'/);
  for(const service of ['blackspire-command.service','blackspire-command-worker.service',
    'blackspire-buyer-writer-gateway.service'])assert.ok(source.includes(`'${service}'`));
  assert.match(source,/ActiveState!=='inactive'/);
  assert.match(source,/SubState!=='dead'/);
  assert.match(source,/MainPID!=='0'/);
  assert.match(source,/BUYER_WRITER_GATEWAY_CONFIG_FILE/);
  assert.match(source,/BUYER_WRITER_GATEWAY_UPGRADE_STATE/);
  assert.match(source,/blackspire-buyer-writer-gateway-configuration-upgrade\.lock/);
  assert.match(source,/\['--exclusive','--nonblock','3'\]/);
  assert.doesNotMatch(source,/process\.env\[/);
  assert.doesNotMatch(source,/process\.env\./);
});

test('upgrade CLI rejects bad invocation without disclosing protected state',()=>{
  const result=spawnSync(process.execPath,[script,'--bad'],{
    encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'},timeout:20_000,
  });
  assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,
    'Buyer writer gateway configuration upgrade stopped; protected inputs and state were not disclosed\n');
});

test('upgrade CLI exposes only the four exact modes and strict bound argument shape',()=>{
  assert.match(source,/\['--inspect','--upgrade','--reconcile','--rollback'\]\.includes\(mode\)/);
  assert.match(source,/mode==='--rollback'/);
  assert.match(source,/mode==='--reconcile'/);
  assert.match(source,/args\.length!==7/);
  assert.match(source,/\^\[a-f0-9\]\{40\}\$/);
  assert.match(source,/path\.isAbsolute\(candidateFile\)/);
  assert.match(source,/config\.authority\.releaseSha!==releaseSha/);
  assert.match(source,/artifact\.artifactDigest!==artifactDigest/);
  assert.match(source,/observedCandidateDigest!==candidateDigest/);
  assert.match(source,/journal\(operationId,\{resume:true\}\)/);
  assert.match(source,/state\?\.phase!=='INTENT'/);
  assert.match(source,/operationId\+'\.backup\.json'/);
});
