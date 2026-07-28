import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTHZ_ROLES, AUTHZ_PERMISSIONS, canonicalPermissions, validateGrant } from '../packages/shared/authz-schema.js';
import { REQUIRED_SCHEMA } from '../packages/shared/schema-validation.js';

test('authorization schema is registered with additive principal and grant tables', () => {
  assert.ok(REQUIRED_SCHEMA.auth_principals); assert.ok(REQUIRED_SCHEMA.auth_workspace_grants); assert.ok(REQUIRED_SCHEMA.auth_decisions);
  assert.ok(REQUIRED_SCHEMA.sessions.includes('principal_id'));
  assert.deepEqual(AUTHZ_ROLES, ['admin','operator','viewer','service']); assert.ok(AUTHZ_PERMISSIONS.includes('runtime.read'));
});
test('permissions require canonical sorted, deduplicated known values without wildcards', () => {
  assert.equal(canonicalPermissions(['runtime.read','task.read']), '["runtime.read","task.read"]');
  assert.throws(() => canonicalPermissions(['task.read','runtime.read']), /sorted/);
  assert.throws(() => canonicalPermissions(['task.read','task.read']), /sorted/);
  assert.throws(() => canonicalPermissions(['*']), /invalid/);
  assert.throws(() => canonicalPermissions('{bad'), SyntaxError);
});
test('grant validator rejects unknown role, invalid version, and self supersession', () => {
  const base = { id: 'g1', role: 'admin', version: 1, permissions: ['runtime.read'] };
  assert.equal(validateGrant(base), true);
  assert.throws(() => validateGrant({ ...base, role: 'human' }), /invalid/);
  assert.throws(() => validateGrant({ ...base, version: 0 }), /invalid/);
  assert.throws(() => validateGrant({ ...base, supersedesGrantId: 'g1' }), /invalid/);
});
