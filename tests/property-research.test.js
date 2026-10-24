import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createHash} from 'node:crypto';
const plain=path=>stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import .*;\n/gm,'')).replaceAll('export ','');
const investment=vm.runInNewContext(plain('frontend/src/lib/investment-analysis.ts')+'\n({analyzeInvestment,parseInvestmentAmount})');
const helpers=vm.runInNewContext(plain('frontend/src/lib/property-research.ts')+'\n({emptyPropertyResearch,validatePropertyResearch,buildRecipientPacketPreview,compareResearchScenarios,researchMoney})',{...investment,URL,Intl});
const {emptyPropertyResearch,validatePropertyResearch,buildRecipientPacketPreview,compareResearchScenarios,researchMoney}=helpers;
const server=vm.runInNewContext(plain('frontend/src/lib/property-research-server.ts')+'\n({createPropertyResearchStore,researchRevisionId,ResearchSaveError})',{...helpers,createHash});
const source={url:'https://example.test/record',documentId:'',accessedOn:'2026-10-23'};
const comp={id:'comp1',address:'1 Synthetic St',status:'sold',price:200000,date:'2026-10-01',squareFeet:1200,source,notes:'INTERNAL-COMP-NOTE',share:true};
const title={id:'e1',kind:'recorded_mortgage',amount:125000,amountState:'documented',asOf:'2010-01-01',source,reviewer:'Synthetic Reviewer',status:'reviewed',notes:'INTERNAL-TITLE-NOTE'};
function research(){return {...emptyPropertyResearch(),comps:[comp],titleEvidence:[title],privateNotes:'SECRET-INTERNAL-NOTE',duplicateReview:{candidateIds:['DE-0002'],decision:'possible_duplicate',notes:'SECRET-DUPLICATE'}}}

test('listed records stay listed and sold comps require date, amount and source',()=>{
 const r=research();r.comps[0]={...comp,status:'listed',price:300000};assert.equal(validatePropertyResearch(r).comps[0].status,'listed');
 for(const patch of [{price:null},{date:''},{source:{...source,url:'',documentId:''}}])assert.throws(()=>validatePropertyResearch({...research(),comps:[{...comp,...patch}]}),/Sold comparables require/);
});
test('mortgage records never become payoff balances and title stays undetermined after uploads',()=>{
 const r=validatePropertyResearch({...research(),titleClear:true,uploadedDocuments:[{name:'Title clear.pdf'}]});
 assert.equal(r.titleEvidence[0].kind,'recorded_mortgage');assert.equal('titleClear' in r,false);
 const preview=buildRecipientPacketPreview('Synthetic address','title',r);assert.match(preview.titleStatus,/Not determined/);assert.equal(preview.titleEvidence[0].kind,'recorded_mortgage');
});
test('unknown amounts remain null; documented zero requires dated source evidence',()=>{
 assert.equal(validatePropertyResearch({...research(),titleEvidence:[{...title,amountState:'unknown',amount:0}]}).titleEvidence[0].amount,null);
 assert.equal(validatePropertyResearch({...research(),titleEvidence:[{...title,amount:0}]}).titleEvidence[0].amount,0);
 for(const patch of [{amount:null},{asOf:''},{source:{url:'',documentId:'',accessedOn:''}}])assert.throws(()=>validatePropertyResearch({...research(),titleEvidence:[{...title,amount:0,...patch}]}),/documented amount/i);
 assert.equal(researchMoney(null),'Unknown');assert.match(researchMoney(0),/0\.00/);
});
test('recipient whitelist excludes internal notes, profit targets and seller contacts',()=>{
 for(const audience of ['buyer','seller','jv','title']){
  const r=research();r.sellerPhone='555-PRIVATE';r.negotiatingCeiling=100000;r.scenarios=[{label:'base',inputs:{purchasePrice:100000,resaleValue:200000,repairs:0,closingCosts:0,holdingCosts:0,profitTarget:50000,assignmentFee:10000}}];
  const p=buildRecipientPacketPreview('Synthetic address',audience,validatePropertyResearch(r));assert.doesNotMatch(JSON.stringify(p),/SECRET|INTERNAL|PRIVATE|profitTarget|negotiatingCeiling/);
  assert.equal(p.titleEvidence.length,audience==='title'?1:0);assert.equal(p.comparableResearch.length,audience==='seller'?0:1);
 }
 const r=research();r.comps[0]={...comp,share:false};assert.equal(buildRecipientPacketPreview('Synthetic','buyer',r).comparableResearch.length,0);
});
test('scenarios reuse investment math and preserve negative calculated results and missing inputs',()=>{
 const inputs={strategy:'assignment',purchasePrice:200000,resaleValue:100000,repairs:50000,closingCosts:5000,holdingCosts:5000,profitTarget:50000,assignmentFee:10000};
 const r={...research(),scenarios:[{label:'low',inputs},{label:'base',inputs:{...inputs,resaleValue:null}},{label:'high',inputs:{...inputs,repairs:-1}}]};
 const rows=compareResearchScenarios(r);assert.ok(rows[0].analysis.profit<0);assert.ok(rows[0].analysis.ceiling<0);assert.equal(rows[1].analysis.ceiling,null);assert.equal(rows[1].analysis.complete,false);assert.equal(rows[2].analysis,null);assert.match(rows[2].error,/invalid amounts/);
 assert.throws(()=>validatePropertyResearch(r),/between 0/);
});
test('source protocols and malformed dates are rejected and duplicate IDs require review',()=>{
 assert.throws(()=>validatePropertyResearch({...research(),comps:[{...comp,source:{...source,url:'javascript:alert(1)'}}]}),/HTTPS/);
 assert.throws(()=>validatePropertyResearch({...research(),comps:[{...comp,date:'2026-02-30'}]}),/calendar/);
 assert.throws(()=>validatePropertyResearch({...research(),comps:[comp,comp]}),/unique/);
});

function fixture({commitThenLose=false}={}){
 const rows=new Map();let inserts=0,updates=0,deny=false,lose=commitThenLose;
 const db={from(table){let filters=[],insert=null;const q={select(){return q},eq(key,value){filters.push([key,value]);return q},order(key){assert.equal(key,'payload->revision');return q},limit(){return q},maybeSingle(){return q},single(){return q},insert(value){insert=value;return q},update(){updates++;throw Error('UPDATE forbidden')},delete(){throw Error('DELETE forbidden')},then(resolve,reject){
  if(deny)return Promise.resolve({data:null,error:{message:'synthetic outage'}}).then(resolve,reject);
  if(table==='deal_leads')return Promise.resolve({data:filters.some(([k,v])=>k==='id'&&v==='DE-0001')?{id:'DE-0001'}:null,error:null}).then(resolve,reject);
  assert.equal(table,'disposition_logs');
  if(insert){inserts++;if(rows.has(insert.id))return Promise.resolve({data:null,error:{code:'23505'}}).then(resolve,reject);const row={...insert,created_at:'2026-10-23T00:00:00Z'};rows.set(row.id,row);if(lose){lose=false;return Promise.resolve({data:null,error:{message:'lost acknowledgement'}}).then(resolve,reject)}return Promise.resolve({data:row,error:null}).then(resolve,reject)}
  const found=[...rows.values()].filter(row=>filters.every(([key,value])=>row[key]===value)).sort((a,b)=>b.payload.revision-a.payload.revision)[0]??null;
  return Promise.resolve({data:found,error:null}).then(resolve,reject);
 }};return q}};
 return {store:server.createPropertyResearchStore(db),rows,inserts:()=>inserts,updates:()=>updates,deny:()=>{deny=true}};
}
test('immutable revision saves reload exactly without UPDATE or DELETE',async()=>{
 const f=fixture();const first=await f.store.load('DE-0001');assert.equal(first.revision,0);
 const saved=await f.store.save('DE-0001',0,research(),'operator-1');assert.equal(saved.revision,1);assert.equal((await f.store.load('DE-0001')).research.privateNotes,'SECRET-INTERNAL-NOTE');assert.equal(f.updates(),0);
});
test('concurrent revision claims allow one winner and preserve the losing draft',async()=>{
 const f=fixture(),a=research(),b={...research(),privateNotes:'other draft'};
 const results=await Promise.allSettled([f.store.save('DE-0001',0,a,'operator-1'),f.store.save('DE-0001',0,b,'operator-2')]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const denied=results.find(r=>r.status==='rejected');assert.equal(denied.reason.status,409);assert.equal(f.rows.size,1);assert.equal(b.privateNotes,'other draft');
});
test('interrupted save commits once; exact retry reconciles without a second INSERT',async()=>{
 const f=fixture({commitThenLose:true});await assert.rejects(f.store.save('DE-0001',0,research(),'operator-1'),e=>e.status===503);
 assert.equal((await f.store.load('DE-0001')).revision,1);const retry=await f.store.save('DE-0001',0,research(),'operator-1');assert.equal(retry.revision,1);assert.equal(f.inserts(),1);
});
test('stale drafts and missing properties cannot insert into another property',async()=>{
 const f=fixture();await f.store.save('DE-0001',0,research(),'operator-1');await assert.rejects(f.store.save('DE-0001',0,{...research(),privateNotes:'stale'},'operator-1'),e=>e.status===409);
 await assert.rejects(f.store.save('DE-0002',0,research(),'operator-1'),e=>e.status===404);assert.equal(f.rows.size,1);
});
test('failed reads never become empty successful research',async()=>{
 const f=fixture();f.deny();await assert.rejects(f.store.load('DE-0001'),e=>e.status===503);
});
test('research routes reuse existing admin gate and deny other accounts before reads or writes',async()=>{
 let stores=0;
 for(const status of [401,403]){
  const routes=vm.runInNewContext(plain('frontend/src/app/api/deal-engine/research/route.ts')+'\n({GET,POST})',{
   NextResponse:Response,ResearchSaveError:server.ResearchSaveError,
   guardAdminApiContext:async()=>({response:Response.json({ok:false},{status})}),
   propertyResearchStore:()=>{stores++;throw Error('must not reach storage')},
  });
  const request={nextUrl:new URL('https://synthetic.test/api/deal-engine/research?dealId=DE-0001')};
  assert.equal((await routes.GET(request)).status,status);assert.equal((await routes.POST(request)).status,status);
 }
 assert.equal(stores,0);
});
