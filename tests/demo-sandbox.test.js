import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const src=fs.readFileSync('frontend/src/lib/demo-sandbox.ts','utf8');
const {seedDemoState,applyDemoAction,analyzeDemoDeal}=vm.runInNewContext(stripTypeScriptTypes(src.replace(/^export /gm,''))+'\n({seedDemoState,applyDemoAction,analyzeDemoDeal})',{structuredClone});
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
