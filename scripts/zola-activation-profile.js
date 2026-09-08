import {pathToFileURL} from 'node:url';
import {collectZolaActivationProfile,writeZolaActivationProfile} from '../packages/zola-release/activation-profile.js';

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    if(process.argv.length!==5)throw new Error();
    const [, ,releaseSha,configurationFile,destination]=process.argv;
    const result=await collectZolaActivationProfile({releaseSha,configurationFile});
    const published=writeZolaActivationProfile(destination,result.profile);
    process.stdout.write(JSON.stringify({version:1,kind:'zola-activation-profile',releaseSha,artifactDigest:result.artifactDigest,
      apiGeneration:result.profile.context.apiGeneration,workerGeneration:result.workerGeneration,profileSha256:published.sha256,
      state:'PREPARED',activated:false})+'\n');
  }catch{process.stderr.write('Zola activation profile preparation rejected\n');process.exitCode=1;}
}
