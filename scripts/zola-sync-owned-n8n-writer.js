import {createHash} from 'node:crypto';
import path from 'node:path';
import {readRootOwnedJsonSnapshot} from '../packages/buyer-writer/protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest,validateDatabaseTarget} from '../packages/buyer-writer/database-profile.js';
import {validateBuyerWriterConfiguration,validateBuyerWriterGatewayAuthority} from '../packages/buyer-writer/configuration.js';
import {verifyOwnedBuyerMigrationQuiescence} from '../packages/buyer-writer/owned-migration-host.js';
import {createBuyerStoreProtectedFiles} from '../packages/buyer-store/protected-files.js';
import {prepareN8nTransition} from '../packages/zola-release/commander-n8n.js';
import {openReleaseJournal} from '../packages/zola-release/commander-journal.js';
import {readReleaseProtectedBytes,verifyReleaseSource} from '../packages/zola-release/commander-host.js';
import {createOwnedN8nCredentialTransport,synchronizeOwnedN8nWriter} from '../packages/zola-release/owned-n8n-credential.js';
const root='/var/lib/blackspire-operator/preparation',sourceFile=root+'/owned-gateway-provisioning.json';
const fail=()=>{throw new Error('Owned n8n writer command refused');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
let journal;
try{
 const [mode,releaseSha,configurationFile,backupFile,...extra]=process.argv.slice(2);
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||mode!=='--synchronize'||extra.length||!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
 for(const file of [configurationFile,backupFile])if(typeof file!=='string'||!file.startsWith(root+'/')||path.resolve(file)!==file)fail();
 verifyReleaseSource(releaseSha);journal=openReleaseJournal();verifyOwnedBuyerMigrationQuiescence();
 const read=file=>readRootOwnedJsonSnapshot(file,{groupId:0,maxBytes:65536});
 const source=read(sourceFile),configuration=read(configurationFile),backup=readReleaseProtectedBytes(backupFile,2*1024*1024),profile=readOwnedDatabaseProfile();
 const v=source.value;
 if(!same(Object.keys(v).sort(),['authority','bindingFile','creatorOid','gatewayCapability','issuer','issuerCredential','runtime','version','workspace','writerCredential'])
  ||v.version!==3||v.workspace!=='blackspire-command'||v.authority.releaseSha!==releaseSha||v.runtime.backendProfile!=='owned-postgres-v1'||v.issuer.backendProfile!=='owned-postgres-v1')fail();
 validateBuyerWriterGatewayAuthority(v.authority,{workspace:v.workspace});
 validateBuyerWriterConfiguration({version:1,workspace:v.workspace,bindingFile:v.bindingFile,writerCredential:v.writerCredential,issuerCredential:v.issuerCredential,creatorOid:v.creatorOid,runtime:v.runtime,issuer:v.issuer},{workspace:v.workspace,environment:'production'});
 validateDatabaseTarget(v.runtime,{ownedProfile:profile});validateDatabaseTarget(v.issuer,{ownedProfile:profile});
 if(new Set([v.writerCredential,v.issuerCredential,v.gatewayCapability,v.runtime.password,v.issuer.password]).size!==5)fail();
 const plan=prepareN8nTransition({configuration:configuration.value,backupBytes:backup});if(plan.releaseSha!==releaseSha)fail();
 const key=readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim();
 const files=createBuyerStoreProtectedFiles(),directory=root+'/owned-n8n-writer';files.directory(directory,{create:true});
 const deadline=Date.now()+15*60*1000;
 const fence=()=>{
  if(Date.now()>=deadline)fail();
  verifyOwnedBuyerMigrationQuiescence();verifyReleaseSource(releaseSha);
  if(!same(source,read(sourceFile))||!same(configuration,read(configurationFile))||backup!==readReleaseProtectedBytes(backupFile,2*1024*1024)
   ||!same(profile,readOwnedDatabaseProfile())||key!==readReleaseProtectedBytes('/var/lib/blackspire-operator/n8n-api-key',16384).trim())fail();
 };
 const store={value:(name,optional)=>{if(!['intent','result'].includes(name))fail();return files.value(directory+'/'+name+'.json',optional);},record:(name,value)=>{if(!['intent','result'].includes(name))fail();files.record(directory+'/'+name+'.json',value);}};
 const result=await synchronizeOwnedN8nWriter({plan,writerCredential:v.writerCredential,profileDigest:databaseProfileDigest(profile),sourceDigest:createHash('sha256').update(JSON.stringify(source)).digest('hex')},
  {store,fence,request:createOwnedN8nCredentialTransport(key)});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Owned n8n writer synchronization stopped; no secret values disclosed. Reconcile retained intent before any retry.\n');process.exitCode=1;}
finally{journal?.close();}
