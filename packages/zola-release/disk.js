import fs from 'node:fs';
import path from 'node:path';

const fail=()=>{throw new Error('Zola disk measurement rejected');};
const integer=value=>Number.isSafeInteger(value)&&value>=0;

// Count allocated AND logical bytes: sparse files must not understate a copy.
// No links, special files, cross-device traversal, or unbounded inventories.
export function measureReleaseTree(directory,{io=fs}={}){
  try{
    if(typeof directory!=='string'||!path.isAbsolute(directory)||path.resolve(directory)!==directory||io.realpathSync(directory)!==directory)fail();
    const root=io.lstatSync(directory);if(!root.isDirectory()||root.isSymbolicLink())fail();
    let bytes=0,entries=0;
    const visit=file=>{
      const stat=io.lstatSync(file);
      if(++entries>50000||stat.dev!==root.dev||stat.isSymbolicLink())fail();
      if(stat.isDirectory()){
        bytes+=Math.max(stat.blocks*512,4096);
        for(const name of io.readdirSync(file))visit(path.join(file,name));
      }else{
        if(!stat.isFile()||stat.nlink!==1)fail();
        bytes+=Math.max(stat.size,stat.blocks*512);
      }
      if(!integer(bytes)||bytes>1024*1024*1024)fail();
    };
    visit(directory);return{bytes,entries,device:root.dev};
  }catch{fail();}
}

// This is an explicit deployment envelope, not an arbitrary free-space floor.
// Build/package peaks must come from the actual planned build procedure. Zero
// is valid for installation of already sealed artifacts; it never authorizes a
// frontend build or an uncapped package-manager run on the VPS.
export function calculateDeploymentHeadroom({freeBytes,artifactBytes,databaseBytes,buildPeakBytes,packagePeakBytes,logTempReserveBytes}){
  const values=[freeBytes,artifactBytes,databaseBytes,buildPeakBytes,packagePeakBytes,logTempReserveBytes];
  if(values.some(value=>!integer(value))||artifactBytes===0||databaseBytes===0||logTempReserveBytes===0)fail();
  const components={deploymentBytes:2*artifactBytes,backupBytes:2*databaseBytes,rollbackReserveBytes:artifactBytes+databaseBytes,
    buildPeakBytes,packagePeakBytes,logTempReserveBytes};
  const requiredBytes=Object.values(components).reduce((sum,value)=>sum+value,0);
  if(!integer(requiredBytes))fail();
  return{components,requiredBytes,freeBytes,additionalBytesRequired:Math.max(0,requiredBytes-freeBytes),deploymentSafe:freeBytes>=requiredBytes};
}

export function measureDeploymentHeadroom({artifactRoot,databasePath,releaseRoot,buildPeakBytes,packagePeakBytes,logTempReserveBytes},{io=fs}={}){
  try{
    const artifact=measureReleaseTree(artifactRoot,{io});
    for(const filename of [databasePath,releaseRoot]){
      if(typeof filename!=='string'||!path.isAbsolute(filename)||path.resolve(filename)!==filename||io.realpathSync(filename)!==filename)fail();
    }
    const destination=io.lstatSync(releaseRoot),database=io.lstatSync(databasePath);
    if(!destination.isDirectory()||!database.isFile()||database.isSymbolicLink()||database.nlink!==1||database.dev!==destination.dev)fail();
    let databaseBytes=Math.max(database.size,database.blocks*512);
    for(const suffix of ['-wal','-shm']){
      let stat;try{stat=io.lstatSync(databasePath+suffix);}catch(error){if(error.code==='ENOENT')continue;throw error;}
      if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.dev!==destination.dev)fail();
      databaseBytes+=Math.max(stat.size,stat.blocks*512);
    }
    const capacity=io.statfsSync(releaseRoot,{bigint:true});
    const available=capacity.bavail*capacity.bsize;
    if(available>BigInt(Number.MAX_SAFE_INTEGER)||available<0n)fail();
    return{version:1,kind:'zola-deployment-headroom',observedAt:new Date().toISOString(),artifactBytes:artifact.bytes,databaseBytes,
      ...calculateDeploymentHeadroom({freeBytes:Number(available),artifactBytes:artifact.bytes,databaseBytes,buildPeakBytes,packagePeakBytes,logTempReserveBytes}),
      scope:'point-in-time measured envelope; remeasure before each deployment; concurrent growth is not reserved'};
  }catch{fail();}
}
