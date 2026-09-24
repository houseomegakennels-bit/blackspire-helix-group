import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createBuyerStoreProtectedFiles} from './protected-files.js';
import {provisionBuyerStore} from './provision.js';
import {provisionBuyerStoreSchema,BUYER_STORE_SCHEMA_SHA256} from './schema-provision.js';
import {verifyReleaseSource} from '../zola-release/commander-host.js';
import {databaseProfileDigest,databaseTlsOptions,verifyOwnedDatabaseIdentity} from '../buyer-writer/database-profile.js';
import {fail} from './local-protocol.js';
const ROOT='/var/lib/blackspire-operator/buyer-store/initial';
const UNIT='/etc/systemd/system/blackspire-buyer-store.service';
const API_DROPIN='/etc/systemd/system/blackspire-command.service.d/buyer-store-ipc.conf';
const STORE='blackspire-buyer-store',IPC='blackspire-buyer-store-client';
const hash=v=>createHash('sha256').update(v).digest('hex');
const dropin=Buffer.from('[Service]\nSupplementaryGroups=blackspire-buyer-store-client\n');
function command(file,args,{absent=false}={}){const r=spawnSync(file,args,{encoding:'utf8',timeout:10000,maxBuffer:8192,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});if(r.error||r.signal||r.stderr!==''||r.status!==0&&!(absent&&r.status===2&&r.stdout===''))fail();return r.status===2?null:r.stdout.trim();}
export function createBuyerStoreIdentityPreparer({files,run=command,root=ROOT}={}){
 const getGroup=name=>{const output=run('/usr/bin/getent',['group',name],{absent:true});if(output===null)return null;const row=output.split(':');if(row.length!==4||row[0]!==name||!/^[1-9][0-9]*$/.test(row[2])||row[3]!=='')fail();return Number(row[2]);};
 const getUser=()=>{const output=run('/usr/bin/getent',['passwd',STORE],{absent:true});if(output===null)return null;const row=output.split(':');if(row.length!==7||row[0]!==STORE||!/^[1-9][0-9]*$/.test(row[2])||row[3]!==String(getGroup(STORE))||row[5]!=='/nonexistent'||row[6]!=='/usr/sbin/nologin')fail();return Number(row[2]);};
 const ensure=async(name,observe,file,args)=>{const intent=root+'/'+name+'.intent.json',result=root+'/'+name+'.result.json',before=observe(),prior=files.value(intent,true);if(prior&&JSON.stringify(prior)!==JSON.stringify({version:1,name,file,args}))fail();if(before===null){if(prior)fail();files.record(intent,{version:1,name,file,args});run(file,args);}const actual=observe();if(actual===null)fail();files.record(result,{version:1,name,id:actual});return actual;};
 return async()=>{
  files.directory(root,{create:true});
  const store=await ensure('store-group',()=>getGroup(STORE),'/usr/sbin/groupadd',['--system',STORE]);
  const ipc=await ensure('ipc-group',()=>getGroup(IPC),'/usr/sbin/groupadd',['--system',IPC]);if(store===ipc)fail();
  const user=await ensure('store-user',getUser,'/usr/sbin/useradd',['--system','--gid',STORE,'--home-dir','/nonexistent','--no-create-home','--shell','/usr/sbin/nologin',STORE]);
  const memberships=run('/usr/bin/id',['-G',STORE]).split(/\s+/).map(Number);if(memberships.length!==1||memberships[0]!==store)fail();
  for(const principal of ['blackspire-api','blackspire-worker']){const groups=run('/usr/bin/id',['-G',principal]).split(/\s+/).map(Number);if(groups.includes(store)||groups.includes(ipc))fail();}
  return {user,store,ipc};
 };
}
async function connect(config){const {Client}=await import('pg');const client=new Client({...config,ssl:databaseTlsOptions(config),connectionTimeoutMillis:3000,query_timeout:20000});client.on('error',()=>{});try{await client.connect();return client;}catch{await client.end().catch(()=>{});fail();}}
// One root entrypoint. All setup runs inside the same global guard as password provisioning.
export async function prepareInitialBuyerStore(releaseSha,operationId,deps={}){
 if(!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(operationId??'')||(deps.uid??process.getuid)()!==0||!/^[a-f0-9]{40}$/.test(releaseSha))fail();
 const files=deps.files??createBuyerStoreProtectedFiles(),verify=deps.verifySource??verifyReleaseSource;
 const prepareHost=async({profile,credential,artifact,fence})=>{
  verify(releaseSha);await fence();files.directory(ROOT,{create:true});
  const binding={releaseSha,operationId,profileDigest:databaseProfileDigest(profile),artifactDigest:artifact.artifactDigest,schemaDigest:BUYER_STORE_SCHEMA_SHA256};
  files.record(ROOT+'/binding.json',binding);
  // This observer must read the retained owned-copy/hardening proof and CURRENT database restrictions.
  await (deps.verifyHardening??(await import('../buyer-writer/owned-target-hardening-host.js')).verifyOwnedTargetHardeningForStore)({releaseSha,operationId,profile});
  await (deps.prepareVerifier??(await import('./verifier-preparation.js')).prepareBuyerStoreVerifier)({releaseSha,profile});await fence();
  await (deps.identities??createBuyerStoreIdentityPreparer({files}))();await fence();
  const unit=fs.readFileSync(new URL('../../ops/runtime-ownership/blackspire-buyer-store.service',import.meta.url));
  const retainedUnit=fs.readFileSync('/opt/blackspire-command/releases/'+releaseSha+'/ops/runtime-ownership/blackspire-buyer-store.service');if(!unit.equals(retainedUnit))fail();
  files.record(ROOT+'/unit.json',{version:1,releaseSha,sha256:hash(unit),apiDropinSha256:hash(dropin)});
  files.directory('/etc/systemd/system');files.directory('/etc/systemd/system/blackspire-command.service.d',{create:true,mode:0o755});
  files.publish(UNIT,unit,{mode:0o644});files.publish(API_DROPIN,dropin,{mode:0o644});
  const client=await (deps.connect??connect)(credential);
  try{await provisionBuyerStoreSchema({client,binding,fence,verifyIdentity:async()=>{await verifyOwnedDatabaseIdentity(client,profile);const r=await client.query('SELECT session_user AS session');if(r.rows?.length!==1||r.rows[0].session!=='postgres')fail();},journal:{intent:()=>files.value(ROOT+'/schema-intent.json',true),writeIntent:v=>files.record(ROOT+'/schema-intent.json',v),result:v=>files.record(ROOT+'/schema-result.json',v)}});}finally{await client.end();}
  await fence();(deps.run??command)('/usr/bin/systemctl',['daemon-reload']);
  const observed=(deps.run??command)('/usr/bin/systemctl',['show','--property=User,Group,SupplementaryGroups,NeedDaemonReload','--', 'blackspire-command.service']);
  const state=Object.fromEntries(observed.split('\n').map(row=>row.split('=')));if(state.User!=='blackspire-api'||state.Group!=='blackspire'||state.NeedDaemonReload!=='no'||!state.SupplementaryGroups.split(/\s+/).includes(IPC)||state.SupplementaryGroups.split(/\s+/).includes(STORE))fail();
  await fence();verify(releaseSha);
 };
 return (deps.provision??provisionBuyerStore)(releaseSha,{prepareHost});
}
