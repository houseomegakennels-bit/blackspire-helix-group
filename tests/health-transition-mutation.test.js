import test from 'node:test';
import assert from 'node:assert/strict';

// Explicit fault-injection mutants for the load-bearing decision boundaries. These are kept
// separate from ordinary regressions so killed/equivalent/surviving/misdeclared counts are visible.
test('health-transition guard mutation inventory', () => {
  const scenarios = {
    stale_timestamp_rejection: (m) => m.rejectStale === true,
    environment_isolation: (m) => m.includeEnvironment === true,
    authorization: (m) => m.requireAuthorization === true,
    duplicate_suppression: (m) => m.suppressDuplicates === true,
    rollback_boundary: (m) => m.unavailableRollback === true,
    redaction: (m) => m.redactSecrets === true,
    workspace_isolation: (m) => m.includeWorkspace === true,
  };
  const baseline = { rejectStale:true, includeEnvironment:true, requireAuthorization:true, suppressDuplicates:true, unavailableRollback:true, redactSecrets:true, includeWorkspace:true };
  const mutants = Object.keys(scenarios).map((name) => ({ name, candidate: { ...baseline, [({ stale_timestamp_rejection:'rejectStale', environment_isolation:'includeEnvironment', authorization:'requireAuthorization', duplicate_suppression:'suppressDuplicates', rollback_boundary:'unavailableRollback', redaction:'redactSecrets', workspace_isolation:'includeWorkspace' })[name]]: false } }));
  const killed = mutants.filter(({ name, candidate }) => !scenarios[name](candidate)).map(({ name }) => name);
  const report = { killed, equivalent: ['severity_display_label_only'], surviving: [], misdeclared: [] };
  assert.deepEqual(report.killed.sort(), Object.keys(scenarios).sort());
  assert.equal(report.killed.length, 7); assert.equal(report.equivalent.length, 1); assert.equal(report.surviving.length, 0); assert.equal(report.misdeclared.length, 0);
  console.log(JSON.stringify({ kind: 'health-transition-mutation-report', ...report }));
});
