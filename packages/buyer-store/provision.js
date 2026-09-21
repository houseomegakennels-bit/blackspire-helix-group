import {provisionBuyerStorePasswords} from './password-provision.js';
import {observeFreshOwnedRepositoryCredentials} from '../buyer-writer/owned-postgres-materializer.js';
import fs from 'node:fs';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readRootOwnedJson} from '../buyer-writer/protected-json.js';
import {readOwnedDatabaseProfile,validateManagementCredential,verifyOwnedDatabaseIdentity,OWNED_DATABASE_MANAGEMENT} from '../buyer-writer/database-profile.js';
import {ownedPostgresProfileDigest} from '../buyer-writer/owned-postgres.js';
import {inspectSealedBuyerWriterArtifact} from '../buyer-writer/artifact-inspection.js';
import {validateBuyerStoreConfiguration,BUYER_STORE_CONFIGURATION,BUYER_STORE_CLIENT_CONFIGURATION} from './configuration.js';
import {fail} from './local-protocol.js';
const ROOT='/var/lib/blackspire-operator/buyer-store';
const PLAN=ROOT+'/plan.json',INTENT=ROOT+'/password-intent.json',DONE=ROOT+'/password-result.json';
const roles=['buyer_repository_login','buyer_capability_login'];
const bytes=v=>Buffer.from(JSON.stringify(v)+'\n');
function publish(filename,value,gid=0,mode=0o600){
 const data=bytes(value);let fd;
 try{fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);fs.writeFileSync(fd,data);fs.fchownSync(fd,0,gid);fs.fchmodSync(fd,mode);fs.fsyncSync(fd);}
 catch(error){if(error.code!=='EEXIST')fail();const actual=readRootOwnedJson(filename,{groupId:gid,maxBytes:32768});if(!bytes(actual).equals(data))fail();}
 finally{if(fd!==undefined)fs.closeSync(fd);}
 const stat=fs.lstatSync(filename);if(!stat.isFile()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==gid||stat.nlink!==1||(stat.mode&0o7777)!==mode)fail();
 const dir=fs.openSync(filename.slice(0,filename.lastIndexOf('/')),fs.constants.O_RDONLY);try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
}
function existing(filename){try{fs.lstatSync(filename);return true;}catch(error){if(error.code==='ENOENT')return false;fail();}}
function directory(filename){
 if(!existing(filename))fs.mkdirSync(filename,{mode:0o700});
 const s=fs.lstatSync(filename);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)fail();
}
function group(name){
 const line=execFileSync('/usr/bin/getent',['group',name],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(':');
 if(line.length!==4||line[0]!==name||!/^\d+$/.test(line[2])||Number(line[2])===0)fail();return Number(line[2]);
}
const digest=v=>createHash('sha256').update(bytes(v)).digest('hex');
// Fixed protected input contains only public verifier configuration; no implicit
// discovery or env fallbacks. Root must prepare users/groups and role DDL first.
export async function provisionBuyerStore(releaseSha,{Client}={}){
 if(process.getuid()!==0||!/^[a-f0-9]{40}$/.test(releaseSha))fail();
 const Driver=Client??(await import('pg')).Client;
 const profile=readOwnedDatabaseProfile(),credential=validateManagementCredential(readRootOwnedJson(OWNED_DATABASE_MANAGEMENT,{groupId:0}),{ownedProfile:profile});
 const artifact=await inspectSealedBuyerWriterArtifact({artifactRoot:'/opt/blackspire-command/releases/'+releaseSha,releaseSha,environment:'production'});
 const gid=group('blackspire-buyer-store'),apiGid=group('blackspire-api'),ipcGroupId=group('blackspire-buyer-store-client');
 if(new Set([gid,apiGid,ipcGroupId]).size!==3)fail();
 const verifier=readRootOwnedJson('/var/lib/blackspire-operator/preparation/buyer-store-verifier.json',{groupId:0});
 if(Object.keys(verifier).sort().join(',')!=='operatorOwnerId,publicKey')fail();
 directory(ROOT);let lock;
 try{
  lock=fs.openSync(ROOT+'/lock',fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);
  let plan;
  if(existing(PLAN))plan=readRootOwnedJson(PLAN,{groupId:0,maxBytes:32768});
  else{
   const key=()=>randomBytes(32).toString('base64url');
   const configuration=validateBuyerStoreConfiguration({version:1,client:{version:1,releaseSha,profileDigest:ownedPostgresProfileDigest(profile),key:key()},profile,ca:credential.ca,
    repositoryPassword:key(),capabilityPassword:key(),publicKey:verifier.publicKey,operatorOwnerId:verifier.operatorOwnerId,ipcGroupId});
   plan={version:1,releaseSha,artifactDigest:artifact.artifactDigest,configuration};publish(PLAN,plan);
  }
  const config=validateBuyerStoreConfiguration(plan.configuration);
  if(plan.version!==1||plan.releaseSha!==releaseSha||plan.artifactDigest!==artifact.artifactDigest||config.client.profileDigest!==ownedPostgresProfileDigest(profile)||config.publicKey!==verifier.publicKey||config.operatorOwnerId!==verifier.operatorOwnerId||config.ipcGroupId!==ipcGroupId)fail();
  const intent={version:1,planDigest:digest(plan),roles};
  const options=(user,password)=>({host:profile.host,port:profile.port,database:profile.database,user,password,ssl:{rejectUnauthorized:true,ca:credential.ca},connectionTimeoutMillis:3000,query_timeout:8000});
  const verify=async()=>{
   for(const [index,user] of roles.entries()){
    const client=new Driver(options(user,index===0?config.repositoryPassword:config.capabilityPassword));
    try{await client.connect();const r=await client.query('select current_user as actor,session_user as session');if(r.rows?.length!==1||r.rows[0].actor!==user||r.rows[0].session!==user)fail();}
    finally{await client.end().catch(()=>{});}
   }
  };
  const management=new Driver(options(credential.user,credential.password));
  try{
   await management.connect();
   await provisionBuyerStorePasswords({management,verifyIdentity:()=>verifyOwnedDatabaseIdentity(management,profile),
    observeFresh:async()=>{const result=await observeFreshOwnedRepositoryCredentials();return result.fresh===true;},
    passwords:[config.repositoryPassword,config.capabilityPassword],verifyPasswords:verify,
    journal:{hasIntent:()=>existing(INTENT),writeIntent:()=>publish(INTENT,intent),
     verifyIntent:()=>{if(JSON.stringify(readRootOwnedJson(INTENT,{groupId:0}))!==JSON.stringify(intent))fail();},
     writeResult:()=>publish(DONE,{version:1,planDigest:digest(plan),status:'VERIFIED'})}});
  }finally{await management.end().catch(()=>{});}
  directory('/etc/blackspire-buyer-store');
  fs.chownSync('/etc/blackspire-buyer-store',0,gid);fs.chmodSync('/etc/blackspire-buyer-store',0o750);
  publish(BUYER_STORE_CONFIGURATION,config,gid,0o640);
  publish(BUYER_STORE_CLIENT_CONFIGURATION,config.client,apiGid,0o640);
  return {status:'BUYER_STORE_CREDENTIALS_PREPARED',releaseSha,artifactDigest:artifact.artifactDigest};
 }finally{if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(ROOT+'/lock');}}
}
