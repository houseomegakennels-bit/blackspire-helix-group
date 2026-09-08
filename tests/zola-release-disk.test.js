import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {calculateDeploymentHeadroom,measureReleaseTree,measureDeploymentHeadroom} from '../packages/zola-release/disk.js';

test('measured disk gate includes both releases, two backups, recovery, build/package peaks and temporary reserve',()=>{
  const input={freeBytes:130,artifactBytes:10,databaseBytes:20,buildPeakBytes:5,packagePeakBytes:10,logTempReserveBytes:25};
  assert.deepEqual(calculateDeploymentHeadroom(input),{components:{deploymentBytes:20,backupBytes:40,rollbackReserveBytes:30,buildPeakBytes:5,packagePeakBytes:10,logTempReserveBytes:25},requiredBytes:130,freeBytes:130,additionalBytesRequired:0,deploymentSafe:true});
  assert.equal(calculateDeploymentHeadroom({...input,freeBytes:129}).additionalBytesRequired,1);
  for(const value of [-1,NaN,Infinity,'130',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>calculateDeploymentHeadroom({...input,freeBytes:value}));
  assert.throws(()=>calculateDeploymentHeadroom({...input,artifactBytes:Number.MAX_SAFE_INTEGER}));
  assert.throws(()=>calculateDeploymentHeadroom({...input,logTempReserveBytes:0}));
});

test('actual filesystem measurement includes sparse file copy size, WAL and SHM, and refuses links',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zola-disk-test-'));
  try{
    const artifact=path.join(root,'artifact');fs.mkdirSync(artifact);const file=path.join(artifact,'runtime');
    fs.writeFileSync(file,'test');fs.truncateSync(file,1024*1024);
    const db=path.join(root,'command.sqlite');fs.writeFileSync(db,Buffer.alloc(4096));
    fs.writeFileSync(db+'-wal',Buffer.alloc(8192));fs.writeFileSync(db+'-shm',Buffer.alloc(4096));
    const result=measureDeploymentHeadroom({artifactRoot:artifact,databasePath:db,releaseRoot:root,buildPeakBytes:0,packagePeakBytes:0,logTempReserveBytes:4096});
    assert.ok(result.artifactBytes>=1024*1024);assert.equal(result.databaseBytes,16384);assert.equal(result.deploymentSafe,true);
    fs.symlinkSync(root,path.join(root,'ancestor-link'));
    assert.throws(()=>measureReleaseTree(path.join(root,'ancestor-link','artifact')),/measurement rejected/);
    fs.symlinkSync(db,path.join(artifact,'escape'));assert.throws(()=>measureReleaseTree(artifact),/measurement rejected/);fs.unlinkSync(path.join(artifact,'escape'));
    fs.linkSync(file,path.join(root,'hardlink'));assert.throws(()=>measureReleaseTree(artifact),/measurement rejected/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
