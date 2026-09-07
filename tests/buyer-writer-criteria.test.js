import test from 'node:test';
import assert from 'node:assert/strict';
import { captureBuyerJobVersion } from '../packages/buyer-writer/criteria.js';
const job={state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',date_range_end:'2026-12-31',
  min_purchases:null,cash_buyers_only:null,llc_buyers_only:false,updated_at:'2026-09-07T00:00:00.123456+00:00'};
test('acquisition captures canonical criteria and full-precision optimistic revision without default substitution',()=>{
  const input={...job};const captured=captureBuyerJobVersion(input);input.county='changed';input.updated_at='changed';
  assert.equal(captured.criteria.county,'Wake');assert.equal(captured.criteria.min_purchases,null);
  assert.equal(captured.criteria.cash_buyers_only,null);assert.equal(captured.updatedAt,job.updated_at);
  assert.equal(Object.isFrozen(captured.criteria),true);assert.equal(Object.isFrozen(captured),true);
  assert.equal(captureBuyerJobVersion({...job,updated_at:null}).updatedAt,null);
});
test('missing, malformed, nonfinite or truncated acquisition authority fails before fetching',()=>{
  const missing={...job};delete missing.updated_at;
  for(const input of [missing,{...job,updated_at:Infinity},{...job,updated_at:'infinity'},{...job,date_range_start:'2026-02-30'},
    {...job,min_purchases:NaN},{...job,min_purchases:6},{...job,cash_buyers_only:'false'},{...job,updated_at:'2026-09-07T00:00:00.1234567Z'}])
    assert.throws(()=>captureBuyerJobVersion(input));
});
