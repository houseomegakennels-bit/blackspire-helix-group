import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOwnedBuyerMigrationQuiescence,runOwnedBuyerMigration,readOwnedMigrationRootRecord} from '../packages/buyer-writer/owned-migration-host.js';
const state=(load='loaded',active='inactive',sub='dead',pid='0')=>({status:0,stderr:'',stdout:`LoadState=${load}\nActiveState=${active}\nSubState=${sub}\nMainPID=${pid}\n`});
test('checks actual API unit and refuses unknown, active and incomplete unit states',()=>{
 const seen=[];verifyOwnedBuyerMigrationQuiescence({run:(_,args)=>{seen.push(args[1]);return state();}});
 assert.deepEqual(seen,['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service']);
 for(const bad of [state('not-found'),state('loaded','active'),state('loaded','inactive','running'),state('loaded','inactive','dead','12'),{status:0,stderr:'',stdout:'ActiveState=inactive\nMainPID=0\n'}]){
  assert.throws(()=>verifyOwnedBuyerMigrationQuiescence({run:(_,args)=>args[1]==='blackspire-command.service'?bad:state()}));
 }
});
test('absent store requires complete process identity evidence and rejects a surviving identity',()=>{
 const run=(cmd,args)=>cmd.endsWith('getent')?{status:0,stderr:'',stdout:'blackspire-buyer-store:x:321:321::/:/usr/sbin/nologin\n'}:state(args[1]==='blackspire-buyer-store.service'?'not-found':'loaded');
 const io={readdirSync:()=>['123'],readFileSync:p=>p.endsWith('/status')?'Uid:\t0\t0\t0\t0\n':'node\0ordinary.js\0'};
 verifyOwnedBuyerMigrationQuiescence({run,io});
 assert.throws(()=>verifyOwnedBuyerMigrationQuiescence({run,io:{...io,readFileSync:p=>p.endsWith('/status')?'Uid:\t321\t321\t321\t321\n':'node\0ordinary.js\0'}}));
 assert.throws(()=>verifyOwnedBuyerMigrationQuiescence({run,io:{...io,readFileSync:p=>p.endsWith('/status')?'Uid:\t0\t0\t0\t0\n':'node\0buyer-store-service.js\0'}}));
 assert.throws(()=>verifyOwnedBuyerMigrationQuiescence({run,io:{...io,readFileSync:()=>{throw Object.assign(new Error(),{code:'EACCES'});}}}));
});
test('global release exclusion precedes native work and closes on rejection',async()=>{
 let closed=0,entered=0;
 await assert.rejects(runOwnedBuyerMigration({}, {openReleaseGuard:()=>({close(){closed++;}}),uid:()=>{entered++;return 0;}}));
 assert.equal(closed,1);
 await assert.rejects(runOwnedBuyerMigration({}, {openReleaseGuard:()=>{throw new Error('busy');},uid:()=>{entered++;return 0;}}));
 assert.equal(entered,0);
});

test('native retained metadata reader accepts protected manifests above credential limit', {skip:process.getuid?.()!==0},t=>{
 const root=fs.mkdtempSync(path.join('/root','owned-migration-metadata-'));fs.chmodSync(root,0o700);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const file=path.join(root,'manifest.json'),value={metadata:'x'.repeat(70000)};fs.writeFileSync(file,JSON.stringify(value),{mode:0o600});
 assert.deepEqual(readOwnedMigrationRootRecord(file),value);
 fs.chmodSync(file,0o644);assert.throws(()=>readOwnedMigrationRootRecord(file));
});
