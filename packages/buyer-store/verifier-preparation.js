import {execFileSync} from 'node:child_process';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {LEGACY_DATABASE_MANAGEMENT,validateManagementCredential,databaseTlsOptions} from '../buyer-writer/database-profile.js';
import {createBuyerStoreProtectedFiles} from './protected-files.js';
import {fail} from './local-protocol.js';
const TARGET='/var/lib/blackspire-operator/writer-acceptance.json';
export const BUYER_STORE_PUBLIC_KEY_INPUT='/var/lib/blackspire-operator/preparation/buyer-store-public-key.json';
export const BUYER_STORE_VERIFIER_OUTPUT='/var/lib/blackspire-operator/preparation/buyer-store-verifier.json';
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
async function connect(config){const {Client}=await import('pg');const c=new Client({...config,ssl:databaseTlsOptions(config),connectionTimeoutMillis:3000,query_timeout:5000,options:'-c default_transaction_read_only=on -c statement_timeout=4000'});c.on('error',()=>{});try{await c.connect();return c;}catch{await c.end().catch(()=>{});fail();}}
export async function prepareBuyerStoreVerifier({profile},deps={}){
 const read=deps.readSnapshot??readRootOwnedJsonSnapshot,files=deps.files??createBuyerStoreProtectedFiles();
 const gid=deps.apiGroup??Number(execFileSync('/usr/bin/getent',['group','blackspire-api'],{encoding:'utf8',timeout:1000,maxBuffer:4096}).trim().split(':')[2]);if(!Number.isInteger(gid)||gid<=0)fail();
 const target=read(TARGET,{groupId:gid}),key=read(BUYER_STORE_PUBLIC_KEY_INPUT,{groupId:0}),credential=read(LEGACY_DATABASE_MANAGEMENT,{groupId:0});
 if(key.identity.uid!==0||key.identity.gid!==0||(key.identity.mode&0o7777)!==0o600||Object.keys(key.value).sort().join(',')!=='projectRef,publicKey,version'||key.value.version!==1||key.value.projectRef!=='kchtrvfcixnimvxxctkj'||typeof key.value.publicKey!=='string'||!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key.value.publicKey))fail();
 const v=target.value;if(v.schema!==1||v.kind!=='zola_bounded_writer_acceptance_target'||v.releaseSha!=='7bd0323e09a221a21db92ba6853a4fe33bb36732'||v.workspace!=='blackspire-command'||v.principal!=='blackspire-release-root'||v.capability!=='buyer.writer.acceptance'||!uuid(v.ownerId)||!uuid(v.jobId))fail();
 const connection=(deps.validateCredential??validateManagementCredential)(credential.value,{pinLegacyCa:true});
 const client=await (deps.connect??connect)(connection);let began=false;
 try{
  await client.query('BEGIN READ ONLY');began=true;
  const observed=await client.query(`SELECT current_user='postgres' AND session_user='postgres' AND current_database()='postgres'
   AND (SELECT system_identifier::text FROM pg_control_system())<>$3
   AND EXISTS(SELECT FROM auth.users WHERE id=$1::uuid)
   AND EXISTS(SELECT FROM public."SearchJob" WHERE id=$2::uuid AND user_id=$1::uuid) AS valid`,[v.ownerId,v.jobId,profile.systemIdentifier]);
  if(observed.rows?.length!==1||observed.rows[0].valid!==true)fail();
  if(!same(read(TARGET,{groupId:gid}),target)||!same(read(BUYER_STORE_PUBLIC_KEY_INPUT,{groupId:0}),key)||!same(read(LEGACY_DATABASE_MANAGEMENT,{groupId:0}),credential))fail();
  await client.query('ROLLBACK');began=false;files.record(BUYER_STORE_VERIFIER_OUTPUT,{publicKey:key.value.publicKey,operatorOwnerId:v.ownerId});
  return {status:'BUYER_STORE_VERIFIER_PREPARED'};
 }finally{if(began)await client.query('ROLLBACK').catch(()=>{});await client.end();}
}
