import fs from 'node:fs';
import {register} from 'node:module';
import {fileURLToPath} from 'node:url';
import {DENIAL_SUCCESSOR as D,successorDenialFail as fail,inspectSuccessorEligibility,openSuccessorDenialService,verifySuccessorDatabase,readSuccessorRoleProof} from '../packages/zola-six-reads/owned-denial-successor.js';
import {RENEWAL,renewalHash as hash} from '../packages/zola-six-reads/owned-denial-renewal.js';
import {SUCCESSOR,checkSuccessorSource,validateRecoveryBeforeIssuance} from '../packages/zola-six-reads/owned-collector-successor-host.js';
import {OWNED_SIX_READ} from '../packages/zola-release/owned-six-read-overlay.js';
import {writeZolaActivationProfile} from '../packages/zola-release/activation-profile.js';
let journal,runtime,service;
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||!['--check','--issue'].includes(process.argv[2])||fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'')!==SUCCESSOR.root)fail();
 const mutate=process.argv[2]==='--issue',operatorSha=checkSuccessorSource();
 register('file://'+OWNED_SIX_READ.frozenRoot+'/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 const {openReleaseJournal}=await import(OWNED_SIX_READ.frozenRoot+'/packages/zola-release/commander-journal.js');
 const {openDenialSessionRuntime}=await import(RENEWAL.canonicalRoot+'/packages/zola-six-reads/denial-runtime.js');
 journal=openReleaseJournal();
 const recovery=await validateRecoveryBeforeIssuance(),config=recovery.config,stat=fs.lstatSync(config.databasePath),identity={dev:stat.dev,ino:stat.ino,uid:stat.uid};
 runtime=await openDenialSessionRuntime(RENEWAL.releaseSha);
 const absent=p=>{try{fs.lstatSync(p);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
 const roleFence=readSuccessorRoleProof;
 const roleProof=await roleFence(),profileDigest=hash(runtime.profile);
 const fence=async()=>{
  if(checkSuccessorSource()!==operatorSha||hash(await roleFence())!==hash(roleProof))fail();
  const current=await validateRecoveryBeforeIssuance();if(hash(current)!==hash(recovery))fail();
  const s=fs.lstatSync(config.databasePath);if(s.isSymbolicLink()||!s.isFile()||s.nlink!==1||(s.mode&0o007)||['dev','ino','uid'].some(k=>s[k]!==identity[k]))fail();
  if(!fs.readdirSync(`/proc/${config.apiPid}/fd`).some(n=>{try{const x=fs.statSync(`/proc/${config.apiPid}/fd/${n}`);return x.dev===identity.dev&&x.ino===identity.ino;}catch{return false;}}))fail();
  const p=runtime.profile;if(hash(p)!==profileDigest||p.context.apiPid!==config.apiPid||p.context.apiUid!==identity.uid||p.context.workspace!==config.workspace||p.context.releaseSha!==config.releaseSha)fail();
  await runtime.assertCurrent();runtime.assertHeld();
 };
 await fence();const eligibility=inspectSuccessorEligibility(config,identity);
 for(const suffix of ['-intent.json','-receipt.json','-result.json'])if(!absent(D.prefix+suffix))fail();
 const envBytes=fs.readFileSync(`/proc/${config.apiPid}/environ`);if(envBytes.length>262144)fail();const env=new Map(envBytes.toString().split('\0').map(s=>{const i=s.indexOf('=');return [s.slice(0,i),s.slice(i+1)];}));
 if(env.get('NODE_ENV')!=='production'||env.get('BLACKSPIRE_DB_PATH')!==config.databasePath||(env.get('BLACKSPIRE_OPERATOR_PRINCIPAL_ID')||env.get('BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID'))!==config.principal)fail();
 if(!mutate)process.stdout.write('OWNED_DENIAL_SUCCESSOR_PREFLIGHT_VERIFIED\n');
 else{
  const intent={version:1,kind:'owned-denial-collector-successor-intent',operatorSha,configDigest:RENEWAL.configDigest,operationId:RENEWAL.operationId,attemptId:RENEWAL.attemptId,runId:RENEWAL.runId,
   originalReceiptDigest:RENEWAL.originalReceiptDigest,priorIntentDigest:D.priorIntentDigest,priorReceiptDigest:D.priorReceiptDigest,priorResultDigest:D.priorResultDigest,priorSessionDigest:D.priorSessionDigest,
   priorOutcome:eligibility.outcome,profileDigest,terminalProofDigest:recovery.terminalProof.terminalProofDigest,roleProofDigest:hash(roleProof),createdAt:Date.now()};
  writeZolaActivationProfile(D.prefix+'-intent.json',intent);
  process.env.BLACKSPIRE_DB_PATH=config.databasePath;process.env.SESSION_TTL_MS='900000';service=await openSuccessorDenialService(config.databasePath);await fence();
  const result=service.issue({prior:eligibility.prior,config,identity,intent,terminalProof:recovery.terminalProof},receipt=>{runtime.assertHeld();writeZolaActivationProfile(D.prefix+'-receipt.json',receipt);});
  await fence();writeZolaActivationProfile(D.prefix+'-result.json',result.result);verifySuccessorDatabase(result.receipt,config,identity);
  process.stdout.write(JSON.stringify({status:'OWNED_DENIAL_SUCCESSOR_ISSUED',expiresAt:result.receipt.expiresAt,livePass:false})+'\n');
 }
}catch{process.stderr.write('Owned denial successor stopped. Retain every record; never retry or overwrite an issuance intent.\n');process.exitCode=1;}
finally{try{service?.close();}catch{process.exitCode=1;}try{runtime?.close();}catch{process.exitCode=1;}try{journal?.close();}catch{process.exitCode=1;}}
