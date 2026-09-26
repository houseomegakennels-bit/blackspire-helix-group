import test from 'node:test';import assert from 'node:assert/strict';import{MAINTENANCE_STEPS,runPasswordMaintenance}from'../packages/zola-release/password-maintenance.js';
function fixture(failure){const calls=[];const h={preflight:async()=>{calls.push('preflight');if(failure==='preflight')throw Error();return{};},record:async(s,p)=>calls.push(s+':'+p),finish:async()=>calls.push('finish'),contain:async()=>calls.push('contain')};for(const s of MAINTENANCE_STEPS)h[s]=async()=>{calls.push(s);if(s===failure)throw Error();};return{h,calls};}
test('rotation fences sessions before starting and verifies before reopening',async()=>{const{h,calls}=fixture();assert.deepEqual(await runPasswordMaintenance(h),{status:'PASSWORD_ACTIVATED'});assert(calls.indexOf('revoke')<calls.indexOf('start'));assert(calls.indexOf('verifyHeld')<calls.indexOf('open'));assert.equal(calls.at(-1),'finish');assert(!calls.includes('contain'));});
test('preflight rejection does not stop a healthy service',async()=>{const{h,calls}=fixture('preflight');await assert.rejects(runPasswordMaintenance(h));assert.deepEqual(calls,['preflight']);});
for(const step of MAINTENANCE_STEPS)test('failure at '+step+' contains without replay',async()=>{const{h,calls}=fixture(step);await assert.rejects(runPasswordMaintenance(h));assert.equal(calls.at(-1),'contain');assert(!calls.includes('finish'));assert.equal(calls.filter(c=>c===step).length,1);const n=MAINTENANCE_STEPS.indexOf(step);for(const later of MAINTENANCE_STEPS.slice(n+1))assert(!calls.includes(later));});
test('failed durable intent cannot start its operation',async()=>{const{h,calls}=fixture();h.record=async(s,p)=>{if(s==='install'&&p==='intent')throw Error();};await assert.rejects(runPasswordMaintenance(h));assert(!calls.includes('install'));assert.equal(calls.at(-1),'contain');});

import{validatePasswordMaintenanceReadiness as validateReady,validatePasswordReadinessRecovery}from'../packages/zola-release/password-maintenance.js';
test('HELD writer availability is false while writer dependency remains healthy',()=>{
 const j={ok:false,checks:{releaseAdmission:false,lifecycle:true,database:true,productionConfig:true,worker:true,scheduler:true,deploymentIdentity:true,buyerStore:true,buyerWriter:false},deploymentIdentity:{build:{value:'abc'}},dependencies:{worker:{activeTask:false},buyerWriter:{ok:true}}};
 assert.equal(validateReady(503,j,{open:false,releaseSha:'abc'}),true);
 for(const key of ['worker','buyerStore','database']){const copy=structuredClone(j);copy.checks[key]=false;assert.throws(()=>validateReady(503,copy,{open:false,releaseSha:'abc'}));}
 const broken=structuredClone(j);broken.dependencies.buyerWriter.ok=false;assert.throws(()=>validateReady(503,broken,{open:false,releaseSha:'abc'}));
 assert.throws(()=>validateReady(200,{...j,ok:true},{open:true,releaseSha:'abc'}));
 j.ok=true;j.checks.releaseAdmission=true;j.checks.buyerWriter=true;assert.equal(validateReady(200,j,{open:true,releaseSha:'abc'}),true);
});
test('readiness recovery rejects incomplete, advanced and foreign history',()=>{
 const rows=[],operationId='test';
 for(const step of MAINTENANCE_STEPS.slice(0,8)){rows.push({schema:1,type:'password_maintenance',operationId,step,phase:'intent'});if(step==='verifyHeld')break;if(step==='writer')for(const part of ['retire_commit','retire_binding','publish'])for(const phase of ['intent','complete'])rows.push({schema:1,type:'maintenance_writer',step:part,phase});rows.push({schema:1,type:'password_maintenance',operationId,step,phase:'complete'});}
 assert(validatePasswordReadinessRecovery(rows,operationId));
 for(let i=0;i<rows.length;i++)assert.throws(()=>validatePasswordReadinessRecovery(rows.filter((_,n)=>n!==i),operationId));
 assert.throws(()=>validatePasswordReadinessRecovery(rows,'foreign'));
 assert.throws(()=>validatePasswordReadinessRecovery([...rows,{...rows.at(-1),phase:'complete'}],operationId));
});
