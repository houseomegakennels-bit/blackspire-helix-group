import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import http from 'node:http';
import {createPersonalStore} from '../apps/voice/personal.js';
import {createVoiceGateway} from '../apps/voice/gateway.js';
const request=(action,item,extra={})=>({action,item,requestId:crypto.randomUUID(),...extra});
const note=title=>({kind:'memory',title,detail:'user supplied'});
test('personal items isolate both principals and workspaces; duplicate requests are safe',()=>{
 const db=new DatabaseSync(':memory:'),s=createPersonalStore(db);
 const r=request('create',note('Favorite coffee'));const saved=s.mutate('p','w',r);
 assert.deepEqual(s.mutate('p','w',r),saved);assert.equal(s.list('p','w').length,1);
 assert.equal(s.list('other','w').length,0);assert.equal(s.list('p','other').length,0);
 assert.throws(()=>s.mutate('other','w',request('delete',null,{id:saved.id,revision:1})),{status:404});
 assert.throws(()=>s.mutate('p','w',{...r,item:note('Changed request')}),{status:409});
 const update=request('update',note('Decaf'),{id:saved.id,revision:1});s.mutate('p','w',update);
 assert.throws(()=>s.mutate('p','w',request('update',note('Stale'),{id:saved.id,revision:1})),{status:409});
 s.mutate('p','w',request('delete',null,{id:saved.id,revision:2}));assert.equal(s.list('p','w').length,0);
 assert.equal(JSON.stringify(db.prepare('select * from personal_requests').all()).includes('coffee'),false);db.close();
});
test('Today separates overdue, upcoming, completed, and undated items without inventing integrations',()=>{
 const db=new DatabaseSync(':memory:'),now=Date.parse('2026-10-01T11:00:00Z'),s=createPersonalStore(db,{clock:()=>now});
 for(const [title,due]of [['past','2026-10-01T10:00:00Z'],['next','2026-10-01T12:00:00Z'],['later','2026-10-03T12:00:00Z']])s.mutate('p','w',request('create',{kind:'reminder',title,due}));
 const done=s.mutate('p','w',request('create',{kind:'bill',title:'Rent',due:'2026-10-01T09:00:00Z',amountCents:125000}));s.mutate('p','w',request('complete',null,{id:done.id,revision:1}));
 s.mutate('p','w',request('create',{kind:'list',title:'Milk',list:'Groceries'}));
 const t=s.today('p','w');assert.deepEqual(t.overdue.map(x=>x.title),['past']);assert.deepEqual(t.upcoming.map(x=>x.title),['next']);assert.equal(t.unfinished.length,1);assert.equal(t.delivery,'in-app-only');assert.ok(Object.values(t.connections).every(x=>x===false));db.close();
});
test('validation refuses bad dates, arbitrary types and unsupported actions without partial saves',()=>{
 const db=new DatabaseSync(':memory:'),s=createPersonalStore(db);
 for(const item of [{kind:'reminder',title:'Missing date'},{kind:'appointment',title:'Invalid',due:'tomorrow'},{kind:'appointment',title:'Invalid calendar date',due:'2026-02-30T12:00:00Z'},{kind:'permission',title:'admin'},{kind:'bill',title:'Bad',due:'2026-10-01T12:00:00Z',amountCents:NaN}])assert.throws(()=>s.mutate('p','w',request('create',item)),{status:400});
 assert.equal(s.list('p','w').length,0);assert.equal(db.prepare('select count(*) n from personal_requests').get().n,0);db.close();
});
test('organizer endpoint requires real session, workspace membership, CSRF, origin and readiness',async()=>{
 let stopped=false;
 const g=createVoiceGateway({dbPath:':memory:',fetchImpl:async(url,options)=>{
  const who=options.headers.cookie;return Response.json(url.endsWith('/session')?{authenticated:['p','q'].includes(who),principalId:who,csrfToken:'csrf'}:url.endsWith('/workspaces')?{workspaces:[{id:'w'}]}:url.endsWith('/health')?{ok:true,emergencyStop:stopped}:{ok:true,checks:{ok:true}});
 }});
 const server=http.createServer(g.handler);server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const url='http://127.0.0.1:'+server.address().port+'/api/voice/personal';
 const headers={cookie:'p',origin:'https://command.blackspirehelix.com','x-csrf-token':'csrf'};
 const post=(body,h=headers)=>fetch(url,{method:'POST',headers:h,body:JSON.stringify({workspaceId:'w',...body})});
 try{
 assert.equal((await fetch(url+'?workspaceId=w')).status,401);
 assert.equal((await fetch(url+'?workspaceId=other',{headers})).status,404);
 assert.equal((await post(request('create',note('a')),{...headers,'x-csrf-token':'bad'})).status,403);
 assert.equal((await post(request('create',note('a')),{...headers,origin:'https://elsewhere.example'})).status,403);
 stopped=true;assert.equal((await post(request('create',note('a')))).status,503);stopped=false;
 const saved=await post(request('create',note('Private note')));assert.equal(saved.status,200);
 const other=await (await fetch(url+'?workspaceId=w',{headers:{...headers,cookie:'q'}})).json();assert.equal(other.items.length,0);
 const own=await (await fetch(url+'?workspaceId=w',{headers})).json();assert.equal(own.items.length,1);
 assert.equal((await fetch(url+'?workspaceId=w',{method:'DELETE',headers})).status,404);
 }finally{await g.close();await new Promise(r=>server.close(r));}
});
