import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync('apps/jarvis-pwa/public/jarvis.js','utf8').split('/* Explicit voice conversation session.')[1].split('function renderConversation()')[0];
function harness(){const elements={};let rec;const sent=[];const spoken=[];
class Recognition {constructor(){rec=this;}start(){this.onstart();}abort(){}}
const context={store:{conversation:{messages:[],tasks:[]},tasks:[],conversationId:'conv'},document:{hidden:false},navigator:{language:'en-US'},window:{SpeechRecognition:Recognition,speechSynthesis:{} ,SpeechSynthesisUtterance:function(){}},SpeechSynthesisUtterance:class {constructor(text){this.text=text;}},speechSynthesis:{getVoices:()=>[],speak:u=>spoken.push(u),cancel(){}},setTimeout:fn=>{context.next=fn;return 1;},clearTimeout(){},byId:id=>elements[id]||=( {textContent:'',hidden:false,dataset:{},showModal(){},close(){}}),stopVoice(){},canonicalTaskStatus:t=>t.status,taskConversationResponse:t=>t.canonicalResult,submitCommand:async(...args)=>{sent.push(args);return {taskId:'task1'};}};
vm.createContext(context);vm.runInContext('/* Explicit voice conversation session.'+source,context);return {context,elements,sent,spoken,get rec(){return rec;}};}
test('context is bounded to this conversation and current message survives',()=>{const h=harness();h.context.store.conversation.messages=Array.from({length:12},(_,i)=>({id:String(i),text:'x'.repeat(1500)}));const request=h.context.conversationRequest('What did I ask?');assert.ok(request.length<4000);assert.equal(h.context.conversationText(request),'What did I ask?');});

test('typed follow-ups include previous completed answer and preserve long input',()=>{const h=harness();h.context.store.conversation.messages=[{id:'m1',text:'17 plus 25?'}];h.context.store.conversation.tasks=[{input_id:'m1',status:'completed',canonicalResult:'42'}];const packet=JSON.parse(h.context.conversationRequest('What was the result?').split('\n').slice(1).join('\n'));assert.equal(packet.history[1].text,'42');assert.equal(packet.currentMessage,'What was the result?');const long='x'.repeat(3900);assert.equal(h.context.conversationRequest(long),long);const full=fs.readFileSync('apps/jarvis-pwa/public/jarvis.js','utf8');assert.ok(full.includes("submitCommand(conversationRequest(byId('followCmd').value, byId('followExecutionIntent').value), store.conversationId"));});

test('short conversation retains twelve turns and trims complete pairs under pressure',()=>{
 const h=harness();
 assert.equal(h.context.conversationRequest('   '),'   ');
 assert.equal(h.context.conversationRequest('Write a note','workspace_mutation'),'Write a note');
 h.context.store.conversation.messages=Array.from({length:15},(_,i)=>({id:String(i),text:'Question '+i}));
 h.context.store.conversation.tasks=Array.from({length:15},(_,i)=>({input_id:String(i),status:'completed',canonicalResult:'Answer '+i}));
 const read=text=>JSON.parse(h.context.conversationRequest(text).split('\n').slice(1).join('\n'));
 let packet=read('Remember our earlier conversation');
 assert.equal(packet.history.length,24);
 assert.equal(packet.history[0].text,'Question 3');
 h.context.store.conversation.messages.forEach(m=>m.text+=' x'.repeat(200));
 h.context.store.conversation.tasks.forEach(t=>t.canonicalResult+=' y'.repeat(300));
 packet=read('Continue');
 assert.ok(packet.history.length<24);
 for(let i=0;i<packet.history.length;i+=2){
  assert.equal(packet.history[i].role,'user');
  assert.equal(packet.history[i+1].role,'assistant');
 }
 assert.ok(h.context.conversationRequest('Continue').length<=3900);
 h.context.store.conversation={messages:[],tasks:[]};
 assert.equal(read('New conversation').history.length,0);
});
