import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync('apps/jarvis-pwa/public/jarvis.js','utf8');
test('project summaries isolate workspaces and preserve unknown outcomes and missing data',()=>{
 const context={canonicalTaskStatus:t=>t.providerAttribution?.some(a=>a.status==='outcome_unknown')?'outcome_unknown':t.status,conversationText:t=>t,statusInfo:t=>({label:t.status}),Date};
 vm.createContext(context);
 vm.runInContext(js.split('/* Project summaries are derived only from currently authorized records. */')[1].split('/* End project summaries. */')[0],context);
 const rows=context.summarizeProjects([{id:'a',name:'A'},{id:'empty',name:'Empty'}],[
 {id:'1',workspace_id:'a',request:'Check progress',status:'completed',created_at:'2026-09-30T10:00:00Z'},
 {id:'2',workspace_id:'a',request:'Uncertain change',status:'completed',providerAttribution:[{status:'outcome_unknown'}],created_at:'2026-09-30T11:00:00Z'},
 {id:'3',workspace_id:'b',request:'PRIVATE B',status:'failed'}]);
 assert.equal(rows[0].status,'Needs attention');assert.match(rows[0].next,/Verify outcome/);
 assert.equal(rows[1].status,'No activity available');assert.match(rows[1].blockers,/not verified/);
 assert.equal(JSON.stringify(rows).includes('PRIVATE B'),false);
});
function harness(){
 let trackStopped=0,pcClosed=0,requests=[],statuses=[],transcripts=[];
 class Audio {setAttribute(){}play(){return Promise.resolve();}pause(){}}
 class Peer {
 constructor(){this.connectionState='connected';}
 createDataChannel(){this.channel={readyState:'open',send:x=>requests.push(JSON.parse(x)),close(){}};return this.channel;}
 addTrack(){} async createOffer(){return {sdp:'v=0'};}async setLocalDescription(){}async setRemoteDescription(){}close(){pcClosed++;}
 }
 const track={enabled:true,stop(){trackStopped++;}};
 const stream={getTracks:()=>[track],getAudioTracks:()=>[track]};
 const context={navigator:{mediaDevices:{}},RTCPeerConnection:Peer,Audio,Date,setTimeout:()=>1,clearTimeout,console};
 vm.createContext(context);vm.runInContext(js.split('/* Realtime voice controller. No browser speech synthesis or dictation fallback. */')[1].split('/* End realtime voice controller. */')[0]+'\nglobalThis.Controller=ZolaRealtimeVoice;',context);
 const controller=new context.Controller({workspace:'a',media:{getUserMedia:async()=>stream},Peer,AudioClass:Audio,request:async(path,payload)=>{
 requests.push({path,payload});if(path.includes('/status'))return {enabled:true};
 if(path.endsWith('/session'))return {id:'voice1',sdp:'answer',expiresAt:Date.now()+1000};
 if(path.endsWith('/end'))return {closed:true};return {saved:true};
 },ask:async q=>'Verified: '+q,status:(...v)=>statuses.push(v),transcript:t=>transcripts.push(JSON.stringify(t))});
 return {controller,requests,statuses,transcripts,track,get stopped(){return trackStopped;},get closed(){return pcClosed;}};
}
test('real voice negotiates audio, retains both transcript sides, delegates reads, and closes the microphone',async()=>{
 const h=harness();await h.controller.start();
 assert.ok(h.requests.some(x=>x.path==='/api/voice/session'));
 h.controller.event({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Hello'});
 h.controller.event({type:'conversation.item.input_audio_transcription.completed',item_id:'u1',transcript:'Duplicate'});
 h.controller.event({type:'response.output_audio_transcript.done',item_id:'a1',transcript:'Hi Los'});
 assert.equal(h.controller.turns.length,2);
 await h.controller.tool({name:'ask_workspace',call_id:'c1',arguments:'{"question":"Project status?"}'});
 assert.ok(h.requests.some(x=>x.type==='conversation.item.create'&&x.item.output==='Verified: Project status?'));
 h.controller.interrupt();assert.ok(h.requests.some(x=>x.type==='response.cancel'));assert.ok(h.requests.some(x=>x.type==='output_audio_buffer.clear'));
 assert.equal(h.controller.mute(),true);assert.equal(h.track.enabled,false);
 await h.controller.stop();assert.equal(h.stopped,1);assert.equal(h.closed,1);assert.ok(h.requests.some(x=>x.path==='/api/voice/end'));
});
test('ending during microphone permission request closes a late stream and never starts a paid session',async()=>{
 const h=harness();let resolve;
 h.controller.media={getUserMedia:()=>new Promise(r=>{resolve=r;})};
 const started=h.controller.start();
 for(let i=0;i<8&&!resolve;i++)await Promise.resolve();
 await h.controller.stop();let stopped=false;
 resolve({getTracks:()=>[{stop(){stopped=true;}}]});await started;
 assert.equal(stopped,true);assert.equal(h.requests.some(x=>x.path==='/api/voice/session'),false);
});
