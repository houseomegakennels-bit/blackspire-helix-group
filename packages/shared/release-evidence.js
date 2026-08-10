import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const RELEASE_EVIDENCE_FILE = 'RELEASE_EVIDENCE.json';
export const RELEASE_EVIDENCE_STATES = Object.freeze(['VERIFIED', 'UNVERIFIED', 'MISMATCH', 'MISSING', 'INVALID']);
export const RELEASE_CLASSIFICATIONS = Object.freeze(['VERIFIED_RELEASE', 'DEGRADED_RELEASE', 'RELEASE_MISMATCH', 'INSUFFICIENT_EVIDENCE', 'OPERATOR_INTERVENTION_REQUIRED']);
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const SAFE_ID = /^[A-Za-z0-9._:/@+-]{1,160}$/;
const ENVIRONMENTS = new Set(['unassigned', 'development', 'test', 'staging', 'disposable-staging', 'production']);
const EXCLUDED = new Set([RELEASE_EVIDENCE_FILE, '.release-complete']);
const REASONS = new Set(['COMMIT_MISMATCH', 'ARTIFACT_DIGEST_MISMATCH', 'ENVIRONMENT_MISMATCH', 'BUILD_METADATA_MISSING', 'DEPLOYMENT_RECORD_MISSING', 'UNTRUSTED_RUNTIME_OVERRIDE', 'UNKNOWN_BUILD', 'MANIFEST_INVALID', 'ROLLBACK_ARTIFACT_MISSING', 'ROLLBACK_SCHEMA_INCOMPATIBLE', 'ROLLBACK_ENVIRONMENT_MISMATCH', 'ROLLBACK_MANIFEST_MISSING']);

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
function bounded(value, fallback = null) { return typeof value === 'string' && SAFE_ID.test(value) ? value : fallback; }
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function walk(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    const absolute = path.join(current, entry.name); const relative = path.relative(root, absolute).split(path.sep).join('/');
    if (!relative || EXCLUDED.has(relative) || relative === '.git' || relative.startsWith('.git/')) continue;
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) throw new Error('artifact contains unsupported file type');
    if (stat.isDirectory()) walk(root, absolute, files); else files.push(relative);
  }
  return files;
}

export function computeArtifactDigest(artifactRoot) {
  const root = fs.realpathSync(artifactRoot); const digest = crypto.createHash('sha256');
  for (const relative of walk(root)) {
    const bytes = fs.readFileSync(path.join(root, relative));
    digest.update(relative); digest.update('\0'); digest.update(hash(bytes)); digest.update('\0');
  }
  return digest.digest('hex');
}

export function createReleaseEvidence(input) {
  const commitSha = String(input.commitSha || '').toLowerCase();
  if (!SHA.test(commitSha)) throw new Error('commitSha must be a full commit SHA');
  if (!ENVIRONMENTS.has(input.expectedEnvironment)) throw new Error('expectedEnvironment is invalid');
  const timestamp = new Date(input.buildTimestamp || '');
  if (!Number.isFinite(timestamp.getTime())) throw new Error('buildTimestamp must be an ISO timestamp');
  const artifactDigest = computeArtifactDigest(input.artifactRoot);
  const evidence = {
    schema: 'blackspire-release-evidence', evidenceVersion: 1, commitSha,
    sourceRef: bounded(input.sourceRef), buildId: bounded(input.buildId), buildTimestamp: timestamp.toISOString(),
    ci: { provider: bounded(input.ciProvider), runId: bounded(input.ciRunId) },
    artifact: { name: bounded(input.artifactName), digestAlgorithm: 'sha256-tree-v1', digest: artifactDigest },
    runtime: { packageVersion: bounded(input.packageVersion), nodeVersion: bounded(input.nodeVersion) },
    expectedEnvironment: input.expectedEnvironment, repository: bounded(input.repository),
  };
  return Object.freeze({ ...evidence, evidenceDigest: hash(canonicalJson(evidence)) });
}

export function writeReleaseEvidence(artifactRoot, input) {
  const target = path.join(artifactRoot, RELEASE_EVIDENCE_FILE);
  if (fs.existsSync(target)) throw new Error('release evidence already exists');
  const evidence = createReleaseEvidence({ ...input, artifactRoot });
  fs.writeFileSync(target, `${canonicalJson(evidence)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o644 });
  return evidence;
}

export function loadReleaseEvidence(artifactRoot) {
  const file = path.join(artifactRoot, RELEASE_EVIDENCE_FILE);
  if (!fs.existsSync(file)) return { state: 'MISSING', reasonCode: 'BUILD_METADATA_MISSING', manifest: null };
  let manifest; try { manifest = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { state: 'INVALID', reasonCode: 'MANIFEST_INVALID', manifest: null }; }
  const base = { ...manifest }; delete base.evidenceDigest;
  const valid = manifest.schema === 'blackspire-release-evidence' && manifest.evidenceVersion === 1 && SHA.test(manifest.commitSha || '')
    && ENVIRONMENTS.has(manifest.expectedEnvironment) && DIGEST.test(manifest.artifact?.digest || '')
    && manifest.artifact?.digestAlgorithm === 'sha256-tree-v1' && DIGEST.test(manifest.evidenceDigest || '')
    && hash(canonicalJson(base)) === manifest.evidenceDigest;
  return valid ? { state: 'UNVERIFIED', reasonCode: null, manifest } : { state: 'INVALID', reasonCode: 'MANIFEST_INVALID', manifest: null };
}

export function verifyReleaseEvidence({ artifactRoot, packagedCommitSha, expectedCommitSha = null, expectedEnvironment = null, deploymentRecord = null, runtimeOverrideSha = null }) {
  const loaded = loadReleaseEvidence(artifactRoot);
  if (!loaded.manifest) return loaded;
  const manifest = loaded.manifest; const reasons = [];
  if (!SHA.test(packagedCommitSha || '')) reasons.push('UNKNOWN_BUILD');
  else if (manifest.commitSha !== packagedCommitSha) reasons.push('COMMIT_MISMATCH');
  if (expectedCommitSha && manifest.commitSha !== expectedCommitSha) reasons.push('COMMIT_MISMATCH');
  if (runtimeOverrideSha && runtimeOverrideSha !== manifest.commitSha) reasons.push('UNTRUSTED_RUNTIME_OVERRIDE');
  if (expectedEnvironment && manifest.expectedEnvironment !== expectedEnvironment) reasons.push('ENVIRONMENT_MISMATCH');
  let actualDigest = null; try { actualDigest = computeArtifactDigest(artifactRoot); } catch { reasons.push('ARTIFACT_DIGEST_MISMATCH'); }
  if (actualDigest !== manifest.artifact.digest) reasons.push('ARTIFACT_DIGEST_MISMATCH');
  if (deploymentRecord === null) reasons.push('DEPLOYMENT_RECORD_MISSING');
  else {
    if (deploymentRecord.commitSha !== manifest.commitSha) reasons.push('COMMIT_MISMATCH');
    if (deploymentRecord.artifactDigest !== manifest.artifact.digest) reasons.push('ARTIFACT_DIGEST_MISMATCH');
    if (deploymentRecord.environment !== manifest.expectedEnvironment) reasons.push('ENVIRONMENT_MISMATCH');
  }
  const unique = [...new Set(reasons)].filter((item) => REASONS.has(item));
  const mismatch = unique.some((item) => !['DEPLOYMENT_RECORD_MISSING', 'UNKNOWN_BUILD'].includes(item));
  return { state: mismatch ? 'MISMATCH' : unique.length ? 'UNVERIFIED' : 'VERIFIED', reasonCode: unique[0] || null, reasons: unique, manifest, actualDigest };
}

export function serializeReleaseEvidence(result) {
  const manifest = result?.manifest; const state = RELEASE_EVIDENCE_STATES.includes(result?.state) ? result.state : 'INVALID';
  return Object.freeze({ state, reasonCode: REASONS.has(result?.reasonCode) ? result.reasonCode : null,
    evidenceVersion: manifest?.evidenceVersion === 1 ? 1 : null, commitSha: SHA.test(manifest?.commitSha || '') ? manifest.commitSha : null,
    artifactDigest: DIGEST.test(manifest?.artifact?.digest || '') ? manifest.artifact.digest : null,
    artifactName: bounded(manifest?.artifact?.name), expectedEnvironment: ENVIRONMENTS.has(manifest?.expectedEnvironment) ? manifest.expectedEnvironment : null,
    buildId: bounded(manifest?.buildId), buildTimestamp: Number.isFinite(Date.parse(manifest?.buildTimestamp || '')) ? manifest.buildTimestamp : null,
    ciProvider: bounded(manifest?.ci?.provider), ciRunId: bounded(manifest?.ci?.runId), packageVersion: bounded(manifest?.runtime?.packageVersion),
    nodeVersion: bounded(manifest?.runtime?.nodeVersion), repository: bounded(manifest?.repository), sourceRef: bounded(manifest?.sourceRef) });
}

export function verifyRollbackReleaseEvidence({ candidate, current, schemaCompatible, artifactAvailable }) {
  const reasons = [];
  if (!candidate?.manifest) reasons.push('ROLLBACK_MANIFEST_MISSING');
  if (candidate?.state !== 'VERIFIED') reasons.push('ROLLBACK_ARTIFACT_MISSING');
  if (artifactAvailable !== true) reasons.push('ROLLBACK_ARTIFACT_MISSING');
  if (schemaCompatible !== true) reasons.push('ROLLBACK_SCHEMA_INCOMPATIBLE');
  if (candidate?.manifest?.expectedEnvironment !== current?.manifest?.expectedEnvironment) reasons.push('ROLLBACK_ENVIRONMENT_MISMATCH');
  if (!SHA.test(candidate?.manifest?.commitSha || '') || candidate?.manifest?.commitSha === current?.manifest?.commitSha) reasons.push('COMMIT_MISMATCH');
  return Object.freeze({ state: reasons.length ? 'INVALID' : 'VERIFIED', reasons: [...new Set(reasons)], operatorAuthorizationRequired: true, automaticActionTaken: false,
    target: serializeReleaseEvidence(candidate) });
}

export function createOperatorReleaseReport({ expected, actual, postDeploy, rollback, health }) {
  const actualSafe = serializeReleaseEvidence(actual); const expectedSafe = serializeReleaseEvidence(expected);
  const classification = actualSafe.state === 'MISMATCH' ? 'RELEASE_MISMATCH'
    : !actualSafe.commitSha || actualSafe.state === 'MISSING' || actualSafe.state === 'INVALID' ? 'INSUFFICIENT_EVIDENCE'
      : postDeploy?.classification === 'operator intervention required' ? 'OPERATOR_INTERVENTION_REQUIRED'
        : postDeploy?.classification === 'proceed' && actualSafe.state === 'VERIFIED' ? 'VERIFIED_RELEASE' : 'DEGRADED_RELEASE';
  return Object.freeze({ version: 1, kind: 'blackspire-operator-release-report', readOnly: true, automaticActionTaken: false,
    classification, expected: expectedSafe, actual: actualSafe, postDeploy: postDeploy ? { classification: postDeploy.classification, releaseClassification: postDeploy.releaseClassification || null } : null,
    rollback: rollback ? { state: rollback.state, operatorAuthorizationRequired: rollback.operatorAuthorizationRequired === true, reasons: rollback.reasons || [] } : null,
    health: bounded(health), unresolvedMismatches: actual?.reasons?.filter((item) => REASONS.has(item)) || [], operatorActionRequired: classification !== 'VERIFIED_RELEASE' });
}
