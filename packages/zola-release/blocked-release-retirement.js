import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {readOwnedDatabaseProfile,databaseProfileDigest,validateManagementCredential,databaseTlsOptions,LEGACY_DATABASE_MANAGEMENT} from '../buyer-writer/database-profile.js';
import {verifyReleaseSource} from './commander-host.js';
import {inspectReleaseCommander} from './commander.js';
import {inspectReleaseSequenceHistory} from './commander-sequence.js';
import {BLOCKED_RELEASE,validateBlockedReleasePrefix,partitionRetiredReleaseHistory} from './retired-release-history.js';
import {hash} from './commander-journal.js';
const fail=()=>{throw new Error('Blocked release retirement refused; retain all evidence');};
const ROLES=Object.freeze(['buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission','buyer_writer_admission_login']);
const STATE='/var/lib/blackspire-operator/buyer-writer-provisioning/state.json';
const ROOT='/var/lib/blackspire-operator/release-retirements';
export async function observeOriginalWriterRoles({Client}={}){
 const credential=validateManagementCredential(readRootOwnedJson(LEGACY_DATABASE_MANAGEMENT,{groupId:0}),{pinLegacyCa:true});
 const Driver=Client??(await import('pg')).Client;
 const client=new Driver({host:credential.host,port:credential.port,database:credential.database,user:credential.user,password:credential.password,
  ssl:databaseTlsOptions(credential),connectionTimeoutMillis:3000,query_timeout:5000,options:'-c statement_timeout=4000 -c default_transaction_read_only=on'});
 client.on('error',()=>{});
 try{
  await client.connect();await client.query('BEGIN READ ONLY');
  const identity=(await client.query('SELECT current_user AS actor,session_user AS session,current_database() AS database')).rows;
  if(identity.length!==1||identity[0].actor!=='postgres'||identity[0].session!=='postgres'||identity[0].database!=='postgres')fail();
  const roles=(await client.query('SELECT rolname FROM pg_roles WHERE rolname=ANY($1::text[]) ORDER BY rolname',[ROLES])).rows;
  if(roles.length!==0)fail();
  const acl=(await client.query("SELECT 'schema' AS kind,n.oid::text AS id,n.nspacl::text AS acl FROM pg_namespace n WHERE n.nspname='net' UNION ALL SELECT 'relation',c.oid::text,c.relacl::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='net' UNION ALL SELECT 'routine',p.oid::text,p.proacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='net' ORDER BY kind,id")).rows;
  await client.query('COMMIT');
  return {rolesAbsent:true,providerAclDigest:hash(acl)};
 }finally{await client.end().catch(()=>{});}
}
export function observeBlockedReleaseHost(){
 const services=['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service','blackspire-buyer-store.service'];
 for(const service of services){
  const output=execFileSync('/usr/bin/systemctl',['show','--property=ActiveState','--property=MainPID',service],{encoding:'utf8',timeout:1000,maxBuffer:4096});
  const fields=Object.fromEntries(output.trim().split('\n').map(line=>line.split('=')));
  if(fields.MainPID!=='0'||fields.ActiveState!=='inactive')fail();
 }
 const current=fs.realpathSync('/opt/blackspire-command/current');
 if(current!=='/opt/blackspire-command/releases/'+BLOCKED_RELEASE.currentSha)fail();
 for(const p of ['/etc/blackspire/release-admission/state.json','/etc/blackspire/release-admission/pending.json']){
  try{fs.lstatSync(p);fail();}catch(e){if(e.code!=='ENOENT')throw e;}
 }
 const state=readRootOwnedJson(STATE,{groupId:0,maxBytes:4096});
 if(hash(state)!==BLOCKED_RELEASE.provisioningDigest)fail();
 return {hostStopped:true,currentSha:BLOCKED_RELEASE.currentSha,admissionAbsent:true,provisioningDigest:hash(state)};
}
function retainProof(proof){
 try{fs.mkdirSync(ROOT,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
 const stat=fs.lstatSync(ROOT);
 if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o7777)!==0o700)fail();
 const name=ROOT+'/'+hash(proof)+'.json',data=JSON.stringify(proof)+'\n';let fd;
 try{fd=fs.openSync(name,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);}
 catch(e){if(e.code!=='EEXIST')throw e;if(JSON.stringify(readRootOwnedJson(name,{groupId:0,maxBytes:16384}))!==JSON.stringify(proof))fail();}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 const directory=fs.openSync(ROOT,fs.constants.O_RDONLY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
}
export async function retireBlockedRelease({successorReleaseSha,journal},{verifySource=verifyReleaseSource,readProfile=readOwnedDatabaseProfile,observeHost=observeBlockedReleaseHost,
 observeDatabase=observeOriginalWriterRoles,retain=retainProof,now=Date.now,uid=process.getuid()}={}){
 if(uid!==0||!/^[a-f0-9]{40}$/.test(successorReleaseSha)||successorReleaseSha===BLOCKED_RELEASE.releaseSha)fail();
 const stream=journal.stream('release'),before=stream.events(),partition=partitionRetiredReleaseHistory(before);
 inspectReleaseCommander(journal);
 if(partition.retired){
  if(partition.retired.successorReleaseSha!==successorReleaseSha)fail();
  return {status:'BLOCKED_RELEASE_ALREADY_RETIRED',operationId:BLOCKED_RELEASE.operationId,historicalMutationState:true};
 }
 validateBlockedReleasePrefix(before);
 const sequence=inspectReleaseSequenceHistory(before);
 if(sequence.pending?.attemptId!==BLOCKED_RELEASE.attemptId||sequence.nextOrdinal!==5)fail();
 await verifySource(successorReleaseSha);
 const profile=readProfile(),profileDigest=databaseProfileDigest(profile);
 const started=now(),host=observeHost(),database=await observeDatabase();
 const n8n=journal.stream('n8n').events(),n8nJournalDigest=hash(n8n);
 if(n8nJournalDigest!==BLOCKED_RELEASE.n8nJournalDigest)fail();
 // Both streams are held under the host-wide commander lock; old known
 // successful backup/fixture/preparation mutations remain in their original rows.
 const secondHost=observeHost(),secondDatabase=await observeDatabase();
 if(JSON.stringify(host)!==JSON.stringify(secondHost)||JSON.stringify(database)!==JSON.stringify(secondDatabase)||database.rolesAbsent!==true
  ||now()-started>15000||JSON.stringify(readProfile())!==JSON.stringify(profile)||hash(stream.events())!==BLOCKED_RELEASE.prefixDigest||hash(journal.stream('n8n').events())!==n8nJournalDigest)fail();
 const proof={version:1,observedAt:now(),rolesAbsent:true,...host,retainedEffectsDigest:hash(before.slice(BLOCKED_RELEASE.segmentStart)),n8nJournalDigest,
  providerAclDigest:database.providerAclDigest,providerUnchanged:true};
 const event={schema:4,type:'sequence_retired',operationId:BLOCKED_RELEASE.operationId,releaseSha:BLOCKED_RELEASE.releaseSha,attemptId:BLOCKED_RELEASE.attemptId,
  ordinal:5,stage:'admission_lease',prefixDigest:BLOCKED_RELEASE.prefixDigest,segmentDigest:BLOCKED_RELEASE.segmentDigest,successorReleaseSha,
  backendProfile:'owned-postgres-v1',profileDigest,proof,proofDigest:hash(proof)};
 partitionRetiredReleaseHistory([...before,event]);retain(event);
 if(hash(stream.events())!==BLOCKED_RELEASE.prefixDigest)fail();stream.append(event);
 return {status:'BLOCKED_RELEASE_RETIRED',operationId:BLOCKED_RELEASE.operationId,successorReleaseSha,proofDigest:event.proofDigest,historicalMutationState:true,retainedEffects:true};
}
