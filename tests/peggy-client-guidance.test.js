import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const source = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8');
function extract(start, end, names, globals = {}) {
  const text = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  return vm.runInNewContext(stripTypeScriptTypes(text) + `\n({${names}})`, globals);
}
const { buildSellerOutreach } = extract('function buildSellerOutreach(', '\nfunction buildInitialContactTask', 'buildSellerOutreach');
const { normalizeStage, buildStageBoard } = extract('function normalizeStage(', '\nfunction parseDispositionLogs', 'normalizeStage, buildStageBoard');
const start = source.indexOf('function normalizeBuyerSignalLane(');
const end = source.indexOf('\nfunction ', source.indexOf('function rankBuyerSignalsForLead(') + 10);
const rank = vm.runInNewContext(stripTypeScriptTypes(source.slice(start, end)) + '\nrankBuyerSignalsForLead');
const guidance = fs.readFileSync('frontend/src/lib/property-client-guidance.ts', 'utf8');
const { draftNeedsReview, readableNextStep, suspectedTestRecord } = vm.runInNewContext(stripTypeScriptTypes(guidance).replaceAll('export ', '') + '\n({draftNeedsReview, readableNextStep, suspectedTestRecord})');
const scoring = fs.readFileSync('frontend/src/lib/sentinel-scoring.ts', 'utf8');
const display = fs.readFileSync('frontend/src/lib/sentinel-display.ts', 'utf8').replace(/import\s*\{[\s\S]*?from "@\/lib\/sentinel-scoring";/, '').replace('export { getDealReadinessStatus };', '');
const readiness = vm.runInNewContext(stripTypeScriptTypes(scoring + '\n' + display).replaceAll('export ', '') + '\ndealReadinessFromCoordination');

test('customer drafts never interpolate internal notes, errors, placeholder prices or inferred ceiling', () => {
 const drafts = buildSellerOutreach({ ownerName: 'Heirs of Example', propertyAddress: '10 Example St', nextAction: '<html>502 Bad Gateway</html>', mao: '$999,999' }, { summary: 'private note', recommendedAction: 'dispatch secret' }, { ownerName: 'Heirs of Example' }, { offerWindow: 'Not entered', outreachLead: 'internal-only' });
 const text = JSON.stringify(drafts);
 assert.doesNotMatch(text, /502|html|private note|dispatch|Not entered|999,999|internal-only|Hi Heirs/i);
 assert.match(drafts.firstTouchSms, /^Hello,/);
 assert.equal(draftNeedsReview(text), false);
});
test('underwriting and closing stages do not fall back into new intake', () => {
 for (const status of ['Underwriting', 'Needs Analysis', 'Analysis Complete']) assert.equal(normalizeStage(status), 'Underwriting');
 assert.equal(normalizeStage('Closing'), 'Contract / Packet');
 assert.equal(normalizeStage('Closed Won'), 'Completed / Archived');
 const board = buildStageBoard([{id:'1',status:'Underwriting'},{id:'2',status:'Closed'}]);
 assert.equal(board.find(x=>x.label==='New Intake').count,0);
 assert.equal(board.reduce((sum,x)=>sum+x.count,0),2);
});
test('broader markets and mismatched types are explicitly identified as unverified candidates', () => {
 const candidates = rank({county:'Mecklenburg',exitStrategy:'Wholesale / Flip',propertyAddress:'10 Example St'},[
 {id:'1',buyerName:'Land LLC',market:'Forsyth, NC',propertyType:'land',score:60,purchaseCount:1},
 {id:'2',buyerName:'Home LLC',market:'Mecklenburg, NC',propertyType:'residential',score:50,purchaseCount:1}], 4);
 assert.equal(candidates[0].id,'2');
 assert.match(candidates[0].matchReason,/verify/);
 assert.match(candidates[1].matchReason,/Property-type fit is not established/);
});
test('unassigned and not-received statuses never award positive readiness', () => {
 const result=readiness({buyerAssignmentStatus:'Unassigned',earnestMoneyStatus:'Not received',titleCompany:'County title partner',payoutStatus:'Awaiting statement',closingChecklist:[{status:'Incomplete'}],closingDocuments:[{name:'Assignment agreement',status:'Requested'}]}, {hasDocuments:true});
 assert.equal(result.score,0);
 assert.ok(result.factors.every(x=>!x.met));
});
test('upload presence alone does not establish complete documents or assignment agreement', () => {
 const result=readiness({closingDocuments:[{name:'Signed contract',status:'Received'}]}, {hasDocuments:true});
 assert.equal(result.factors.find(x=>x.key==='documentCompleteness').met,false);
 assert.equal(result.factors.find(x=>x.key==='assignmentAgreementReady').met,false);
 const reviewed=readiness({closingDocuments:[{name:'Assignment agreement',status:'Reviewed'}]}, {hasDocuments:true});
 assert.equal(reviewed.factors.find(x=>x.key==='assignmentAgreementReady').met,true);
});
test('technical errors and incomplete customer drafts are recognized without exposing raw errors', () => {
 assert.equal(draftNeedsReview('An offer somewhere Not entered'),true);
 assert.equal(draftNeedsReview('Workflow trigger failed: <html>'),true);
 assert.doesNotMatch(readableNextStep('Workflow returned 502 Bad Gateway <html>'),/502|html|gateway/i);
 assert.equal(suspectedTestRecord('Diagnostic Buyer buyer@example.com'),true);
 assert.equal(suspectedTestRecord('Proof of funds received from Acme LLC'),false);
});
