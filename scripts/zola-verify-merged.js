import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
import {verifyMergedRelease} from '../packages/zola-release/commander-merged.js';

try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3)throw new Error();
 const proof=readRootOwnedJson(process.argv[2],{groupId:0});
 if(Object.keys(proof).sort().join(',')!=='ciMergeSha,ciTreeSha,newMainSha,previousMainSha,releaseSha')throw new Error();
 process.stdout.write(JSON.stringify(verifyMergedRelease(proof))+'\n');
}catch{
 process.stdout.write(JSON.stringify({status:'STOPPED',reason:'MERGED_IDENTITY_REJECTED',productionAccepted:false})+'\n');
 process.exitCode=1;
}
