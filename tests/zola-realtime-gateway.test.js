import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createVoiceGateway} from '../apps/voice/gateway.js';
let now=Date.now(), revoked=false, stopped=false, paid=0, hangups=0;
const cookie='test-session',csrf='test-csrf', origin='https://command.blackspirehelix.com';
const gateway=createVoiceGateway({dbPath:':memory:',checkpoints:{source:'fixture',projects:[{id:'visible',workspaceId:'a'},{id:'private-b',workspaceId:'b'}]},apiKey:'mock-key-not-real',clock:()=>now,sessionMs:1000,dailySessions:2,fetchImpl:async(url,options)=>{
  if(url.startsWith('https://api.openai.com/')){
    if(url.endsWith('/hangup')){hangups++;return new Response('',{status:200});}
    paid++;assert.equal(options.body.get('session').includes('ask_workspace'),true);
    assert.equal(options.body.get('session').includes('mock-key'),false);
    return new Response('v=0\r\nanswer',{status:201,headers:{location:'/v1/realtime/calls/rtc_mock'+paid}});
  }
  assert.equal(options.headers.cookie,cookie);
  const data=url.endsWith('/api/auth/session')?{authenticated:!revoked,principalId:'owner',csrfToken:csrf}:
    url.endsWith('/api/workspaces')?{workspaces:[{id:'a'}]}:
    url.endsWith('/health')?{ok:true,emergencyStop:stopped}:{ok:true,checks:{a:true}};
  return Response.json(data);
}});
const server=http.createServer(gateway.handler);server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
const base='http://127.0.0.1:'+server.address().port;
const post=(route,body={},headers={})=>fetch(base+'/api/voice/'+route,{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf,'content-type':'application/json',...headers},body:JSON.stringify({workspaceId:'a',...body})});
test.after(async()=>{await gateway.close();await new Promise(r=>server.close(r));});
test('voice authorization, quotas, transcripts, revocation and server termination',async()=>{
  assert.equal((await post('session',{sdp:'v=0'},{origin:'https://evil.example'})).status,403);
  assert.equal((await post('session',{sdp:'v=0'},{'x-csrf-token':'wrong'})).status,403);
  assert.equal((await post('session',{workspaceId:'b',sdp:'v=0'})).status,404);
  stopped=true;assert.equal((await post('session',{sdp:'v=0'})).status,503);stopped=false;
  assert.equal(paid,0);
  const projects=await (await fetch(base+'/api/zola/projects?workspaceId=a',{headers:{cookie}})).json();
  assert.deepEqual(projects.projects.map(p=>p.id),['visible']);
  assert.equal((await fetch(base+'/api/zola/projects?workspaceId=b',{headers:{cookie}})).status,404);
  const started=await post('session',{sdp:'v=0'});assert.equal(started.status,200);
  const session=await started.json();assert.ok(session.id);assert.equal(session.sdp,'v=0\r\nanswer');assert.equal('key' in session,false);
  assert.equal((await post('session',{sdp:'v=0'})).status,409);assert.equal(paid,1);
  assert.equal((await post('transcript',{id:session.id,turns:[{role:'system',text:'bad'}]})).status,400);
  assert.equal((await post('transcript',{id:session.id,turns:[{role:'user',text:'Hello'},{role:'assistant',text:'Hi'}]})).status,200);
  const history=await (await fetch(base+'/api/voice/transcripts?workspaceId=a',{headers:{cookie}})).json();
  assert.equal(history.transcripts[0].verified,false);assert.equal(history.transcripts[0].transcript[1].text,'Hi');
  assert.equal((await post('end',{workspaceId:'b',id:session.id})).status,404);
  now+=1100;await gateway.reconcile();assert.equal(hangups,1);
  assert.equal((await post('session',{sdp:'v=0'})).status,200);
  revoked=true;await gateway.reconcile();assert.equal(hangups,2);
  assert.equal((await post('session',{sdp:'v=0'})).status,401);revoked=false;
  assert.equal((await post('session',{sdp:'v=0'})).status,429);assert.equal(paid,2);
});
test('unconfirmed upstream create remains blocked rather than retrying paid sessions',async()=>{
 const g=createVoiceGateway({dbPath:':memory:',apiKey:'test',fetchImpl:async(url)=>{
   if(url.startsWith('https://'))throw Error('network uncertain');
   return Response.json(url.endsWith('session')?{authenticated:true,principalId:'owner',csrfToken:csrf}:url.endsWith('workspaces')?{workspaces:[{id:'a'}]}:url.endsWith('health')?{ok:true,emergencyStop:false}:{ok:true,checks:{a:true}});
 }});
 const s=http.createServer(g.handler);s.listen(0,'127.0.0.1');await new Promise(r=>s.once('listening',r));
 const send=()=>fetch('http://127.0.0.1:'+s.address().port+'/api/voice/session',{method:'POST',headers:{origin,cookie,'x-csrf-token':csrf},body:JSON.stringify({workspaceId:'a',sdp:'v=0'})});
 assert.equal((await send()).status,503);assert.equal((await send()).status,409);
 await g.close();await new Promise(r=>s.close(r));
});
