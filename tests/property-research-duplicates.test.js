import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';

const source=fs.readFileSync('frontend/src/components/property-research-workbench.tsx','utf8');
const handlers=source.slice(source.indexOf('  function setResearch('),source.indexOf('  let preview;'));
const plain=path=>stripTypeScriptTypes(fs.readFileSync(path,'utf8').replace(/^import .*;\n/gm,'')).replaceAll('export ','');
const investment=vm.runInNewContext(plain('frontend/src/lib/investment-analysis.ts')+'\n({analyzeInvestment,parseInvestmentAmount})');
const {emptyPropertyResearch,validatePropertyResearch}=vm.runInNewContext(plain('frontend/src/lib/property-research.ts')+'\n({emptyPropertyResearch,validatePropertyResearch})',{...investment,URL,Intl,Error});
const clone=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject};}
function editor({initialIds=[],read,write}={}){
 const initial={...emptyPropertyResearch(),duplicateReview:{candidateIds:initialIds,decision:'not_reviewed',notes:''}};
 let draft=initial,text=initialIds.join(', '),baseline=JSON.stringify(initial),revision=3,message;
 let stored={revision:3,research:clone(initial)},loads=0;
 const saves=[];
 const currentDraftRef={current:draft},revisionRef={current:revision},operationRef={current:null},duplicateIdsTextRef={current:text};
 const saveState={pending:false,get dirty(){return JSON.stringify(currentDraftRef.current)!==baseline},begin(){return JSON.stringify(currentDraftRef.current)},succeed(value){baseline=value},fail(){},load(value){baseline=JSON.stringify(value)}};
 const transport={
  async load(){loads++;return read?read.promise:clone(stored)},
  async save(expectedRevision,research){saves.push({expectedRevision,research:clone(research)});if(write)return write.promise;assert.equal(expectedRevision,stored.revision);stored={revision:expectedRevision+1,research:clone(research)};return clone(stored)}
 };
 const context={currentDraftRef,revisionRef,operationRef,duplicateIdsTextRef,saveState,transport,JSON,Error,validatePropertyResearch,
  window:{confirm:()=>true},setResearchState:value=>{draft=value},setDuplicateIdsText:value=>{text=value},setRevision:value=>{revision=value},setMessage:value=>{message=value},setReloading(){}
 };
 const actions=vm.runInNewContext(stripTypeScriptTypes(handlers)+'\n({updateDuplicateCandidateIds,save,reload})',context);
 return {...actions,type(characters){for(const character of characters)actions.updateDuplicateCandidateIds(text+character)},
  state:()=>({text,draft,revision,message,baseline,dirty:saveState.dirty,saves,loads,operation:operationRef.current})};
}

test('controlled duplicate input retains each typed comma and space and saves distinct IDs',async()=>{
 // These are the production control bindings, not a test-only text-field implementation.
 assert.match(source,/value=\{duplicateIdsText\} onChange=\{event => updateDuplicateCandidateIds\(event.target.value\)\}/);
 const e=editor();
 e.type('DE-0002');e.type(',');assert.equal(e.state().text,'DE-0002,');
 e.type(' ');assert.equal(e.state().text,'DE-0002, ');
 e.type('DE-0003,  ');
 assert.equal(e.state().text,'DE-0002, DE-0003,  ');
 assert.equal(JSON.stringify(e.state().draft.duplicateReview.candidateIds),JSON.stringify(['DE-0002','DE-0003']));
 await e.save();
 assert.equal(e.state().saves[0].expectedRevision,3);
 assert.deepEqual(e.state().saves[0].research.duplicateReview.candidateIds,['DE-0002','DE-0003']);
 assert.equal(e.state().revision,4);assert.equal(e.state().dirty,false);
 assert.equal(e.state().text,'DE-0002, DE-0003,  ','save acknowledgment must not replace the raw editing buffer');
 await e.reload();
 assert.equal(e.state().text,'DE-0002, DE-0003','explicit accepted reload uses persisted IDs');
 assert.deepEqual(e.state().draft.duplicateReview.candidateIds,['DE-0002','DE-0003']);
});

test('empty separators are normalized only in the saved candidate array',async()=>{
 const e=editor();e.type(', , DE-0002,, DE-0003,');
 assert.equal(e.state().text,', , DE-0002,, DE-0003,');
 await e.save();
 assert.deepEqual(e.state().saves[0].research.duplicateReview.candidateIds,['DE-0002','DE-0003']);
});

test('typing only a separator during reload prevents stale replacement although parsed IDs are unchanged',async()=>{
 const read=deferred(),e=editor({initialIds:['DE-0002'],read});
 const loading=e.reload();e.type(', ');
 read.resolve({revision:4,research:{...emptyPropertyResearch(),duplicateReview:{candidateIds:['DE-0099'],decision:'not_reviewed',notes:''}}});
 await loading;
 assert.equal(e.state().text,'DE-0002, ');
 assert.equal(JSON.stringify(e.state().draft.duplicateReview.candidateIds),JSON.stringify(['DE-0002']));
 assert.equal(e.state().revision,3);assert.match(e.state().message,/newer draft is preserved/);
});

test('IDs typed during a pending save remain raw and unsaved while CAS acknowledges only the submitted snapshot',async()=>{
 const write=deferred(),e=editor({write});e.type('DE-0002, ');
 const saving=e.save();e.type('DE-0003, ');
 write.resolve({revision:4,research:e.state().saves[0].research});await saving;
 assert.deepEqual(e.state().saves[0].research.duplicateReview.candidateIds,['DE-0002']);
 assert.equal(e.state().text,'DE-0002, DE-0003, ');
 assert.equal(JSON.stringify(e.state().draft.duplicateReview.candidateIds),JSON.stringify(['DE-0002','DE-0003']));
 assert.equal(e.state().revision,4);assert.equal(e.state().dirty,true);assert.equal(e.state().operation,null);
});

test('real research validation rejects too many duplicate IDs before any write and preserves typed text',async()=>{
 const e=editor(),raw=Array.from({length:21},(_,i)=>'DE-'+String(i+1).padStart(4,'0')).join(', ')+', ';
 e.type(raw);await e.save();
 assert.equal(e.state().saves.length,0);assert.equal(e.state().revision,3);
 assert.equal(e.state().text,raw);assert.equal(e.state().dirty,true);assert.match(e.state().message,/Too many research rows/);
});

test('failed reload preserves the raw separator buffer',async()=>{
 const read=deferred(),e=editor({initialIds:['DE-0002'],read});e.type(', ');
 const loading=e.reload();read.reject(new Error('synthetic offline'));await loading;
 assert.equal(e.state().text,'DE-0002, ');assert.equal(e.state().revision,3);assert.match(e.state().message,/synthetic offline/);
});
