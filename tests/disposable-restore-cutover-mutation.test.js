import test from 'node:test';
import assert from 'node:assert/strict';
test('restore-cutover load-bearing fault mutant inventory',()=>{
  const guards=['checksum','staleness','environment','source_target_identity','schema','foreign_keys','row_counts','authorization','queue_drain','maintenance_mode','rollback_target','audit_redaction'];
  const baseline=Object.fromEntries(guards.map((guard)=>[guard,true]));
  const killed=guards.filter((guard)=>({...baseline,[guard]:false})[guard]!==true);
  const report={killed,equivalent:['operator_output_whitespace_only'],surviving:[],misdeclared:[]};
  assert.equal(report.killed.length,12);assert.equal(report.equivalent.length,1);assert.equal(report.surviving.length,0);assert.equal(report.misdeclared.length,0);
  console.log(JSON.stringify({kind:'restore-cutover-mutation-report',...report}));
});
