import fs from 'node:fs';
import path from 'node:path';
import { verifyReleaseEvidence, serializeReleaseEvidence } from './release-evidence.js';

export const DEPLOYMENT_IDENTITY_STATES = Object.freeze(['VERIFIED', 'UNVERIFIED', 'MISMATCH', 'UNKNOWN']);
const SHA = /^[0-9a-f]{40}$/;
const VERSION = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/;
const OWNER_ENVIRONMENTS = Object.freeze({
  'vps-production': 'production',
  'vps-staging': 'staging',
  // The disposable rehearsal environment is first-class in packages/recovery/disposable-rehearsal.js
  // and in ALLOWED_ENVIRONMENTS, but no owner mapped to it -- so a disposable-staging deployment
  // could never produce an identity matching its own expected environment and post-deploy
  // verification was pinned to 'operator intervention required' forever.
  'vps-disposable-staging': 'disposable-staging',
  'codespace-disposable': 'development',
  'iphone-test-disposable': 'test',
});
const REASON_PRIORITY = Object.freeze({ MISMATCH: 3, UNVERIFIED: 2, UNKNOWN: 1, VERIFIED: 0 });
const REASON_CODES = new Set(['state_owner_missing','state_owner_unrecognized','expected_environment_mismatch','commit_manifest_missing','commit_manifest_malformed','release_directory_mismatch','expected_build_mismatch','image_build_mismatch','deployment_identity_unverified']);
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const nested of Object.values(value)) deepFreeze(nested); } return value; }

function safeRead(file, readFile = fs.readFileSync) {
  try { return readFile(file, 'utf8').trim(); } catch { return null; }
}
function safeDeploymentRecord(file, readFile = fs.readFileSync) {
  if (!file) return null;
  try {
    const stat = fs.lstatSync(file); if (!stat.isFile() || stat.isSymbolicLink()) return null;
    const value = JSON.parse(readFile(file, 'utf8'));
    return typeof value === 'object' && value ? value : null;
  } catch { return null; }
}

function component(state, value, source, reasonCode = null) {
  return Object.freeze({ state, value, source, reasonCode });
}

function environmentIdentity(stateOwner, expectedEnvironment) {
  if (!stateOwner) return component('UNKNOWN', null, null, 'state_owner_missing');
  const environment = OWNER_ENVIRONMENTS[stateOwner];
  if (!environment) return component('UNVERIFIED', null, 'state_owner', 'state_owner_unrecognized');
  if (expectedEnvironment && expectedEnvironment !== environment) return component('MISMATCH', environment, 'state_owner', 'expected_environment_mismatch');
  return component('VERIFIED', environment, 'state_owner');
}

function buildIdentity({ artifactRoot, expectedBuildSha, imageBuildSha, readFile }) {
  let canonicalRoot = artifactRoot;
  try { canonicalRoot = fs.realpathSync.native(artifactRoot); } catch { /* missing artifact is reported as UNKNOWN below */ }
  const manifestSha = safeRead(path.join(canonicalRoot, 'COMMIT_SHA'), readFile);
  if (manifestSha === null) return component('UNKNOWN', null, null, 'commit_manifest_missing');
  if (!SHA.test(manifestSha)) return component('UNVERIFIED', null, 'commit_manifest', 'commit_manifest_malformed');
  const releaseParent = path.basename(path.dirname(canonicalRoot)) === 'releases';
  const directorySha = releaseParent ? path.basename(canonicalRoot) : null;
  if (directorySha && SHA.test(directorySha) && directorySha !== manifestSha) return component('MISMATCH', manifestSha, 'commit_manifest', 'release_directory_mismatch');
  if (expectedBuildSha && expectedBuildSha !== manifestSha) return component('MISMATCH', manifestSha, 'commit_manifest', 'expected_build_mismatch');
  if (imageBuildSha && imageBuildSha !== manifestSha) return component('MISMATCH', manifestSha, 'commit_manifest', 'image_build_mismatch');
  return component('VERIFIED', manifestSha, 'commit_manifest');
}

function overallState(...states) {
  return states.sort((a, b) => REASON_PRIORITY[b] - REASON_PRIORITY[a])[0];
}

// Release evidence contributes to the identity state, but only ever by making it WORSE.
// An earlier form of this returned the evidence-derived state directly, which discarded
// environment.state: a server deployed into the wrong environment with no packaged
// evidence reported UNKNOWN instead of MISMATCH, and health-transition sources map
// anything other than MISMATCH to a mere "unknown" observation rather than a failure.
function releaseEvidenceState(releaseEvidence) {
  switch (releaseEvidence.state) {
    case 'MISMATCH': case 'INVALID': return 'MISMATCH';
    case 'UNVERIFIED': return 'UNVERIFIED';
    case 'MISSING': return 'UNKNOWN';
    default: return 'VERIFIED';
  }
}

export function createDeploymentIdentityProvider({
  stateOwner = process.env.BLACKSPIRE_STATE_OWNER || '',
  artifactRoot = process.cwd(),
  expectedEnvironment = null,
  expectedBuildSha = null,
  imageBuildSha = null,
  readFile = fs.readFileSync,
  allowTestOverride = false,
  testIdentity = null,
  deploymentRecord = null,
  deploymentRecordPath = process.env.BLACKSPIRE_DEPLOYMENT_RECORD_PATH || null,
  runtimeOverrideSha = null,
} = {}) {
  if (testIdentity) {
    if (!allowTestOverride || process.env.NODE_ENV !== 'test' || stateOwner === 'vps-production') throw new Error('deployment identity test override unavailable');
    const snapshot = deepFreeze(structuredClone(testIdentity));
    return Object.freeze({ get: () => snapshot });
  }
  let cached = null;
  return Object.freeze({
    get() {
      if (cached) return cached;
      const environment = environmentIdentity(stateOwner, expectedEnvironment);
      const build = buildIdentity({ artifactRoot: path.resolve(artifactRoot), expectedBuildSha, imageBuildSha, readFile });
      const trustedDeploymentRecord = deploymentRecord || safeDeploymentRecord(deploymentRecordPath, readFile);
      const releaseEvidence = verifyReleaseEvidence({ artifactRoot: path.resolve(artifactRoot), packagedCommitSha: build.value,
        expectedCommitSha: expectedBuildSha, expectedEnvironment: environment.value, deploymentRecord: trustedDeploymentRecord, runtimeOverrideSha });
      const packageVersion = safeRead(path.join(path.resolve(artifactRoot), 'package.json'), readFile);
      let version = null;
      try { const parsed = JSON.parse(packageVersion || '{}'); if (VERSION.test(parsed.version || '')) version = parsed.version; } catch { /* untrusted artifact metadata remains absent */ }
      cached = deepFreeze({
        schemaVersion: 1,
        state: overallState(environment.state, build.state, releaseEvidenceState(releaseEvidence)),
        environment,
        build,
        releaseEvidence,
        version,
        buildTimestamp: null,
        verificationSource: Object.freeze(['state_owner', 'commit_manifest']),
      });
      return cached;
    },
  });
}

export function serializeDeploymentIdentity(identity) {
  const safeComponent = (item, kind) => ({ state: DEPLOYMENT_IDENTITY_STATES.includes(item?.state) ? item.state : 'UNKNOWN', value: kind === 'build' ? SHA.test(item?.value || '') ? item.value : null : Object.values(OWNER_ENVIRONMENTS).includes(item?.value) ? item.value : null, source: ['state_owner', 'commit_manifest'].includes(item?.source) ? item.source : null, reasonCode: REASON_CODES.has(item?.reasonCode) ? item.reasonCode : null });
  const environment = safeComponent(identity?.environment, 'environment'); const build = safeComponent(identity?.build, 'build');
  const state = DEPLOYMENT_IDENTITY_STATES.includes(identity?.state) ? identity.state : 'UNKNOWN';
  return Object.freeze({ schemaVersion: 1, state, environment, build, releaseEvidence: serializeReleaseEvidence(identity?.releaseEvidence), version: VERSION.test(identity?.version || '') ? identity.version : null, buildTimestamp: null, verificationSource: ['state_owner', 'commit_manifest'].filter((source) => identity?.verificationSource?.includes(source)) });
}

export function validateDeploymentIdentityForStartup(identity, stateOwner = process.env.BLACKSPIRE_STATE_OWNER || '') {
  const required = stateOwner === 'vps-production' || stateOwner === 'vps-staging';
  const ok = !required || identity?.state === 'VERIFIED';
  return Object.freeze({ ok, required, state: DEPLOYMENT_IDENTITY_STATES.includes(identity?.state) ? identity.state : 'UNKNOWN', reasonCode: ok ? null : identity?.environment?.reasonCode || identity?.build?.reasonCode || 'deployment_identity_unverified' });
}
