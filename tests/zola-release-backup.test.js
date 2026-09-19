import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {prepareDisposableDatabase} from './helpers/prepare-disposable-database.js';
import {captureProtectedReleaseBackup,verifyProtectedReleaseBackup,measureProtectedBackupEnvelope,copyProtectedBackup} from '../packages/zola-release/commander-backup.js';

const sha='a'.repeat(40);
function fixture(t){
 const directory=fs.mkdtempSync('/root/zola-protected-backup-test-');fs.chmodSync(directory,0o700);
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const sourcePath=path.join(directory,'database','command.sqlite'),root=path.join(directory,'backups');
 prepareDisposableDatabase(sourcePath);
 return{sourcePath,root};
}
test('consistent actual SQLite backup binds root-protected manifest, source inode, SHA, digest and schema',{skip:process.getuid()!==0},t=>{
 const options=fixture(t),captured=captureProtectedReleaseBackup(sha,options);
 const input={releaseSha:sha,manifestFile:captured.manifestFile};
 const proof=verifyProtectedReleaseBackup(input,options);
 assert.equal(proof.status,'PROTECTED_BACKUP_VERIFIED');assert.equal(proof.sourceIdentityBound,true);
 assert.equal(proof.snapshotSha256,captured.snapshotSha256);assert.equal(proof.productionAccepted,false);
 // Source can change normally without altering the coherent retained snapshot.
 const db=new DatabaseSync(options.sourcePath);db.exec('CREATE TABLE backup_after_capture(value TEXT)');db.close();
 assert.deepEqual(verifyProtectedReleaseBackup(input,options),proof);
 assert.throws(()=>verifyProtectedReleaseBackup({...input,releaseSha:'b'.repeat(40)},options));
 assert.throws(()=>verifyProtectedReleaseBackup(input,{...options,now:Date.now()+3600001}));
 fs.appendFileSync(path.join(path.dirname(input.manifestFile),'snapshot.sqlite'),'tamper');
 assert.throws(()=>verifyProtectedReleaseBackup(input,options));
});
test('source replacement, hardlinked snapshots and unprotected manifest cannot pass',{skip:process.getuid()!==0},t=>{
 const options=fixture(t),captured=captureProtectedReleaseBackup(sha,options),input={releaseSha:sha,manifestFile:captured.manifestFile};
 const snapshot=path.join(path.dirname(input.manifestFile),'snapshot.sqlite');
 fs.linkSync(snapshot,snapshot+'.link');assert.throws(()=>verifyProtectedReleaseBackup(input,options));fs.unlinkSync(snapshot+'.link');
 fs.chmodSync(input.manifestFile,0o644);assert.throws(()=>verifyProtectedReleaseBackup(input,options));fs.chmodSync(input.manifestFile,0o600);
 fs.renameSync(options.sourcePath,options.sourcePath+'.old');fs.copyFileSync(options.sourcePath+'.old',options.sourcePath);
 assert.throws(()=>verifyProtectedReleaseBackup(input,options));
});
test('production verifier refuses arbitrary manifest paths before opening SQLite',()=>{
 assert.throws(()=>verifyProtectedReleaseBackup({releaseSha:sha,manifestFile:'/tmp/fake/manifest.json'}));
});


test('capture envelope rejects oversized source/WAL and unsafe destination before allocation',()=>{
 const file={isFile:()=>true,isSymbolicLink:()=>false,nlink:1,size:4096,blocks:8};
 const io={lstatSync:p=>{if(p.endsWith('-shm'))throw Object.assign(new Error(),{code:'ENOENT'});return file;},statfsSync:()=>({bavail:1000000n,bsize:4096n})};
 assert.equal(measureProtectedBackupEnvelope('/source','/destination',{io}).sourceBytes,8192);
 assert.throws(()=>measureProtectedBackupEnvelope('/source','/destination',{io:{...io,statfsSync:()=>({bavail:0n,bsize:4096n})}}));
 assert.throws(()=>measureProtectedBackupEnvelope('/source','/destination',{io:{...io,lstatSync:()=>({...file,size:1024*1024*1024})}}));
});
test('bounded copy child timeout or file limit is rejected without retry',()=>{
 let calls=0;
 assert.throws(()=>copyProtectedBackup(3,'/protected/snapshot.sqlite',{maxBytes:8192,run:(exe,args,options)=>{
  calls++;assert.equal(exe,'/usr/bin/prlimit');assert.equal(args[0],'--fsize=8192:8192');
  assert.equal(options.timeout,30000);assert.equal(options.killSignal,'SIGKILL');assert.equal(options.env.SQLITE_TMPDIR,'/protected');
  return{status:null,signal:'SIGKILL',stdout:'',stderr:''};
 }}));assert.equal(calls,1);
 assert.throws(()=>copyProtectedBackup(3,'/protected/snapshot.sqlite',{run:()=>({status:null,signal:'SIGXFSZ',stdout:'',stderr:''})}));
});
