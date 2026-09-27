import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeDealRecords } from '../packages/capabilities/deal-records.js';
const row = (overrides = {}) => ({ dealId:'DE-1001', propertyAddress:'100 Main St', status:'Needs review', nextAction:'Confirm repair estimate', missingInputs:['Repair estimate'], motivationScore:55, mao:'$100,000', readyForContract:false, exitStrategy:'Wholesale', ...overrides });
const result = deals => ({ deals, sourceSnapshotAt:'2026-09-27T17:00:00.000Z' });
test('report discloses scope and available next steps without inventing activity', () => {
 const report = summarizeDealRecords(result([row()]));
 for (const text of ['1 retrieved','not a full pipeline count','Stage: Needs review','Next: Confirm repair estimate','Missing: Repair estimate','Latest activity is not supplied']) assert.ok(report.includes(text), text);
 assert.ok(!report.includes('all deals'));
});
test('suspected test and unknown records remain visible but are not preferred for review', () => {
 const report = summarizeDealRecords(result([row({propertyAddress:'55 Test Loop',motivationScore:99}),row({propertyAddress:'Unknown property'}),row({propertyAddress:'200 Real St',missingInputs:[]})]));
 assert.match(report,/Possible test record — verify/); assert.match(report,/Property identity missing/);
 assert.match(report,/Review first: 200 Real St/); assert.match(report,/55 Test Loop/); assert.match(report,/Unknown property/);
});
test('empty and missing next steps are explicit', () => {
 assert.match(summarizeDealRecords(result([])),/No Deal Engine records were returned/);
 assert.match(summarizeDealRecords(result([row({nextAction:null,missingInputs:[]})])),/No next action recorded/);
});
test('maximum valid result stays within one Telegram message and preserves each record', () => {
 const report = summarizeDealRecords(result(Array.from({length:10},(_,i)=>row({dealId:`DE-${1000+i}`,propertyAddress:'a'.repeat(500),status:'s'.repeat(500),nextAction:'n'.repeat(500),missingInputs:Array(8).fill('m'.repeat(500))}))));
 assert.ok(report.length<=3500); for(let i=0;i<10;i++)assert.ok(report.includes(`DE-${1000+i}`));
 assert.match(report,/more detail available/);
});
