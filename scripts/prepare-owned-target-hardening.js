import {runOwnedTargetHardening} from '../packages/buyer-writer/owned-target-hardening-host.js';
const [flag,releaseSha,operationId,profileDigest,...rest]=process.argv.slice(2);
try{
 if(rest.length||!['--apply','--reconcile'].includes(flag))throw new Error();
 const result=await runOwnedTargetHardening({mode:flag.slice(2),releaseSha,operationId,profileDigest,
 sourceSecurityConfigurationFile:`/var/lib/blackspire-operator/owned-source-security/${operationId}/configuration.json`,
 ownedMigrationConfigurationFile:`/var/lib/blackspire-operator/owned-buyer-migration/${operationId}/manifest.json`});
 if(!result)throw new Error();process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned target hardening stopped; retain protected evidence and reconcile.\n');process.exitCode=1;}
