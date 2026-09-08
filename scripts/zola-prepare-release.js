import {readRootOwnedJson,readRootOwnedMetadataSnapshot} from '../packages/buyer-writer/protected-json.js';
import {readReleaseProtectedBytes,verifyReleaseSource} from '../packages/zola-release/commander-host.js';
import {prepareOfflineReleaseBundle,writeOfflineReleaseBundle} from '../packages/zola-release/offline-bundle.js';

try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4)throw new Error();
 const [inputFile,outputDirectory]=process.argv.slice(2);
 const input=readRootOwnedJson(inputFile,{groupId:0});
 if(Object.keys(input).sort().join(',')!=='backupFile,migrationConfigurationFile,n8nConfigurationFile,releaseSha')throw new Error();
 verifyReleaseSource(input.releaseSha);
 const n8n=readRootOwnedJson(input.n8nConfigurationFile,{groupId:0});
 const migration=readRootOwnedMetadataSnapshot(input.migrationConfigurationFile,{groupId:0}).value;
 if(Object.keys(migration).sort().join(',')!=='providerManifest,releaseSha'||migration.releaseSha!==input.releaseSha)throw new Error();
 const backupBytes=readReleaseProtectedBytes(input.backupFile,2*1024*1024);
 const bundle=prepareOfflineReleaseBundle({releaseSha:input.releaseSha,n8nConfiguration:n8n,providerManifest:migration.providerManifest,backupBytes});
 verifyReleaseSource(input.releaseSha);
 const result=writeOfflineReleaseBundle(outputDirectory,bundle);
 verifyReleaseSource(input.releaseSha);
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OFFLINE_RELEASE_BUNDLE_REJECTED',productionAccepted:false,liveApplied:false})+'\n');
 process.exitCode=1;
}
