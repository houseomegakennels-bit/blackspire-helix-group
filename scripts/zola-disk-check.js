import {pathToFileURL} from 'node:url';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {measureDeploymentHeadroom} from '../packages/zola-release/disk.js';

export function checkZolaDisk(filename){
  const config=readRootOwnedJson(filename,{groupId:0});
  const keys=['artifactRoot','databasePath','releaseRoot','buildPeakBytes','packagePeakBytes','logTempReserveBytes'];
  if(Object.keys(config).length!==keys.length||keys.some(key=>!Object.hasOwn(config,key)))throw new Error('Zola disk configuration rejected');
  return measureDeploymentHeadroom(config);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==3)throw new Error();
    const result=checkZolaDisk(process.argv[2]);
    process.stdout.write(JSON.stringify(result)+'\n');if(!result.deploymentSafe)process.exitCode=1;
  }catch{process.stderr.write('Zola disk check rejected\n');process.exitCode=1;}
}
