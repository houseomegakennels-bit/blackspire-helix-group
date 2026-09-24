import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {createBuyerStoreIdentityPreparer} from '../packages/buyer-store/initial-host.js';
import {createBuyerStoreProtectedFiles} from '../packages/buyer-store/protected-files.js';
import {prepareBuyerStoreVerifier,BUYER_STORE_PUBLIC_KEY_INPUT} from '../packages/buyer-store/verifier-preparation.js';
import {provisionBuyerStorePasswords} from '../packages/buyer-store/password-provision.js';
test('fixed identity setup retains IDs, never repeats commands, and refuses foreign memberships',async()=>{
 const records=new Map(),groups=new Map(),commands=[];let user=false,foreign=false;
 const files={directory(){},value:(file)=>records.get(file)??null,record:(file,value)=>{if(records.has(file))assert.deepEqual(records.get(file),value);records.set(file,value);}};
 const run=(file,args)=>{if(file==='/usr/bin/getent'){const name=args[1];if(args[0]==='group')return groups.has(name)?name+':x:'+groups.get(name)+':':null;return user?'blackspire-buyer-store:x:62000:61000::/nonexistent:/usr/sbin/nologin':null;}
  if(file==='/usr/sbin/groupadd'){commands.push(args);groups.set(args[1],61000+groups.size);return '';}
  if(file==='/usr/sbin/useradd'){commands.push(args);user=true;return '';}
  if(file==='/usr/bin/id')return args[1]==='blackspire-buyer-store'?'61000':foreign?'61000':'1000';throw new Error('unexpected command');};
 const prepare=createBuyerStoreIdentityPreparer({files,run,root:'/fixture'});await prepare();await prepare();assert.equal(commands.length,3);foreign=true;await assert.rejects(prepare());assert.equal(commands.length,3);
});
test('uncertain absent identity creation refuses command redispatch',async()=>{
 const records=new Map();let calls=0;const files={directory(){},value:f=>records.get(f)??null,record:(f,v)=>records.set(f,v)};
 const run=(file)=>{if(file==='/usr/bin/getent')return null;calls++;throw new Error('synthetic lost acknowledgement');};
 const prepare=createBuyerStoreIdentityPreparer({files,run,root:'/fixture'});await assert.rejects(prepare());await assert.rejects(prepare());assert.equal(calls,1);
});
test('protected setup file recovers post-rename sync failure and refuses mode/bytes drift',{skip:process.getuid()!==0},()=>{
 const root=fs.mkdtempSync('/run/store-setup-'),file=root+'/record.json';let renamed=false,fail=true;
 const io=new Proxy(fs,{get(t,k){if(k==='renameSync')return(...args)=>{const r=fs.renameSync(...args);renamed=true;return r;};if(k==='fsyncSync')return fd=>{if(renamed&&fail&&fs.fstatSync(fd).isDirectory()){fail=false;throw new Error('synthetic fsync loss');}fs.fsyncSync(fd);};return t[k];}});
 const files=createBuyerStoreProtectedFiles({io});try{assert.throws(()=>files.record(file,{version:1}));files.record(file,{version:1});assert.deepEqual(files.value(file),{version:1});assert.throws(()=>files.record(file,{version:2}));fs.chmodSync(file,0o644);assert.throws(()=>files.value(file));}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('password fence stops before ALTER and rejects before commit when quiescence changes',async()=>{
 let calls=0,alters=0,intent=false,checks=0;const management={query:async sql=>{calls++;if(sql.startsWith('SELECT rolname'))return{rows:[0,1].map(()=>({rolcanlogin:true}))};if(sql.startsWith('ALTER ROLE'))alters++;return{rows:[]};}};
 const inputs={management,verifyIdentity:async()=>{},observeFresh:async()=>true,verifyPasswords:async()=>{},journal:{hasIntent:()=>intent,writeIntent:()=>{intent=true;},writeResult:()=>{}},passwords:['a'.repeat(43),'b'.repeat(43)]};
 await assert.rejects(provisionBuyerStorePasswords({...inputs,fence:async()=>{throw new Error('services active');}}));assert.equal(calls,0);
 await assert.rejects(provisionBuyerStorePasswords({...inputs,fence:async()=>{checks++;if(checks===3)throw new Error('changed');}}));assert.equal(alters,2);assert.equal(intent,true);
});
test('verifier preparation rejects secret keys before any connection and binds source owner witness',async()=>{
 const owner='11111111-1111-4111-8111-111111111111',job='22222222-2222-4222-8222-222222222222',key={identity:{uid:0,gid:0,mode:0o600},value:{version:1,projectRef:'kchtrvfcixnimvxxctkj',publicKey:'sb_secret_'+'x'.repeat(30)}};
 let connected=false;const deps={apiGroup:984,readSnapshot:file=>file===BUYER_STORE_PUBLIC_KEY_INPUT?key:{value:{schema:1,kind:'zola_bounded_writer_acceptance_target',releaseSha:'7bd0323e09a221a21db92ba6853a4fe33bb36732',workspace:'blackspire-command',principal:'blackspire-release-root',capability:'buyer.writer.acceptance',ownerId:owner,jobId:job}},files:{record(){throw new Error('must not publish');}},connect:async()=>{connected=true;throw new Error();}};
 await assert.rejects(prepareBuyerStoreVerifier({profile:{systemIdentifier:'2'}},deps));assert.equal(connected,false);
 key.value.publicKey='sb_publishable_'+'x'.repeat(30);const statements=[],output=[];deps.validateCredential=(_v,o)=>{assert.equal(o.pinLegacyCa,true);return{host:'fixed-original'};};deps.files.record=(file,v)=>output.push(v);deps.connect=async()=>({query:async(sql,args)=>{statements.push(sql);if(sql.startsWith('SELECT')){assert.deepEqual(args,[owner,job,'2']);return{rows:[{valid:true}]};}return{rows:[]};},end:async()=>{}});
 await prepareBuyerStoreVerifier({profile:{systemIdentifier:'2'}},deps);assert.deepEqual(output,[{publicKey:key.value.publicKey,operatorOwnerId:owner}]);assert.equal(statements[0],'BEGIN READ ONLY');assert.equal(statements.at(-1),'ROLLBACK');assert.equal(statements.length,3);
});
