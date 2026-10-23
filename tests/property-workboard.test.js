import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';

const root = process.env.WORKBOARD_SLICE_ROOT || 'frontend/src/lib';
const modelSource = fs.readFileSync(path.join(root, 'property-workboard-model.ts'), 'utf8');
const model = vm.runInNewContext(stripTypeScriptTypes(modelSource).replaceAll('export ', '') + '\n({buildPropertyWorkboard,filterWorkboardProperties,workboardDate})');
const serverSource = fs.readFileSync(path.join(root, 'property-workboard-server.ts'), 'utf8').replace(/^import .*;\n/gm, '');
function server(dependencies = {}) { return vm.runInNewContext(stripTypeScriptTypes(serverSource).replaceAll('export ', '') + '\n({readPropertyWorkboard,getPropertyWorkboard})', { ...model, process: {env:{}}, Date, ...dependencies }); }
const property = id => ({id,address:`${id} Synthetic Road, Greenville, NC 27834`,ownerName:'Synthetic Seller',county:'Pitt',status:'Underwriting',nextAction:'Review evidence'});
const log = (id,lead_id,payload,created_at = '2026-10-22T12:00:00Z',action_type = 'operator_task') => ({id,lead_id,payload,created_at,action_type});

test('Today ranks actual deadlines across all properties, without substituting update timestamps', () => {
 const properties = Array.from({length:150},(_,i)=>property(`DE-${i}`));
 const logs = [log('1','DE-149',{taskId:'late',title:'County records',dueDate:'2026-10-20',owner:'Carlos',status:'Waiting',notes:'Awaiting records'}),log('2','DE-130',{taskId:'now',title:'Call review',dueDate:'2026-10-23',owner:'Charles'}),log('3','DE-129',{taskId:'none',title:'Unscheduled',updatedAt:'2026-01-01'})];
 const result = model.buildPropertyWorkboard(properties,logs,'2026-10-23');
 assert.equal(result.items[0].dealId,'DE-149');assert.equal(result.items[0].urgency,'overdue');assert.equal(result.items[0].owner,'Carlos');assert.equal(result.items[0].blocker,'Awaiting records');assert.match(result.items[0].href,/DE-149#property-activity$/);
 assert.equal(result.items[1].dealId,'DE-130');
 const unknown = result.items.find(item=>item.id==='DE-129:none');assert.equal(unknown.dueAt,null);assert.equal(unknown.dueOn,null);assert.equal(unknown.owner,'Unassigned');assert.equal(unknown.urgency,'unscheduled');
});
test('latest task update wins, completed tasks do not reappear, foreign and closed-property logs are ignored',()=>{
 const p=property('DE-1'),closed={...property('DE-2'),status:'Closed'};
 const result=model.buildPropertyWorkboard([p,closed],[log('older','DE-1',{taskId:'one',title:'Old open',status:'Open'},'2026-10-21T00:00:00Z'),log('latest','DE-1',{taskId:'one',title:'Done now',status:'Done'},'2026-10-22T00:00:00Z'),log('foreign','DE-999',{title:'Private elsewhere'}),log('closed','DE-2',{title:'Old task'})],'2026-10-23');
 assert.equal(result.items.some(item=>item.title==='Old open'||item.title==='Done now'||item.title==='Private elsewhere'||item.dealId==='DE-2'),false);
 assert.equal(result.items[0].dueAt,null,'fallback review has no manufactured deadline');
});
test('only latest coordination supplies saved closing, inspection, walkthrough and checklist dates',()=>{
 const result=model.buildPropertyWorkboard([property('DE-1')],[log('old','DE-1',{closingDate:'2026-01-01'},'2026-10-20T00:00:00Z','coordination_update'),log('new','DE-1',{closingDate:'2026-11-01',inspectionEndsOn:'2026-10-23',titleOfficer:'Synthetic Officer',closingChecklist:[{id:'1',title:'Check title',owner:'Charles',status:'Blocked',dueDate:'2026-10-24',notes:'Need attorney evidence'}]},'2026-10-22T00:00:00Z','coordination_update')],'2026-10-23');
 assert.equal(result.items.length,3);assert.equal(result.items[0].title,'Review inspection deadline');assert.equal(result.items.some(item=>item.dueAt==='2026-01-01'),false);assert.equal(result.items.find(item=>item.title==='Check title').blocker,'Need attorney evidence');
});
test('unknown and malformed saved dates remain reviewable, not falsely overdue',()=>{
 for(const date of ['tomorrow','2026-02-30','2026-99-99','', '2025-02-29'])assert.equal(model.workboardDate(date),null);
 assert.equal(model.workboardDate('2024-02-29'),'2024-02-29');
 const result=model.buildPropertyWorkboard([property('DE-1')],[log('1','DE-1',{taskId:'one',title:'Review bad date',dueDate:'2026-02-30'})],'2026-10-23');
 assert.equal(result.items[0].dateIssue,true);assert.equal(result.items[0].urgency,'unscheduled');
});
test('property search and filters cover the full authorized set including completed records',()=>{
 const records=Array.from({length:150},(_,i)=>property(`DE-${i}`));records[149]={...records[149],status:'Closed',county:'Greenville',address:'149 Synthetic Road, Greenville, SC 29601'};
 assert.equal(model.filterWorkboardProperties(records,{query:'SC 29601',stage:'Closed',county:'Greenville'})[0].id,'DE-149');
 assert.equal(model.filterWorkboardProperties(records,{query:'DE-149',stage:'Underwriting',county:''}).length,0);
});

function reader({size=1001,fail=null,cap=1000,foreign=false,duplicate=false,extras={}}={}) {
 const rows=Array.from({length:size},(_,i)=>({id:`DE-${String(i).padStart(4,'0')}`,property_address:`${i} Synthetic Road`,county:'Pitt',status:'Underwriting'}));
 const logs=[log('1','DE-1000',{taskId:'late',title:'Beyond historical cutoff',dueDate:'2026-10-20',owner:'Carlos'})];let writes=0;const ranges=[];
 const client={from(table){let head=false,first=0,last=0,ids=null;const q={select(_,options){head=Boolean(options?.head);return q},in(key,value){if(key==='lead_id'||key==='deal_id')ids=value;return q},order(){return q},range(a,b){first=a;last=b;ranges.push([table,a,b]);return q},insert(){writes++;throw Error('unexpected mutation')},update(){writes++;throw Error('unexpected mutation')},then(resolve,reject){const selected=table==='deal_leads'?rows:table==='disposition_logs'?logs.filter(item=>ids.includes(item.lead_id)):(extras[table]??[]).filter(item=>ids.includes(item.deal_id));let data=selected.slice(first,Math.min(last+1,first+cap));if(duplicate&&first>0&&table==='deal_leads')data[0]=rows[0];if(foreign&&table==='disposition_logs'&&!head)data=[{...logs[0],lead_id:'foreign'}];return Promise.resolve({data:head?null:data,count:head?selected.length:null,error:fail===table||fail==='later'&&table==='deal_leads'&&first>0?{}:null}).then(resolve,reject)}};return q}};
 return {client,ranges,writes:()=>writes};
}
test('server completes pages and scoped task reads beyond top100, without writes',async()=>{
 const fixture=reader();const result=await server().readPropertyWorkboard(fixture.client,'2026-10-23');assert.equal(result.available,true);assert.equal(result.properties.length,1001);assert.equal(result.items[0].dealId,'DE-1000');assert.equal(fixture.writes(),0);assert.ok(fixture.ranges.some(([table,start])=>table==='deal_leads'&&start===1000));
});
test('late failures, duplicates, oversized sets, foreign rows and reduced row caps never publish partial success',async()=>{
 for(const options of [{fail:'later'},{fail:'disposition_logs'},{fail:'deal_title_checklist_items'},{fail:'deal_closing_timeline_events'},{fail:'deal_emd_trackers'},{fail:'deal_assignment_fee_trackers'},{duplicate:true},{size:5001},{foreign:true},{cap:1}]){
  const fixture=reader(options),result=await server().readPropertyWorkboard(fixture.client,'2026-10-23');assert.equal(result.available,false,JSON.stringify(options));assert.equal(result.items.length,0);assert.equal(result.properties.length,0);assert.match(result.reason,/could not be evaluated/);
 }
});
test('empty successful store is distinguishable from unavailable',async()=>{
 const result=await server().readPropertyWorkboard(reader({size:0}).client,'2026-10-23');assert.equal(result.available,true);assert.equal(result.items.length,0);
});
test('deadlines saved only in title, timeline, deposit and payout tables reach Today with genuine owners',async()=>{
 const extras={
  deal_title_checklist_items:[{id:'t',deal_id:'DE-0000',label:'Confirm vesting',due_date:'2026-10-20',assigned_owner:'Charles',status:'Blocked',notes:'Awaiting source document'}],
  deal_closing_timeline_events:[{id:'e',deal_id:'DE-0000',label:'Attorney deadline',due_date:'2026-10-23',status:'Pending',completed_at:null},{id:'done',deal_id:'DE-0000',label:'Finished',due_date:'2026-10-01',status:'Pending',completed_at:'2026-10-01T12:00:00Z'}],
  deal_emd_trackers:[{deal_id:'DE-0000',emd_due_date:'2026-10-24',emd_holder:'Escrow holder',emd_status:'Not received'}],
  deal_assignment_fee_trackers:[{deal_id:'DE-0000',payout_due_date:'2026-10-25',payout_status:'Awaiting statement'}]
 };
 const result=await server().readPropertyWorkboard(reader({size:1,extras}).client,'2026-10-23');assert.equal(result.available,true);assert.equal(result.items.length,4);
 assert.equal(result.items[0].source,'Title checklist');assert.equal(result.items[0].owner,'Charles');assert.equal(result.items[0].blocker,'Awaiting source document');
 assert.equal(result.items[1].source,'Closing timeline');assert.equal(result.items[2].source,'Deposit tracker');assert.equal(result.items[2].owner,'Unassigned','escrow holder is not an assigned task owner');assert.equal(result.items[3].source,'Payout tracker');
 assert.equal(result.items.some(item=>item.title==='Finished'),false);
});
test('public loader requires existing admin authority before configuration or database access',async()=>{
 let clients=0;const denied=server({requireAdminPage:async()=>{throw Error('denied')},createClient:()=>{clients++;throw Error('unexpected client')}});await assert.rejects(denied.getPropertyWorkboard(),/denied/);assert.equal(clients,0);
});

test('Today retains explicit task owners but does not infer coordination deadline ownership from a title contact',()=>{
 const result=model.buildPropertyWorkboard([property('DE-1')],[log('1','DE-1',{closingDate:'2026-10-23',titleOfficer:'Title contact, not task assignee',closingChecklist:[{id:'assigned',title:'Checklist item',owner:'Charles',status:'Open'}]},'2026-10-22T00:00:00Z','coordination_update')],'2026-10-23');
 assert.equal(result.items.find(item=>item.title==='Review closing deadline').owner,'Unassigned');
 assert.equal(result.items.find(item=>item.title==='Checklist item').owner,'Charles');
});
test('terminal deposit states do not retain old deadline reminders and waiting tracker notes remain visible',async()=>{
 for(const status of ['not_required','released','forfeited']){
  const result=model.buildPropertyWorkboard([property('DE-1')],[],'2026-10-23',[{id:'payment',dealId:'DE-1',title:'Deposit reminder',source:'Deposit tracker',status,dueAt:'2026-01-01'}]);
  assert.equal(result.items.some(item=>item.title==='Deposit reminder'),false,status);
 }
 const extras={deal_emd_trackers:[{deal_id:'DE-0000',emd_due_date:'2026-10-24',emd_status:'pending',emd_notes:'Awaiting receipt from escrow'}],deal_assignment_fee_trackers:[{deal_id:'DE-0000',payout_due_date:'2026-10-25',payout_status:'pending_closing',payout_notes:'Waiting for settlement statement'}]};
 const result=await server().readPropertyWorkboard(reader({size:1,extras}).client,'2026-10-23');
 assert.equal(result.available,true);assert.equal(result.items.find(item=>item.source==='Deposit tracker').blocker,'Awaiting receipt from escrow');
 assert.equal(result.items.find(item=>item.source==='Payout tracker').blocker,'Waiting for settlement statement');
 for(const status of ['Awaiting statement','pending_closing','delayed','Waiting on seller','Blocked','Not received']){
  const item=model.buildPropertyWorkboard([property('DE-1')],[log('x','DE-1',{title:'Waiting test',status,notes:'Actual saved reason'})],'2026-10-23').items[0];
  assert.equal(item.blocker,'Actual saved reason',status);
 }
 const notWaiting=model.buildPropertyWorkboard([property('DE-1')],[log('x','DE-1',{title:'Review',status:'Not waiting',notes:'Internal note'})],'2026-10-23').items[0];
 assert.equal(notWaiting.blocker,null);
});
