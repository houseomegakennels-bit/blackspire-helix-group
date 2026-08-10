import crypto from 'node:crypto';
import { canViewRuntimeStatus } from '../shared/authorization.js';
import { ENVIRONMENTS } from './model.js';
import { serializeDeploymentIdentity } from '../shared/deployment-identity.js';
import { createOperatorReleaseReport } from '../shared/release-evidence.js';

const ID = /^[A-Za-z0-9._:-]{1,128}$/;
function cursorFor(event) {
  const payload = Buffer.from(JSON.stringify({ timestampMs: event.timestampMs, id: event.id })).toString('base64url');
  const checksum = crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16);
  return `${payload}.${checksum}`;
}
function parseCursor(cursor) {
  if (!cursor) return null;
  if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_.-]+$/.test(cursor)) throw new Error('invalid diagnostics cursor');
  const [payload, checksum, extra] = cursor.split('.');
  if (extra || crypto.createHash('sha256').update(payload).digest('hex').slice(0, 16) !== checksum) throw new Error('invalid diagnostics cursor');
  let decoded; try { decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { throw new Error('invalid diagnostics cursor'); }
  if (!Number.isSafeInteger(decoded.timestampMs) || typeof decoded.id !== 'string' || !/^[a-f0-9]{64}$/.test(decoded.id)) throw new Error('invalid diagnostics cursor');
  return decoded;
}

export function readOperatorDiagnostics({ principal, environment, workspaceId, limit = 25, cursor = null, store, engine, authorize = canViewRuntimeStatus, identityProvider = null, releaseContextProvider = null }) {
  if (!ENVIRONMENTS.includes(environment)) return { status: 400, body: { error: 'invalid environment' } };
  if (typeof workspaceId !== 'string' || !ID.test(workspaceId)) return { status: 400, body: { error: 'invalid workspace' } };
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return { status: 400, body: { error: 'limit must be from 1 to 100' } };
  const decision = authorize(principal, workspaceId);
  if (!decision?.allowed) return { status: 403, body: { error: 'diagnostics unavailable' } };
  const rawIdentity = identityProvider?.get?.(); const deploymentIdentity = serializeDeploymentIdentity(rawIdentity);
  let after; try { after = parseCursor(cursor); } catch { return { status: 400, body: { error: 'invalid cursor' } }; }
  const summary = engine.summary(environment, workspaceId);
  const ordered = store.events(environment, workspaceId).slice().sort((a,b) => b.timestampMs - a.timestampMs || b.id.localeCompare(a.id));
  const filtered = after ? ordered.filter((event) => event.timestampMs < after.timestampMs || (event.timestampMs === after.timestampMs && event.id < after.id)) : ordered;
  const history = filtered.slice(0, limit); const nextCursor = filtered.length > limit ? cursorFor(history.at(-1)) : null;
  const byComponent = Object.fromEntries(summary.components.map((item) => [item.component, { state: item.state, timestamp: item.timestamp, reasonCode: item.reasonCode }]));
  const build = summary.components.find((item) => item.component === 'build');
  const releaseContext = releaseContextProvider?.get?.() || {};
  const releaseReport = createOperatorReleaseReport({ expected: releaseContext.expected, actual: rawIdentity?.releaseEvidence,
    postDeploy: releaseContext.postDeploy, rollback: releaseContext.rollback, health: summary.state });
  return { status: 200, body: { version: 1, readOnly: true, automaticActionTaken: false, environment, workspaceId, overallState: summary.state,
    rollbackRecommendation: summary.rollbackRecommendation, deployment: build ? { commit: build.commit, buildFingerprint: build.buildFingerprint, identity: deploymentIdentity } : { identity: deploymentIdentity }, releaseReport,
    components: byComponent, latestMeaningfulTransition: summary.latestTransition, history, nextCursor,
    staleComponents: summary.staleComponents, flappingComponents: summary.flappingComponents,
    migrationStatus: byComponent.migration || null, killSwitchStatus: byComponent.kill_switch || null,
    disabledCapabilities: ['providers','telegram','scheduler'].filter((component) => byComponent[component]?.state === 'disabled'),
    lastTrustedObservationAt: summary.components.map((item) => item.timestamp).sort().at(-1) || null } };
}
