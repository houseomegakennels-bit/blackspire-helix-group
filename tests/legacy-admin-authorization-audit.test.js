import test from 'node:test';
import assert from 'node:assert/strict';
import { auditLegacyAdminAuthorization } from '../scripts/audit-legacy-admin-authorization.js';

test('legacy admin workspace authorization gaps remain explicit and fail production readiness closed', () => {
  const report = auditLegacyAdminAuthorization();
  assert.equal(report.inventoryComplete, true);
  assert.equal(report.readyForControlledStaging, false);
  assert.equal(report.readyForSafeProduction, false);
  assert.equal(report.automaticFixApplied, false);
  assert.equal(report.surfaces.length, 7);
  assert.equal(report.surfaces.every((surface) => surface.workspaceAuthorization === 'missing'), true);
});

test('the inventory fails closed when a tracked legacy route changes without an audit update', () => {
  const report = auditLegacyAdminAuthorization('export function unrelated() {}');
  assert.equal(report.inventoryComplete, false);
  assert.equal(report.readyForControlledStaging, false);
  assert.equal(report.readyForSafeProduction, false);
  assert.equal(report.surfaces.every((surface) => surface.inventoryMarkerPresent === false), true);
});
