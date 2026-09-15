// Durable protocol for the concrete Management API host. This module has no
// credential or snapshot-import path. Its injected executor is a host boundary,
// not an assertion of authentication; only database-connected-host supplies it
// in production. Tests supply an isolated executor and never claim livePass.
import { randomBytes } from 'node:crypto';
import { digest, refuse } from './collector.js';
import { divisionSnapshotSQL, ownerWitnessSQL, validateDivisionSnapshot, validateOwnerWitness } from './database-observer.js';

export const CONNECTED_OBSERVER_ENDPOINT = 'https://api.supabase.com/v1/projects/kchtrvfcixnimvxxctkj/database/query';
const validators = { snapshot: validateDivisionSnapshot, owner: validateOwnerWitness };
const generators = { snapshot: divisionSnapshotSQL, owner: ownerWitnessSQL };
const equal = (a,b) => digest(a) === digest(b);
const exact = (v,keys) => v && !Array.isArray(v) && Object.keys(v).sort().join(',') === keys.split(',').sort().join(',');
function queryFor(config, phase, kind, requestBinding) {
  const base = generators[kind](config,phase);
  // A digest of the complete run/config, runtime generations, query kind, phase,
  // random nonce and preceding durable journal prefix is echoed by PostgreSQL.
  return base.replace("'capturedAt',clock_timestamp()", `'collectorBinding','${digest(requestBinding)}','capturedAt',clock_timestamp()`);
}
function validateResponse(value, config, phase, kind, binding, startedAt, completedAt) {
  if (!value || value.collectorBinding !== digest(binding)) refuse('CONNECTED_OBSERVER_RESPONSE_BINDING');
  const { collectorBinding: _binding, ...observation } = value;
  const checked = validators[kind](observation,config,phase);
  const captured = Date.parse(checked.capturedAt);
  if (!Number.isSafeInteger(startedAt) || !Number.isSafeInteger(completedAt) || completedAt < startedAt || completedAt-startedAt > 30000 || captured < startedAt-1000 || captured > completedAt+1000) refuse('CONNECTED_OBSERVER_CLOCK');
  return checked;
}
export function createJournaledConnectedObserver(config, execute) {
  return async (phase, { generation, store }) => {
    if (!['before','after'].includes(phase) || !generation || typeof generation !== 'object' ||
      !['apiGeneration','workerGeneration'].every(k=>typeof generation[k]==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(generation[k]))) refuse('CONNECTED_OBSERVER_CONTEXT');
    const configDigest = digest(config), generationDigest = digest(generation);
    const initial = store.events();
    if (initial[0]?.type !== 'run' || initial[0].binding !== configDigest || initial[0].releaseSha !== config.releaseSha) refuse('CONNECTED_OBSERVER_JOURNAL_BINDING');
    if (phase==='after' && (!Array.from({length:6},(_,i)=>i).every(i=>initial.some(e=>e.type==='intent'&&e.index===i)&&initial.some(e=>e.type==='collected'&&e.index===i)))) refuse('CONNECTED_OBSERVER_AFTER_EARLY');
    const observed = {};
    for (const kind of ['snapshot','owner']) {
      const events = store.events();
      const matches = events.map((event,index)=>({event,index})).filter(({event})=>event.type==='database_query_intent'&&event.binding?.phase===phase&&event.binding?.kind===kind);
      if (matches.length>1) refuse('CONNECTED_OBSERVER_DUPLICATE');
      let intent, intentIndex;
      if (matches.length) {
        ({event:intent,index:intentIndex}=matches[0]);
      } else {
        if (phase==='before' && events.some(e=>e.type==='intent')) refuse('CONNECTED_OBSERVER_BASELINE_MISSING');
        const binding = { version:1, releaseSha:config.releaseSha,runId:config.runId,configDigest,generationDigest,phase,kind,
          endpoint:CONNECTED_OBSERVER_ENDPOINT,nonce:randomBytes(32).toString('hex'),sequence:events.length,previousDigest:digest(events) };
        intent = { type:'database_query_intent',binding,queryDigest:digest(queryFor(config,phase,kind,binding)),startedAt:Date.now() };
        intentIndex = events.length;
        store.append(intent); // Production store fsyncs before any request leaves.
      }
      if (phase==='after' && store.events().slice(intentIndex+1).some(e=>e.type==='collected'||e.type==='intent')) refuse('CONNECTED_OBSERVER_INTERVAL_CLOSED');
      const b = intent.binding;
      if (!exact(intent,'type,binding,queryDigest,startedAt') || !exact(b,'version,releaseSha,runId,configDigest,generationDigest,phase,kind,endpoint,nonce,sequence,previousDigest') ||
        b.version!==1 || b.releaseSha!==config.releaseSha || b.runId!==config.runId || b.configDigest!==configDigest || b.generationDigest!==generationDigest || b.endpoint!==CONNECTED_OBSERVER_ENDPOINT ||
        !/^[a-f0-9]{64}$/.test(b.nonce??'') || b.sequence!==intentIndex || b.previousDigest!==digest(store.events().slice(0,intentIndex)) || intent.queryDigest!==digest(queryFor(config,phase,kind,b))) refuse('CONNECTED_OBSERVER_INTENT_BINDING');
      const results = store.events().map((event,index)=>({event,index})).filter(({event})=>event.type==='database_query_result'&&event.intentDigest===digest(intent));
      if (results.length>1) refuse('CONNECTED_OBSERVER_DUPLICATE');
      let result;
      if (results.length) {
        const saved = results[0];
        if (saved.index!==intentIndex+1) refuse('CONNECTED_OBSERVER_RESULT_ORDER');
        result = saved.event;
      } else {
        // Any existing intent without its fsynced result is uncertain. No
        // imported observation, caller PASS or fresh SQL may fill that interval.
        if (matches.length) refuse('CONNECTED_OBSERVER_OUTCOME_UNKNOWN');
        const value = await execute(queryFor(config,phase,kind,b));
        const completedAt = Date.now();
        validateResponse(value,config,phase,kind,b,intent.startedAt,completedAt);
        if (!equal(store.events().at(-1),intent)) refuse('CONNECTED_OBSERVER_CONCURRENT_JOURNAL');
        result = { type:'database_query_result',intentDigest:digest(intent),queryDigest:intent.queryDigest,observation:value,observationDigest:digest(value),completedAt };
        store.append(result);
      }
      if (!exact(result,'type,intentDigest,queryDigest,observation,observationDigest,completedAt') || result.queryDigest!==intent.queryDigest || result.observationDigest!==digest(result.observation)) refuse('CONNECTED_OBSERVER_RESULT_BINDING');
      if (phase==='before') {
        const firstAdmission = store.events().findIndex(e=>e.type==='intent');
        if (firstAdmission>=0 && intentIndex+1>=firstAdmission) refuse('CONNECTED_OBSERVER_BASELINE_ORDER');
      }
      observed[kind] = validateResponse(result.observation,config,phase,kind,b,intent.startedAt,result.completedAt);
    }
    return observed;
  };
}
