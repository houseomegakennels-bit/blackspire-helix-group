import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const src=fs.readFileSync('frontend/src/lib/demo-sandbox.ts','utf8');
const shared=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/investment-analysis.ts','utf8').replace(/^export /gm,''))+'\n({analyzeInvestment,parseInvestmentAmount})');
const {seedDemoState,applyDemoAction,analyzeDemoDeal}=vm.runInNewContext(stripTypeScriptTypes(src.replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''))+'\n({seedDemoState,applyDemoAction,analyzeDemoDeal})',{structuredClone,...shared});
test('practice pipeline persists analysis stages and follow-ups without mutating input',()=>{
 const seed=seedDemoState();const changed=applyDemoAction(seed,{action:'runPipeline',id:'example-property'},'task');
 assert.equal(seed.leads[0].stage,'Intake');assert.equal(changed.leads[0].stage,'Analyzing');assert.equal(changed.tasks.length,2);assert.equal(analyzeDemoDeal(changed.leads[0]).mao,117000);
 const next=applyDemoAction(changed,{action:'updateLead',id:'example-property',asking:100000,arv:210000,repairs:30000,stage:'Qualified',note:'Checked'},'unused');
 assert.equal(applyDemoAction(next,{action:'runPipeline',id:'example-property'},'task2').leads[0].stage,'Buyer matching');
});
test('client cannot name a record outside its own loaded state or submit invalid amounts',()=>{
 assert.throws(()=>applyDemoAction(seedDemoState(),{action:'updateLead',id:'someone-elses-record'},'x'));
 assert.throws(()=>applyDemoAction(seedDemoState(),{action:'addLead',name:'x',city:'x',asking:-1,arv:10,repairs:0},'x'));
 assert.throws(()=>applyDemoAction(seedDemoState(),{action:'sendEmail'},'x'));
});
test('workspace route denies inactive roles before any storage access',async()=>{
 const code=stripTypeScriptTypes(fs.readFileSync('frontend/src/app/api/demo/workspace/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''));
 for(const c of [{role:'anonymous'},{role:'demo_viewer',operatorId:'a',expired:false},{role:'demo_operator',operatorId:'a',expired:true}]){
 const routes=vm.runInNewContext(code+'\n({GET,POST})',{getOperatorContext:async()=>c,createAdminSupabaseAuthClient:()=>{throw Error('storage reached')},NextResponse:{json:(body,opt)=>({body,status:opt?.status??200})}});
 assert.equal((await routes.GET()).status,403);assert.equal((await routes.POST({})).status,403);
 }
});
test('saved workspace mutations use authenticated owner and reject stale revisions',async()=>{
 const code=stripTypeScriptTypes(fs.readFileSync('frontend/src/app/api/demo/workspace/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''));
 const filters=[];let writes=0;
 const db={from:table=>{assert.equal(table,'demo_workspaces');const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},single:async()=>({data:{state:seedDemoState(),revision:2}}),update:()=>{writes++;return q;},maybeSingle:async()=>({data:{state:seedDemoState(),revision:3}})};return q;}};
 const routes=vm.runInNewContext(code+'\n({POST})',{getOperatorContext:async()=>({role:'demo_operator',operatorId:'owner-a',expired:false}),createAdminSupabaseAuthClient:()=>db,applyDemoAction,randomUUID:()=> 'generated',NextResponse:{json:(body,opt)=>({body,status:opt?.status??200})}});
 const request=revision=>({headers:{get:()=> 'https://demo.example'},nextUrl:{origin:'https://demo.example'},text:async()=>JSON.stringify({revision,action:'addTask',text:'check',user_id:'owner-b'})});
 assert.equal((await routes.POST(request(1))).status,409);assert.equal(writes,0);
 assert.equal((await routes.POST(request(2))).status,200);assert.equal(writes,1);
 assert.ok(filters.filter(x=>x[0]==='user_id').every(x=>x[1]==='owner-a'));
 assert.ok(filters.some(x=>x[0]==='revision'&&x[1]===2));
});

test('unknown figures can be saved and explicit zero survives editing',()=>{
 const added=applyDemoAction(seedDemoState(),{action:'addLead',name:'Incomplete house',city:'Winston-Salem',asking:''},'new-house');
 const lead=added.leads.at(-1);assert.equal(lead.asking,null);assert.equal(lead.repairs,null);assert.equal(analyzeDemoDeal(lead).complete,false);
 const edited=applyDemoAction(added,{action:'updateLead',id:lead.id,repairs:'0',researchNotes:'Seller says no repairs',researchSource:'Seller conversation',researchAsOf:'2026-10-08'},'unused').leads.at(-1);
 assert.equal(edited.repairs,0);assert.equal(edited.asking,null);assert.equal(edited.researchSource,'Seller conversation');
});
test('pipeline avoids duplicate open tasks and preserves transaction stage',()=>{
 let state=applyDemoAction(seedDemoState(),{action:'runPipeline',id:'example-property'},'task-one');
 const count=state.tasks.length;
 state=applyDemoAction(state,{action:'runPipeline',id:'example-property'},'task-two');assert.equal(state.tasks.length,count);
 for(const stage of ['Under contract','Closed']) {
  const updated=applyDemoAction(state,{action:'updateLead',id:'example-property',stage,arv:''},'unused');
  assert.equal(applyDemoAction(updated,{action:'runPipeline',id:'example-property'},'task-three').leads[0].stage,stage);
 }
});
test('strategy changes preserve independent figures and research, without rewriting sample assumptions',()=>{
 const source=seedDemoState();
 const rental=applyDemoAction(source,{action:'updateLead',id:'example-property',strategy:'rental',monthlyRent:1500,monthlyExpenses:400,monthlyDebtService:700,researchNotes:'Source noted'},'unused');
 assert.equal(rental.leads[0].arv,210000);assert.equal(analyzeDemoDeal(rental.leads[0]).monthlyCashFlow,400);
 const flipped=applyDemoAction(rental,{action:'updateLead',id:'example-property',strategy:'flip'},'unused');
 assert.equal(flipped.leads[0].monthlyRent,1500);assert.equal(flipped.leads[0].researchNotes,'Source noted');assert.equal(source.leads[0].strategy,'assignment');
});
test('legacy records retain old reserve until migrated, while new unknown costs remain incomplete',()=>{
 const legacy={id:'old',name:'old',city:'old',asking:125000,arv:210000,repairs:30000,stage:'Intake',note:''};
 assert.equal(analyzeDemoDeal(legacy).mao,117000);assert.equal(analyzeDemoDeal(legacy).legacy,true);
 assert.equal(analyzeDemoDeal({...legacy,strategy:'flip'}).complete,false);
});
test('follow-ups cannot be attached to an unowned property',()=>{
 assert.throws(()=>applyDemoAction(seedDemoState(),{action:'addTask',text:'Contact',leadId:'foreign'},'task'));
});
test('cross-origin writes stop before storage and raced saves return 409',async()=>{
 const code=stripTypeScriptTypes(fs.readFileSync('frontend/src/app/api/demo/workspace/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,''));
 let reached=0;
 const db={from:()=>{reached++;const q={select:()=>q,eq:()=>q,single:async()=>({data:{state:seedDemoState(),revision:2}}),update:()=>q,maybeSingle:async()=>({data:null})};return q;}};
 const routes=vm.runInNewContext(code+'\n({POST})',{getOperatorContext:async()=>({role:'demo_operator',operatorId:'owner-a',expired:false}),createAdminSupabaseAuthClient:()=>db,applyDemoAction,randomUUID:()=> 'generated',NextResponse:{json:(body,opt)=>({body,status:opt?.status??200})}});
 const request=origin=>({headers:{get:()=>origin},nextUrl:{origin:'https://demo.example'},text:async()=>JSON.stringify({revision:2,action:'addTask',text:'check'})});
 assert.equal((await routes.POST(request('https://foreign.example'))).status,403);assert.equal(reached,0);
 assert.equal((await routes.POST(request('https://demo.example'))).status,409);
});
