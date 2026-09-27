import test from 'node:test';
import assert from 'node:assert/strict';
import {FEATURE_STEPS,runFeatureRelease} from '../packages/zola-release/feature-release.js';
function fixture(failure){
 const events=[],state={live:'old',admission:'open',closed:false};
 const h={preflight:async()=>{if(failure==='preflight')throw Error('injected');return {sha:'new'};},
 record:async(s,p)=>{events.push(s+':'+p);if(failure==='record:'+s+':'+p)throw Error('injected');},
 contain:async()=>{events.push('contain');state.admission='held';},
 rollback:async()=>{events.push('rollback');if(failure==='rollback')throw Error('injected');state.live='old';state.admission='open';},
 finish:async()=>{if(['finish','rollback'].includes(failure))throw Error('injected');},
 close:async()=>{state.closed=true;}};
 for(const step of FEATURE_STEPS)h[step]=async()=>{
  if(step==='hold')state.admission='held';
  if(step==='switchRelease')state.live='new';
  if(step==='open')state.admission='open';
  if(failure===step)throw Error('injected');
 };
 return {h,state,events};
}
test('successful feature transaction opens exact candidate and closes its lease',async()=>{
 const {h,state,events}=fixture();assert.equal((await runFeatureRelease(h)).status,'FEATURE_RELEASE_ACTIVE');
 assert.deepEqual(state,{live:'new',admission:'open',closed:true});assert.equal(events.includes('rollback'),false);
});
test('each partial transaction and post-write journal failure restores previous runtime',async()=>{
 for(const step of FEATURE_STEPS){
  for(const failure of [step,'record:'+step+':complete']){
   const {h,state,events}=fixture(failure);await assert.rejects(()=>runFeatureRelease(h));
   assert.deepEqual(state,{live:'old',admission:'open',closed:true},failure);
   assert.ok(events.indexOf('contain')<events.indexOf('rollback'),failure);
  }
 }
});
test('preflight or initial journal failure does not stop the working runtime',async()=>{
 for(const failure of ['preflight','record:hold:intent']){
  const {h,state,events}=fixture(failure);await assert.rejects(()=>runFeatureRelease(h));
  assert.deepEqual(state,{live:'old',admission:'open',closed:true});assert.equal(events.includes('contain'),false);
 }
});
test('rollback failure reasserts containment instead of returning a live success',async()=>{
 const {h,state,events}=fixture('rollback');await assert.rejects(()=>runFeatureRelease(h),/rollback incomplete/);
 assert.equal(state.admission,'held');assert.equal(state.closed,true);assert.equal(events.filter(e=>e==='contain').length,2);
});
