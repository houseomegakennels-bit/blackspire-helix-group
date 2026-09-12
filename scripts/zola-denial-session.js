#!/usr/bin/env node
// Explicit local root delegation, not a second person's password login. Never
// executed by a public route, never creates principals/grants, never prints keys.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {verifyReleaseSource,readReleaseProtectedBytes} from '../packages/zola-release/commander-host.js';
import {collectZolaActivationProfile,writeZolaActivationProfile} from '../packages/zola-release/activation-profile.js';
const DATABASE='/opt/blackspire-command/shared/database/command.sqlite';
const fail=()=>{throw new Error('DENIAL_SESSION_HOST_REJECTED');};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
let service;
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4)fail();
 const [mode,inputFile]=process.argv.slice(2);if(!['--issue','--revoke'].includes(mode))fail();
 const input=JSON.parse(readReleaseProtectedBytes(inputFile,16384));
 const keys=mode==='--issue'?'configurationFile,deniedPrincipal,outputPath,releaseSha,runId,workspace':'receiptFile';
 if(!input||Object.keys(input).sort().join(',')!==keys)fail();
 for(let p=path.dirname(DATABASE);;p=path.dirname(p)){
  const s=fs.lstatSync(p);if(!s.isDirectory()||s.isSymbolicLink()||(s.mode&0o002))fail();if(p==='/')break;
 }
 const stat=fs.lstatSync(DATABASE);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(stat.mode&0o007))fail();
 const databaseIdentity={dev:stat.dev,ino:stat.ino,uid:stat.uid};
 const assertDatabase=()=>{
  const current=fs.lstatSync(DATABASE);if(current.isSymbolicLink()||current.ino!==stat.ino||current.dev!==stat.dev||current.uid!==stat.uid)fail();
 };
 let profile,operator,pid,receipt;
 if(mode==='--issue'){
  verifyReleaseSource(input.releaseSha);
  profile=await collectZolaActivationProfile(input);pid=profile.profile.context.apiPid;
  const environmentBytes=fs.readFileSync(`/proc/${pid}/environ`);if(environmentBytes.length>256*1024)fail();
  const environment=new Map(environmentBytes.toString('utf8').split('\0').map(s=>{const p=s.indexOf('=');return[s.slice(0,p),s.slice(p+1)];}));
  operator=environment.get('BLACKSPIRE_OPERATOR_PRINCIPAL_ID')||environment.get('BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID');
  if(environment.get('BLACKSPIRE_DB_PATH')!==DATABASE||environment.get('NODE_ENV')!=='production'||!(/^[A-Za-z0-9._:-]{1,128}$/).test(operator??'')||stat.uid!==profile.profile.context.apiUid)fail();
  if(!fs.readdirSync(`/proc/${pid}/fd`).some(name=>{try{const s=fs.statSync(`/proc/${pid}/fd/${name}`);return s.dev===stat.dev&&s.ino===stat.ino;}catch{return false;}}))fail();
 }else{
  // Recovery remains available with stopped services or a newer active release.
  // A replaced/restored DB inode requires reconciliation; never mass-revoke.
  receipt=JSON.parse(readReleaseProtectedBytes(input.receiptFile,16384));
  if(digest(receipt.databaseIdentity)!==digest(databaseIdentity))fail();
 }
 assertDatabase();
 // Only selected non-secret configuration enters this process before loading
 // the shared database/session subsystem. No runtime secrets are copied.
 process.env.BLACKSPIRE_DB_PATH=DATABASE;process.env.SESSION_TTL_MS='900000';
 const {openDelegatedSessionService}=await import('../packages/zola-six-reads/denial-session.js');
 service=await openDelegatedSessionService(DATABASE);
 if(mode==='--issue'&&digest(profile)!==digest(await collectZolaActivationProfile(input)))fail();assertDatabase();
 let result;
 if(mode==='--issue'){
  result=service.issue({operatorPrincipal:operator,deniedPrincipal:input.deniedPrincipal,workspace:input.workspace,runId:input.runId,releaseSha:input.releaseSha},value=>{
   assertDatabase();const protectedReceipt={...value,databaseIdentity};writeZolaActivationProfile(input.outputPath,protectedReceipt);
   if(digest(JSON.parse(readReleaseProtectedBytes(input.outputPath,16384)))!==digest(protectedReceipt))fail();
  });
 }else result=service.revoke(receipt);
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{
 process.stderr.write('Delegated denial session stopped. Preserve any protected receipt and reconcile; do not retry issuance.\n');process.exitCode=1;
}finally{try{service?.close();}catch{process.stderr.write('Delegated denial session database close failed; retain receipt.\n');process.exitCode=1;}}
