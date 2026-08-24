import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDeploymentIdentityProvider, serializeDeploymentIdentity, validateDeploymentIdentityForStartup } from '../packages/shared/deployment-identity.js';
import { writeReleaseEvidence } from '../packages/shared/release-evidence.js';

const sha = 'a'.repeat(40);
function fixture({ owner = 'vps-staging', manifest = sha, directory = sha, expectedEnvironment = 'staging', expectedBuildSha = sha, imageBuildSha = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-deployment-identity-'));
  const artifact = path.join(root, 'releases', directory); fs.mkdirSync(artifact, { recursive: true });
  if (manifest !== null) fs.writeFileSync(path.join(artifact, 'COMMIT_SHA'), `${manifest}\n`);
  fs.writeFileSync(path.join(artifact, 'package.json'), JSON.stringify({ version: '0.1.0', secret: 'must-not-serialize' }));
  let deploymentRecord = null;
  if (manifest === sha) { const evidence=writeReleaseEvidence(artifact,{commitSha:sha,expectedEnvironment,buildTimestamp:'2026-08-10T00:00:00.000Z',buildId:'fixture-1',ciProvider:'local-disposable',artifactName:'fixture',packageVersion:'0.1.0',nodeVersion:'v22.23.1',repository:'houseomegakennels-bit/blackspire-helix-group'}); deploymentRecord={commitSha:sha,artifactDigest:evidence.artifact.digest,environment:expectedEnvironment}; }
  return { root, provider: createDeploymentIdentityProvider({ stateOwner: owner, artifactRoot: artifact, expectedEnvironment, expectedBuildSha, imageBuildSha, deploymentRecord }) };
}

test('immutable manifest and exact state owner produce a verified safe identity', () => { const { root, provider } = fixture(); const first = provider.get(); const second = provider.get(); assert.strictEqual(first, second); assert.equal(first.state, 'VERIFIED'); assert.equal(first.environment.value, 'staging'); assert.equal(first.build.value, sha); const safe=serializeDeploymentIdentity(first); assert.equal(safe.releaseEvidence.state,'VERIFIED'); assert.match(safe.releaseEvidence.artifactDigest,/^[a-f0-9]{64}$/); assert.equal(JSON.stringify(safe).includes('secret'),false); fs.rmSync(root,{recursive:true}); });
test('missing metadata is UNKNOWN and malformed metadata is UNVERIFIED', () => { const missing=fixture({manifest:null}); assert.equal(missing.provider.get().state,'UNKNOWN'); const malformed=fixture({manifest:'not-a-sha'}); assert.equal(malformed.provider.get().state,'UNVERIFIED'); fs.rmSync(missing.root,{recursive:true});fs.rmSync(malformed.root,{recursive:true}); });
test('wrong expected SHA, environment, release directory, and image label are mismatches', () => { for(const options of [{expectedBuildSha:'b'.repeat(40)},{expectedEnvironment:'production'},{directory:'b'.repeat(40)},{imageBuildSha:'b'.repeat(40)}]){const item=fixture(options);assert.equal(item.provider.get().state,'MISMATCH');fs.rmSync(item.root,{recursive:true});} });
test('NODE_ENV alone cannot claim production', () => { const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';const provider=createDeploymentIdentityProvider({stateOwner:'',artifactRoot:'/missing'});assert.equal(provider.get().environment.state,'UNKNOWN');process.env.NODE_ENV=previous; });
test('client-shaped inputs cannot override identity', () => { const item=fixture(); const identity=item.provider.get({environment:'production',buildSha:'b'.repeat(40)}); assert.equal(identity.environment.value,'staging');assert.equal(identity.build.value,sha);fs.rmSync(item.root,{recursive:true}); });
test('concurrent consumers receive one immutable identity snapshot', async () => { const item=fixture();const identities=await Promise.all(Array.from({length:32},()=>Promise.resolve().then(()=>item.provider.get())));assert.ok(identities.every((identity)=>identity===identities[0]));assert.equal(Object.isFrozen(identities[0].environment),true);fs.rmSync(item.root,{recursive:true}); });
test('production rejects test override and verified identity is required for trusted startup', () => { const previous=process.env.NODE_ENV;process.env.NODE_ENV='test';assert.throws(()=>createDeploymentIdentityProvider({stateOwner:'vps-production',allowTestOverride:true,testIdentity:{state:'VERIFIED'}}),/override unavailable/);assert.equal(validateDeploymentIdentityForStartup({state:'UNKNOWN'},'vps-production').ok,false);assert.equal(validateDeploymentIdentityForStartup({state:'UNKNOWN'},'').ok,true);process.env.NODE_ENV=previous; });
test('serialization drops secrets, paths, timestamps, and unknown sources', () => { const result=serializeDeploymentIdentity({state:'VERIFIED',environment:{state:'VERIFIED',value:'staging',source:'raw_environment',reasonCode:'token_value'},build:{state:'VERIFIED',value:'/internal/secret/path',source:'filesystem_path'},version:'bad value',verificationSource:['raw_environment']});assert.equal(JSON.stringify(result).includes('secret'),false);assert.equal(JSON.stringify(result).includes('token'),false);assert.equal(result.environment.source,null);assert.equal(result.environment.reasonCode,null);assert.equal(result.build.value,null);assert.equal(result.build.source,null);assert.equal(result.version,null); });

test('every recognised state owner maps to its own environment, including the disposable rehearsal owner', () => {
  // OWNER_ENVIRONMENTS is a trust-boundary constant on the deployment-verification path and was
  // asserted by nothing: deleting the disposable entry survived the entire suite, silently
  // restoring the defect where no owner could produce 'disposable-staging' and every disposable
  // rehearsal was pinned to 'operator intervention required'. Every existing test that uses
  // disposable-staging hand-writes the value into a fixture instead of obtaining it from an
  // owner, which is exactly why that defect shipped green. Derive it from the owner here.
  const expected = {
    'vps-production': 'production',
    'vps-staging': 'staging',
    'vps-disposable-staging': 'disposable-staging',
    'codespace-disposable': 'development',
    'iphone-test-disposable': 'test',
  };
  for (const [owner, environment] of Object.entries(expected)) {
    const item = fixture({ owner, expectedEnvironment: environment });
    const identity = item.provider.get();
    assert.equal(identity.environment.value, environment, `${owner} must map to ${environment}`);
    assert.equal(identity.environment.state, 'VERIFIED', `${owner} must verify its environment`);
    assert.equal(identity.state, 'VERIFIED', `${owner} must produce a verified identity`);
    // The serialized allowlist must carry the value too, not strip it to null.
    assert.equal(serializeDeploymentIdentity(identity).environment.value, environment);
    fs.rmSync(item.root, { recursive: true });
  }

  // An unrecognised owner must NOT silently acquire an environment.
  const unknown = fixture({ owner: 'vps-not-a-real-owner', expectedEnvironment: 'staging' });
  assert.equal(unknown.provider.get().environment.state, 'UNVERIFIED');
  assert.equal(unknown.provider.get().environment.reasonCode, 'state_owner_unrecognized');
  fs.rmSync(unknown.root, { recursive: true });
});

// Builds an artifact whose commit manifest is valid (build VERIFIED) but which carries NO
// packaged release evidence, so releaseEvidence.state is MISSING. The environment is chosen
// by the caller so an environment MISMATCH can be combined with missing evidence.
function evidencelessFixture({ owner = 'vps-staging', expectedEnvironment = 'staging' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-identity-severity-'));
  const artifact = path.join(root, 'releases', sha);
  fs.mkdirSync(artifact, { recursive: true });
  fs.writeFileSync(path.join(artifact, 'COMMIT_SHA'), `${sha}\n`);
  fs.writeFileSync(path.join(artifact, 'package.json'), JSON.stringify({ version: '0.1.0' }));
  return { root, provider: createDeploymentIdentityProvider({ stateOwner: owner, artifactRoot: artifact, expectedEnvironment, expectedBuildSha: sha }) };
}

test('release evidence can only make the identity state worse, never mask a component mismatch', () => {
  // Regression: the evidence-derived state was returned directly, which discarded
  // environment.state. A server deployed into the WRONG environment with no packaged
  // evidence reported UNKNOWN, and packages/health-transitions/sources.js maps anything
  // other than MISMATCH to a mere "unknown" observation instead of a failure -- so the
  // single most important thing this contract exists to detect became invisible.
  const wrongEnvironment = evidencelessFixture({ owner: 'vps-staging', expectedEnvironment: 'production' });
  const identity = wrongEnvironment.provider.get();
  assert.equal(identity.environment.state, 'MISMATCH');
  assert.equal(identity.environment.reasonCode, 'expected_environment_mismatch');
  assert.equal(identity.releaseEvidence.state, 'MISSING');
  assert.equal(identity.build.state, 'VERIFIED');
  assert.equal(identity.state, 'MISMATCH', 'missing evidence must not downgrade an environment mismatch');
  fs.rmSync(wrongEnvironment.root, { recursive: true });

  // With every component agreeing, missing evidence still degrades the identity to UNKNOWN.
  const agreeing = evidencelessFixture({ owner: 'vps-staging', expectedEnvironment: 'staging' });
  const degraded = agreeing.provider.get();
  assert.equal(degraded.environment.state, 'VERIFIED');
  assert.equal(degraded.build.state, 'VERIFIED');
  assert.equal(degraded.state, 'UNKNOWN', 'missing evidence must still degrade a fully agreeing identity');
  fs.rmSync(agreeing.root, { recursive: true });

  // An unrecognised owner (environment UNVERIFIED) must not be flattened to UNKNOWN either.
  const unrecognised = evidencelessFixture({ owner: 'vps-not-a-real-owner', expectedEnvironment: 'staging' });
  const partial = unrecognised.provider.get();
  assert.equal(partial.environment.state, 'UNVERIFIED');
  assert.equal(partial.state, 'UNVERIFIED');
  fs.rmSync(unrecognised.root, { recursive: true });
});

test('the serialized identity carries exactly its allowlisted fields and nothing else', () => {
  // Exact-shape pin: a targeted assert cannot catch a NEW field appearing in the safe
  // projection, which is how an internal path, timestamp, or secret would leak.
  const item = fixture();
  const identity = item.provider.get();
  const safe = serializeDeploymentIdentity(identity);
  assert.deepEqual(Object.keys(safe).sort(), ['build', 'buildTimestamp', 'environment', 'releaseEvidence', 'schemaVersion', 'state', 'verificationSource', 'version'].sort());
  assert.deepEqual(Object.keys(safe.environment).sort(), ['reasonCode', 'source', 'state', 'value']);
  assert.deepEqual(Object.keys(safe.build).sort(), ['reasonCode', 'source', 'state', 'value']);
  assert.equal(JSON.stringify(safe).includes('secret'), false);
  assert.equal(JSON.stringify(safe).includes('must-not-serialize'), false);
  fs.rmSync(item.root, { recursive: true });
});
