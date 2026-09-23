import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {OWNED_SIX_READ as fixed,ownedSixReadConfigMatches,transformOwnedSixReadSource,assertOwnedSixReadStart,assertOwnedSixReadSource} from '../packages/zola-release/owned-six-read-overlay.js';
import {load} from '../packages/zola-release/owned-six-read-loader.js';
const source=fs.readFileSync(new URL('../packages/zola-release/premerge-read-permit.js',import.meta.url),'utf8');
const context=()=>({release:{schema:3,releaseSha:fixed.releaseSha,operationId:fixed.operationId,backendProfile:'owned-postgres-v1',profileDigest:fixed.profileDigest},input:{releaseSha:fixed.releaseSha}});
const config=()=>({version:6,backendProfile:'owned-postgres-v1',profileDigest:fixed.profileDigest});
test('exact owned version6 binding, legacy4 and all wrong profile/version/backend combinations',()=>{
 assert.equal(ownedSixReadConfigMatches(config(),context()),true);
 assert.equal(ownedSixReadConfigMatches({version:4},{release:{},input:{}}),true);
 for(const [c,x] of [[{...config(),version:4},context()],[{...config(),version:7},context()],[{...config(),profileDigest:'0'.repeat(64)},context()],[config(),{...context(),release:{...context().release,backendProfile:'other'}}],[config(),{...context(),release:{...context().release,profileDigest:'0'.repeat(64)}}],[config(),{...context(),release:{...context().release,schema:2}}],[config(),{...context(),release:{...context().release,operationId:'foreign'}}],[config(),{...context(),input:{releaseSha:'foreign'}}],[{version:4,backendProfile:'owned-postgres-v1'},{release:{},input:{}}]])assert.equal(ownedSixReadConfigMatches(c,x),false);
});
test('source transformation refuses drift and preserves original checks with explicit renewal before first permit',()=>{
 const output=transformOwnedSixReadSource(source),start=output.indexOf("import fs from 'node:fs';");
 assert.equal(output.slice(start),source.replace('config.version!==4','!ownedSixReadConfigMatches(config,context)').replace('  lease=acquire({root,exclusive:true,owner:0,groupId});','  if(config.version===6)selectRenewalReceipt(config);\n  lease=acquire({root,exclusive:true,owner:0,groupId});'));
 for(const s of [source+' ',source.replace('config.version!==4','true'),''])assert.throws(()=>transformOwnedSixReadSource(s));
 assert.match(output,/configDigest:hash\(config\)/);
});
test('loader intercepts only exact canonical URL and rejects incompatible format',async()=>{
 const next=async()=>({format:'module',source});const target='file://'+fixed.canonicalRoot+'/packages/zola-release/premerge-read-permit.js';
 assert.equal((await load(target,{},next)).source,transformOwnedSixReadSource(source));
 assert.equal((await load('file://'+fixed.frozenRoot+'/packages/zola-release/premerge-read-permit.js',{},next)).source,source);
 await assert.rejects(load(target,{},async()=>({format:'commonjs',source})));
});
const fixture=()=>{
 const stages=Array.from({length:34},(_,i)=>'stage'+i);stages[8]='n8n_migration';stages[13]='six_reads';
 return {state:{started:true,context:{releaseSha:fixed.releaseSha,operationId:fixed.operationId},nextOrdinal:13,pending:{stage:'six_reads',operationId:fixed.operationId},outputs:{n8n_migration:{stage:'n8n_migration'}}},stages,n8nEvents:[{type:'intent',operationId:fixed.operationId,releaseSha:fixed.releaseSha,operation:'update',stageAttemptId:'a'},{type:'confirmed',operationId:fixed.operationId,releaseSha:fixed.releaseSha,operation:'update',stageAttemptId:'a'}]};
};
test('start accepts current and later native stages and refuses reentry/unconfirmed n8n',()=>{
 assert.equal(assertOwnedSixReadStart(fixture()),true);const later=fixture();later.state.nextOrdinal=23;later.state.pending=null;assert.equal(assertOwnedSixReadStart(later),true);
 for(const mutate of [v=>v.state.nextOrdinal=8,v=>v.state.nextOrdinal=35,v=>delete v.state.outputs.n8n_migration,v=>v.state.context.operationId='foreign',v=>v.state.pending.stage='n8n_migration',v=>v.n8nEvents.pop(),v=>v.n8nEvents[1].stageAttemptId='foreign',v=>v.n8nEvents[0].releaseSha='foreign']){const v=fixture();mutate(v);assert.throws(()=>assertOwnedSixReadStart(v));}
});
test('source guard rejects frozen SHA/path/dirty and non-descendant wrapper identities',()=>{
 const v={wrapperRoot:'/mnt/blackspire-builds/development-cache/0/workspaces/zola-owned-denial-renewal-20260923',frozenRoot:fixed.frozenRoot,frozenSha:fixed.frozenSha,wrapperClean:true,frozenClean:true,ancestor:true,wrapperSha:'a'.repeat(40)};
 assert.equal(assertOwnedSixReadSource(v),true);
 for(const change of [{frozenSha:'b'.repeat(40)},{frozenRoot:'/tmp/foreign'},{wrapperRoot:'/tmp/foreign'},{wrapperClean:false},{frozenClean:false},{ancestor:false},{wrapperSha:fixed.frozenSha}])assert.throws(()=>assertOwnedSixReadSource({...v,...change}));
});
