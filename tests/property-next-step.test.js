import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const source=fs.readFileSync(new URL('../frontend/src/lib/property-next-step.ts',import.meta.url),'utf8');
const {propertyNextStep,propertyCalendarDate,propertyToday}=vm.runInNewContext(stripTypeScriptTypes(source).replaceAll('export ', '')+'\n({propertyNextStep,propertyCalendarDate,propertyToday})');
const coordination=()=>({contractSent:false,contractSigned:false,inspectionEndsOn:'',closingDate:'',titleCompany:'',titleOfficer:'',buyerAssignmentStatus:'Unassigned',closingChecklist:[],closingDocuments:[]});
const input=(overrides={})=>({stage:'Needs Analysis',nextAction:'private saved direction',missingInputs:['ARV'],coordination:coordination(),tasks:[],today:'2026-10-23',...overrides});

test('completed stage does not reopen missing historical underwriting or overdue acquisition tasks',()=>{
 const result=propertyNextStep(input({stage:'Closed Won',tasks:[{title:'Call seller',status:'Open',dueDate:'2026-10-01',owner:'Carlos'}]}));
 assert.equal(result.urgency,'complete');assert.equal(result.section,'closing');
 assert.doesNotMatch(result.text,/ARV|Call seller/);
});
test('earliest persisted overdue task outranks missing numbers and shows owner and waiting state',()=>{
 const result=propertyNextStep(input({tasks:[{title:'Await payoff statement',status:'Waiting',dueDate:'2026-10-22',owner:'Title officer'},{title:'Review lien evidence',status:'Open',dueDate:'2026-10-20',owner:'Carlos'}]}));
 assert.equal(result.text,'Review lien evidence');assert.equal(result.owner,'Carlos');assert.equal(result.dueDate,'2026-10-20');assert.equal(result.urgency,'overdue');
 const waiting=propertyNextStep(input({tasks:[{title:'Await payoff statement',status:'Waiting',dueDate:'2026-10-22',owner:''}]}));
 assert.match(waiting.reason,/waiting or blocked/);assert.equal(waiting.owner,null);
});
test('due today remains due today and completed task deadlines are omitted',()=>{
 const result=propertyNextStep(input({tasks:[{title:'Done task',status:'Completed',dueDate:'2026-10-01',owner:'A'},{title:'Review statement',status:'Open',dueDate:'2026-10-23',owner:'B'}]}));
 assert.equal(result.text,'Review statement');assert.match(result.reason,/due today/);
});
test('invalid or unknown dates are not fabricated into deadlines',()=>{
 for(const value of ['', 'tomorrow','2026-02-30','2026-13-01','2026-10-23T00:00:00Z'])assert.equal(propertyCalendarDate(value),null);
 assert.equal(propertyCalendarDate('2024-02-29'),'2024-02-29');
 const result=propertyNextStep(input({tasks:[{title:'Bad deadline',status:'Open',dueDate:'tomorrow',owner:'A'}]}));
 assert.equal(result.section,'numbers');assert.equal(result.dueDate,null);
});
test('current stage, contract and editor values govern guidance instead of stale detail snapshots',()=>{
 const c=coordination();let result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.label,'Review offer');
 c.contractSent=true;result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.label,'Review contract evidence');
 c.contractSigned=true;c.titleCompany='Not assigned';result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.label,'Review title coordination');
 c.titleCompany='Synthetic title';result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.section,'documents');
 c.closingDocuments=[{name:'Uploaded deed',status:'Received'}];result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.section,'documents');assert.match(result.reason,/not a title clearance/);
 c.closingDocuments=[{name:'Executed contract',status:'Reviewed'}];result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.section,'buyers');
 c.buyerAssignmentStatus='Assigned';result=propertyNextStep(input({missingInputs:[],coordination:c}));assert.equal(result.label,'Review closing tasks');
});
test('signed inspection deadline is prioritized but unsigned synthetic inspection is not assumed binding',()=>{
 const c={...coordination(),inspectionEndsOn:'2026-10-24'};
 assert.equal(propertyNextStep(input({coordination:c})).section,'numbers');
 c.contractSigned=true;assert.equal(propertyNextStep(input({coordination:c})).label,'Review deadline');
});
test('date boundaries use New York calendar without shifting date-only legal deadlines',()=>{
 assert.equal(propertyToday(new Date('2026-10-24T01:00:00Z')),'2026-10-23');
 assert.equal(propertyCalendarDate('2026-10-24'),'2026-10-24');
});
