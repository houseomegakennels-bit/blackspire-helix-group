import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('frontend/src/lib/deal-engine-server.ts','utf8');
const start=source.indexOf('export async function listPropertyBuyerSignals(');
const end=source.indexOf('\nfunction createDealId()',start);
assert.ok(start>=0&&end>start);
const body=stripTypeScriptTypes(source.slice(start,end)).replaceAll('export ','');
const geo=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/buyer-geography.ts','utf8')).replaceAll('export ','')+'\n({normalizeCountyName,normalizeBuyerState,stateFromAddress})');
const lead={county:'Pitt County',propertyAddress:'1 Synthetic Street, Greenville, NC 27834'};
function fixture({size=260,target=259,failPage=-1,unknownJob=-1,missingJob=-1,duplicate=false,changedTotal=false,missingReportJob=false}={}){
 const reports=Array.from({length:size},(_,i)=>({id:`R${i}`,search_job_id:missingReportJob&&i===target?null:`J${i}`,buyer_name_snapshot:`Buyer${i}`,score:i===target?1:100}));
 const jobs=Array.from({length:size},(_,i)=>({id:`J${i}`,county:i===unknownJob?'Unknown':'Pitt',state:i===target?'NC':'SC'}));
 const reads=[],jobReads=[];
 const run=vm.runInNewContext(body+'\nlistPropertyBuyerSignals',{
 ...geo,
 async listAllBuyerReports(options){reads.push(options);if(options.offset===failPage)throw Error('source unavailable');let rows=reports.slice(options.offset,options.offset+options.limit);if(duplicate&&options.offset)rows[0]=reports[0];return {reports:rows,total:changedTotal&&options.offset?size+1:size}},
 async listSearchJobsByIds(ids){jobReads.push(ids);return jobs.filter(job=>ids.includes(job.id)&&job.id!==`J${missingJob}`)},
 toBuyerReportView(report,rows){const job=rows.find(job=>job.id===report.search_job_id);return {id:report.id,buyerName:report.buyer_name_snapshot,county:job?.county,state:job?.state,searchJobId:report.search_job_id,score:report.score}},
 listOutreachDraftRecords:async()=>[],
 buildBuyerSignal(report){return {id:report.id,buyerName:report.buyerName,market:`${report.county}, ${report.state}`,score:report.score}},
 });
 return {run,reads,jobReads};
}
for(const [size,target] of [[21,20],[61,60],[260,259]])test(`property geography precedes shortlist limits across ${size} reports`,async()=>{
 const f=fixture({size,target}),result=await f.run(lead,20);
 assert.equal(result.length,1);assert.equal(result[0].id,`R${target}`);assert.equal(result[0].market,'Pitt, NC');
 assert.ok(f.reads.every(read=>read.strict===true));
 if(size>200){assert.deepEqual(f.reads.map(read=>read.offset),[0,100,200]);assert.deepEqual(f.jobReads.map(ids=>ids.length),[100,100,60]);}
});
test('unknown property geography rejects before any report query',async()=>{
 const f=fixture();await assert.rejects(f.run({...lead,propertyAddress:'No state'},20),/not evaluated/);assert.equal(f.reads.length,0);
});
for(const options of [{failPage:0},{failPage:100},{unknownJob:12},{missingJob:12},{duplicate:true},{changedTotal:true},{missingReportJob:true},{size:5001}])test('incomplete source never becomes zero market demand '+JSON.stringify(options),async()=>{
 await assert.rejects(fixture(options).run(lead,20));
});
test('complete empty report source is a successful empty shortlist',async()=>{
 const f=fixture({size:0,target:-1});const result=await f.run(lead,20);assert.equal(result.length,0);assert.equal(f.jobReads.length,0);
});
test('detail-facing signal loader delegates property scope before generic report limits',async()=>{
 const a=source.indexOf('export async function listDealEngineBuyerSignals('),b=source.indexOf('/** Complete the authorized report set',a);
 const code=stripTypeScriptTypes(source.slice(a,b)).replaceAll('export ','');
 let received;
 const run=vm.runInNewContext(code+'\nlistDealEngineBuyerSignals',{getEnvState:()=>({enabled:true}),listPropertyBuyerSignals:async(property,limit)=>{received={property,limit};return ['scoped']}});
 assert.equal((await run(20,{strict:true,property:lead}))[0],'scoped');assert.equal(received.property,lead);assert.equal(received.limit,20);
});
const buyer=fs.readFileSync('frontend/src/lib/buyer-engine-server.ts','utf8');
const a=buyer.indexOf('export async function listAllBuyerReports('),b=buyer.indexOf('\nexport async function listExports(',a);
const reportsBody=stripTypeScriptTypes(buyer.slice(a,b)).replaceAll('export ','');
function reportsReader({enabled=true,authenticated=true,count=0,queryError=null}={}){
 return vm.runInNewContext(reportsBody+'\nlistAllBuyerReports',{
 ownedBuyerStoreEnabled:()=>false,getEnvState:()=>({enabled}),getAuthenticatedOperator:async()=>authenticated?{id:'synthetic-operator'}:null,
 getSupabaseAdmin:()=>({from(){const q={select(){return q},eq(){return q},order(){return q},range(){return q},then(resolve,reject){return Promise.resolve({data:[],count,error:queryError}).then(resolve,reject)}};return q}}),
 });
}
for(const config of [{enabled:false},{authenticated:false},{count:null},{queryError:{message:'synthetic source failure'}}])test('strict report read rejects unavailable authentication/config/query/count '+JSON.stringify(config),async()=>{
 await assert.rejects(reportsReader(config)({strict:true,limit:100,offset:0}));
});
test('generic report callers retain existing unauthenticated empty behavior',async()=>{assert.equal((await reportsReader({authenticated:false})()).reports.length,0)});
