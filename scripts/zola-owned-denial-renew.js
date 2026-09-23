import fs from 'node:fs';
import {register} from 'node:module';
import {RENEWAL,renewalHash,renewalFail,assertRenewalStart,openRenewalService} from '../packages/zola-six-reads/owned-denial-renewal.js';
import {readRenewalJson,checkRenewalSource,verifyRenewalDatabase,inspectOriginalRenewalDatabase} from '../packages/zola-six-reads/owned-denial-host.js';
import {writeZolaActivationProfile} from '../packages/zola-release/activation-profile.js';
import {OWNED_SIX_READ} from '../packages/zola-release/owned-six-read-overlay.js';
import {RELEASE_ADMISSION_ROOT} from '../packages/shared/release-admission.js';
let journal,runtime,service;
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==3||!['--check','--renew'].includes(process.argv[2]))renewalFail();
 const mutate=process.argv[2]==='--renew',operatorSha=checkRenewalSource();
 register('file://'+OWNED_SIX_READ.frozenRoot+'/packages/zola-release/owned-sequence-loader.js',import.meta.url);
 const {openReleaseJournal}=await import(OWNED_SIX_READ.frozenRoot+'/packages/zola-release/commander-journal.js');
 const {inspectReleaseSequenceHistory}=await import(OWNED_SIX_READ.frozenRoot+'/packages/zola-release/commander-sequence.js');
 const {openDenialSessionRuntime}=await import(RENEWAL.canonicalRoot+'/packages/zola-six-reads/denial-runtime.js');
 journal=openReleaseJournal();runtime=await openDenialSessionRuntime(RENEWAL.releaseSha);
 const config=readRenewalJson(RENEWAL.configPath),original=readRenewalJson(config.denialReceiptPath),identity=fs.lstatSync(config.databasePath);
 const dbIdentity={dev:identity.dev,ino:identity.ino,uid:identity.uid};
 const absent=file=>{try{fs.lstatSync(file);return false;}catch(e){if(e.code==='ENOENT')return true;throw e;}};
 const fence=async()=>{
  const events=journal.stream('release').events(),state=inspectReleaseSequenceHistory(events);
  const fresh=fs.lstatSync(config.databasePath);if(fresh.isSymbolicLink()||!fresh.isFile()||fresh.nlink!==1||(fresh.mode&0o007)||['dev','ino','uid'].some(k=>fresh[k]!==dbIdentity[k]))renewalFail();
  if(renewalHash(readRenewalJson(RENEWAL.configPath))!==renewalHash(config)||renewalHash(readRenewalJson(config.denialReceiptPath))!==renewalHash(original))renewalFail();
  const directory=fs.lstatSync(config.journalDirectory);
  if(!directory.isDirectory()||directory.isSymbolicLink()||directory.uid!==0||(directory.mode&0o7777)!==0o700)renewalFail();
  assertRenewalStart({config,original,state,events,collectorEmpty:fs.readdirSync(config.journalDirectory).length===0,
   permitAbsent:['premerge-reads-secret.json','premerge-reads.json','premerge-reads-active.json'].every(n=>absent(RELEASE_ADMISSION_ROOT+'/'+n))});
  const p=runtime.profile;
  if(p.context.apiPid!==config.apiPid||p.context.apiUid!==dbIdentity.uid||p.context.workspace!==config.workspace||p.context.releaseSha!==config.releaseSha)renewalFail();
  checkRenewalSource(operatorSha);await runtime.assertCurrent();runtime.assertHeld();return state;
 };
 const state=await fence();inspectOriginalRenewalDatabase(original,config,dbIdentity);
 for(const suffix of ['-intent.json','-receipt.json','-result.json'])if(!absent(RENEWAL.prefix+suffix))renewalFail();
 const envBytes=fs.readFileSync(`/proc/${config.apiPid}/environ`);if(envBytes.length>262144)renewalFail();
 const env=new Map(envBytes.toString().split('\0').map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];}));
 if(env.get('NODE_ENV')!=='production'||env.get('BLACKSPIRE_DB_PATH')!==config.databasePath||(env.get('BLACKSPIRE_OPERATOR_PRINCIPAL_ID')||env.get('BLACKSPIRE_EVALUATION_ADMIN_PRINCIPAL_ID'))!==config.principal)renewalFail();
 if(!fs.readdirSync(`/proc/${config.apiPid}/fd`).some(n=>{try{const s=fs.statSync(`/proc/${config.apiPid}/fd/${n}`);return s.dev===identity.dev&&s.ino===identity.ino;}catch{return false;}}))renewalFail();
 if(!mutate){process.stdout.write('OWNED_DENIAL_RENEWAL_PREFLIGHT_VERIFIED\n');}
 else{
  const intent={version:1,kind:'owned-denial-renewal-intent',operatorSha,originalOutcome:RENEWAL.originalOutcome,configDigest:RENEWAL.configDigest,originalReceiptDigest:RENEWAL.originalReceiptDigest,
   operationId:RENEWAL.operationId,attemptId:RENEWAL.attemptId,inputDigest:state.pending.inputDigest,checkOutputDigest:state.pending.checkOutputDigest,
   profileDigest:renewalHash(runtime.profile),createdAt:Date.now()};
  writeZolaActivationProfile(RENEWAL.prefix+'-intent.json',intent);
  process.env.BLACKSPIRE_DB_PATH=config.databasePath;process.env.SESSION_TTL_MS='900000';
  service=await openRenewalService(config.databasePath);await fence();
  const receipt=service.issue({original,config,identity:dbIdentity,intent},r=>{runtime.assertHeld();writeZolaActivationProfile(RENEWAL.prefix+'-receipt.json',r);});
  await fence();
  writeZolaActivationProfile(RENEWAL.prefix+'-result.json',{version:1,kind:'owned-denial-renewal-result',intentDigest:renewalHash(intent),receiptDigest:renewalHash(receipt),expiresAt:receipt.expiresAt});
  verifyRenewalDatabase(receipt,config,dbIdentity);
  process.stdout.write(JSON.stringify({status:'OWNED_DENIAL_RENEWED',expiresAt:receipt.expiresAt,livePass:false})+'\n');
 }
}catch{process.stderr.write('Owned denial renewal stopped. Retain every record; do not retry or overwrite.\n');process.exitCode=1;}
finally{try{service?.close();}catch{process.exitCode=1;}try{runtime?.close();}catch{process.exitCode=1;}try{journal?.close();}catch{process.exitCode=1;}}
