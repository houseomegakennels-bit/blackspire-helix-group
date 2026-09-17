import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';
import {observeBuyerWriterProductionState} from './production-verifier.js';
import {writeBuyerWriterProvisioningJournal} from './production-provisioning-journal.js';

export const BUYER_WRITER_GATEWAY_CONFIGURATION='/etc/blackspire-buyer-writer-gateway/gateway.json';
export const BUYER_WRITER_INSTALLER_SHA256='082260b9d8dd0e7cf5a1095ea5b4335c766b9a6ae5d305abaf6b76b3d3ad806c';
export const BUYER_WRITER_PROVISIONING_LOCK=Object.freeze([206994,127]);

const INSTALLER=fileURLToPath(new URL('./sql/install.sql',import.meta.url));
const HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const fail=()=>{throw new Error('Buyer writer production provisioning failed');};
const exact=(value,keys,optional=[])=>value&&typeof value==='object'&&!Array.isArray(value)
  &&keys.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>[...keys,...optional].includes(key));
const validPassword=value=>typeof value==='string'&&value.length>=1&&value.length<=1024&&!value.includes('\0');

// This deliberately exposes only whether a verifier exists, never a verifier,
// credential, connection string, CA body or protected filename.
const ROLE_READINESS_SQL=`select coalesce(jsonb_agg(jsonb_build_object(
 'name',wanted.name,'exists',r.oid is not null,'login',coalesce(r.rolcanlogin,false),
 'inherit',coalesce(r.rolinherit,false),
 'superuser',coalesce(r.rolsuper,false),'createDb',coalesce(r.rolcreatedb,false),
 'createRole',coalesce(r.rolcreaterole,false),'replication',coalesce(r.rolreplication,false),
 'bypassRls',coalesce(r.rolbypassrls,false)) order by wanted.name),'[]'::jsonb) as roles
from (values ('buyer_writer_issuer'),('buyer_writer_owner'),('buyer_writer_runtime')) wanted(name)
left join pg_roles r on r.rolname=wanted.name`;

const SESSION_IDENTITY_SQL=`select current_user as actor,current_database() as database,r.oid::int as "creatorOid",
 current_setting('server_version_num')::int as version,
 r.rolsuper as superuser,r.rolcreatedb as "createDb",r.rolcreaterole as "createRole",
 r.rolreplication as replication,r.rolbypassrls as "bypassRls"
from pg_roles r where r.rolname=current_user`;
const ACQUIRE_LOCK_SQL=`select pg_try_advisory_lock(${BUYER_WRITER_PROVISIONING_LOCK[0]},${BUYER_WRITER_PROVISIONING_LOCK[1]}) as acquired`;
const RELEASE_LOCK_SQL=`select pg_advisory_unlock(${BUYER_WRITER_PROVISIONING_LOCK[0]},${BUYER_WRITER_PROVISIONING_LOCK[1]}) as released`;
const FAIL_CLOSED_SQL=`do $blackspire_fail_closed$ begin
 if exists(select from pg_roles where rolname='buyer_writer_owner') then
  alter role buyer_writer_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password null;
 end if;
 if exists(select from pg_roles where rolname='buyer_writer_runtime') then
  alter role buyer_writer_runtime nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
 if exists(select from pg_roles where rolname='buyer_writer_issuer') then
  alter role buyer_writer_issuer nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
 end if;
end $blackspire_fail_closed$`;
const LOGIN_DISABLED_SQL=`select count(*)::int as count from pg_roles
 where rolname in('buyer_writer_runtime','buyer_writer_issuer') and rolcanlogin`;
const CREATE_BINDER_SQL=`create or replace function pg_temp.blackspire_bind_buyer_writer_password(role_name name,secret text)
returns void language plpgsql set search_path=pg_catalog as $blackspire_binder$
begin
 if role_name::text not in ('buyer_writer_runtime','buyer_writer_issuer') or secret is null or octet_length(secret) not between 1 and 1024 then
  raise exception 'Buyer writer credential binding rejected';
 end if;
 begin
  execute format('alter role %I password %L',role_name,secret);
 exception when others then
  raise exception using errcode='P0001',message='Buyer writer credential binding rejected';
 end;
end $blackspire_binder$`;
const LOGGING_SAFETY_SQL=`select current_setting('log_statement')='none'
 and current_setting('log_duration')='off'
 and current_setting('log_min_duration_statement')='-1'
 and current_setting('log_min_duration_sample')='-1'
 and current_setting('log_transaction_sample_rate')::numeric=0
 and current_setting('log_parameter_max_length_on_error')='0'
 and coalesce(current_setting('pgaudit.log_parameter',true),'off')='off'
 and not (regexp_split_to_array(lower(coalesce(current_setting('pgaudit.log',true),'none')),'[ ,]+') && array['all','role']) as safe`;

function gatewayGroupId(lookup){
 try{
  const raw=lookup(),parts=raw.trim().split(':');
  if(parts.length!==4||parts[0]!=='blackspire-writer'||!/^[1-9][0-9]{0,9}$/.test(parts[2]))fail();
  return Number(parts[2]);
 }catch{fail();}
}

function validateGatewaySnapshot(snapshot){
 try{
  const config=validateBuyerWriterGatewayServiceConfiguration(snapshot.value);
  if(snapshot.identity.uid!==0||(snapshot.identity.mode&0o7777)!==0o640
    ||config.workspace!=='blackspire-command'||config.runtime?.host!==HOST||config.issuer?.host!==HOST)fail();
  for(const value of [config.runtime,config.issuer]){
    if(!exact(value,['host','port','database','password'],['ca'])||value.port!==5432||value.database!=='postgres'
      ||!validPassword(value.password)||typeof value.ca!=='string'||value.ca.length>16384
      ||!value.ca.startsWith('-----BEGIN CERTIFICATE-----'))fail();
  }
  if(config.runtime.password===config.issuer.password||config.runtime.ca!==config.issuer.ca)fail();
  return config;
 }catch{fail();}
}

function validateManagementSnapshot(snapshot,gateway){
 try{
  const value=snapshot.value;
  if(snapshot.identity.uid!==0||snapshot.identity.gid!==0||(snapshot.identity.mode&0o7777)!==0o600
    ||!exact(value,['host','password','ca'])||value.host!==gateway.runtime.host||!validPassword(value.password)
    ||value.password===gateway.runtime.password||value.password===gateway.issuer.password
    ||value.ca!==gateway.runtime.ca)fail();
  return value;
 }catch{fail();}
}

function sameSnapshot(left,right){
  try{
    for(const key of ['uid','gid','mode','nlink','size','dev','ino','mtimeMs','ctimeMs'])if(left.identity[key]!==right.identity[key])return false;
    const same=(a,b)=>{
      if(a===b)return true;
      if(!a||!b||typeof a!=='object'||typeof b!=='object'||Array.isArray(a)!==Array.isArray(b))return false;
      const aKeys=Object.keys(a),bKeys=Object.keys(b);
      return aKeys.length===bKeys.length&&aKeys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
    };
    return same(left.value,right.value);
 }catch{return false;}
}

function installerBytes(io){
  try{
    const bytes=io.readFileSync(INSTALLER);
    if(createHash('sha256').update(bytes).digest('hex')!==BUYER_WRITER_INSTALLER_SHA256
      ||!bytes.subarray(0,6).equals(Buffer.from('-- Exp'))||!bytes.toString('utf8').endsWith('commit;\n'))fail();
    return bytes.toString('utf8');
  }catch{fail();}
}

async function identityAndLock(client,creatorOid){
  const identity=await client.query(SESSION_IDENTITY_SQL,[]),actor=identity.rows?.[0];
  if(identity.rows?.length!==1||actor.actor!=='postgres'||actor.database!=='postgres'||actor.version<170000||actor.version>=180000
    ||actor.creatorOid!==creatorOid
    ||actor.superuser!==false||actor.createRole!==true||actor.createDb!==true||actor.replication!==true||actor.bypassRls!==true)fail();
  const lock=await client.query(ACQUIRE_LOCK_SQL,[]);
  if(lock.rows?.length!==1||lock.rows[0]?.acquired!==true)fail();
}

async function readiness(client){
  const result=await client.query(ROLE_READINESS_SQL,[]),roles=result.rows?.[0]?.roles;
  if(!Array.isArray(roles)||roles.length!==3||roles.some(role=>!exact(role,
    ['name','exists','login','inherit','superuser','createDb','createRole','replication','bypassRls'])))fail();
  return roles;
}

async function verified(client,creatorOid){
  return observeBuyerWriterProductionState((text,values)=>client.query(text,values),creatorOid);
}

async function closeClient(client){
  try{await client?.query(RELEASE_LOCK_SQL,[]);}catch{}
  try{await client?.end();}catch{}
}

async function disableLogins({connect,management,creatorOid,onLocked,onDisabled}){
  for(let attempt=0;attempt<2;attempt++){
    let client,began=false,commitSent=false;
    try{
      client=await connect(management);await identityAndLock(client,creatorOid);onLocked?.();
      await client.query('begin');began=true;
      await client.query("set local search_path=pg_catalog; set local lock_timeout='5s'; set local statement_timeout='15s'");
      await client.query(FAIL_CLOSED_SQL,[]);
      commitSent=true;await client.query('commit');began=false;
      const observed=await client.query(LOGIN_DISABLED_SQL,[]);
      if(observed.rows?.length!==1||observed.rows[0]?.count!==0)fail();
      onDisabled?.();
      return Object.freeze({status:'LOGIN_DISABLED',rollbackSafe:true});
    }catch{
      if(began&&!commitSent)try{await client.query('rollback');}catch{}
    }finally{await closeClient(client);}
  }
  const error=new Error('Buyer writer production fail-closed rollback unverified');error.rollbackSafe=false;throw error;
}

function sanitizedInspection(roles,evidence){
  return Object.freeze({status:evidence?'COMPLIANT':'NONCOMPLIANT',compliant:Boolean(evidence),roles:roles.map(role=>Object.freeze({...role})),
    ...(evidence?{unexpectedMembershipCount:evidence.unexpectedMembershipCount,directTableAccessDenied:evidence.directTableAccessDenied,
      targetTablePublicPrivilegeCount:evidence.targetTablePublicPrivilegeCount,
      targetColumnPublicPrivilegeCount:evidence.targetColumnPublicPrivilegeCount,
      crossRoutineAccessDenied:evidence.crossRoutineAccessDenied,pgNetTruth:evidence.pgNetTruth}:{})});
}

// connect receives already validated management material and must return a
// dedicated pg Client. The command wrapper supplies the only production
// implementation; injection exists for deterministic, credential-free tests.
export async function provisionBuyerWriterProduction({mode,managementConfigPath,
  gatewayConfigPath=BUYER_WRITER_GATEWAY_CONFIGURATION,readSnapshot=readRootOwnedJsonSnapshot,
  lookupWriterGroup,connect,authenticate,writeJournal=writeBuyerWriterProvisioningJournal,io=fs}={}){
  if(!['inspect','apply','reconcile','verify','rollback'].includes(mode)||typeof connect!=='function'||typeof authenticate!=='function'
    ||gatewayConfigPath!==BUYER_WRITER_GATEWAY_CONFIGURATION||typeof managementConfigPath!=='string')fail();
  let groupId;
  try{groupId=gatewayGroupId(lookupWriterGroup);}catch{fail();}
  let gatewaySnapshot,gateway,managementSnapshot,management;
  try{
    gatewaySnapshot=readSnapshot(gatewayConfigPath,{groupId,maxBytes:65536});
    gateway=validateGatewaySnapshot(gatewaySnapshot);
    managementSnapshot=readSnapshot(managementConfigPath,{groupId:0,maxBytes:65536});
    management=validateManagementSnapshot(managementSnapshot,gateway);
  }catch{fail();}
  const operationId=randomUUID();
  const journalMode=mode;
  const journal=(phase,status)=>writeJournal({version:1,kind:'buyer_writer_production_provisioning',operationId,
    installerSha256:BUYER_WRITER_INSTALLER_SHA256,mode:journalMode,phase,status,updatedAt:new Date().toISOString()});
  if(mode==='rollback'){
    let journalFailed=false;
    const safeJournal=(phase,status)=>{try{journal(phase,status);}catch{journalFailed=true;}};
    const result=await disableLogins({connect,management,creatorOid:gateway.creatorOid,onLocked:()=>safeJournal('started','IN_PROGRESS'),
      onDisabled:()=>safeJournal('roles-disabled','IN_PROGRESS')});
    safeJournal('rollback-complete','COMPLETED');
    if(journalFailed){const error=new Error('Buyer writer production rollback completed without durable journal');error.rollbackSafe=true;throw error;}
    return result;
  }

  let client,mutationStarted=false;
  try{
    client=await connect(management);await identityAndLock(client,gateway.creatorOid);
    mutationStarted=mode!=='inspect';
    const recheckSnapshots=()=>{
      const gatewayAgain=readSnapshot(gatewayConfigPath,{groupId,maxBytes:65536});
      const managementAgain=readSnapshot(managementConfigPath,{groupId:0,maxBytes:65536});
      validateGatewaySnapshot(gatewayAgain);validateManagementSnapshot(managementAgain,gateway);
      if(!sameSnapshot(gatewaySnapshot,gatewayAgain)||!sameSnapshot(managementSnapshot,managementAgain))fail();
    };
    const roles=await readiness(client);
    let evidence=null;
    try{evidence=await verified(client,gateway.creatorOid);}catch{}
    if(mode==='inspect'){
      if(evidence)try{
        await authenticate('runtime',gateway.runtime);await authenticate('issuer',gateway.issuer);
        recheckSnapshots();
      }catch{evidence=null;}
      return sanitizedInspection(roles,evidence);
    }
    if(mode==='verify'){
      if(!evidence)fail();
      await authenticate('runtime',gateway.runtime);await authenticate('issuer',gateway.issuer);
      recheckSnapshots();mutationStarted=false;return sanitizedInspection(roles,evidence);
    }
    if(evidence){
      try{
        await authenticate('runtime',gateway.runtime);await authenticate('issuer',gateway.issuer);
        recheckSnapshots();mutationStarted=false;return Object.freeze({status:'ALREADY_COMPLIANT',idempotent:true,evidence});
      }catch{
        if(mode!=='reconcile'){journal('started','IN_PROGRESS');fail();}
        evidence=null;
      }
    }

    // Never interpret an existing verifier as the protected password. A
    // credentialed or previously enabled partial installation requires an
    // explicitly reviewed rotation/reconciliation path, not silent rotation.
    journal('started','IN_PROGRESS');
    if(mode==='apply'&&roles.some(role=>role.exists))fail();
    await client.query('begin');
    await client.query("set local search_path=pg_catalog; set local lock_timeout='5s'; set local statement_timeout='15s'");
    await client.query(FAIL_CLOSED_SQL,[]);
    await client.query('commit');
    journal('roles-disabled','IN_PROGRESS');

    // The canonical installer owns this transaction byte-for-byte. It leaves
    // every created role NOLOGIN, so the explicit phase boundary is fail-closed.
    await client.query("select set_config('blackspire.buyer_writer_creator_oid',$1,false)",[String(gateway.creatorOid)]);
    await client.query(installerBytes(io));
    journal('installer-committed','IN_PROGRESS');
    const installed=await readiness(client);
    if(installed.some(role=>!role.exists||role.login))fail();

    let began=false,commitSent=false;
    try{
      await client.query('begin');began=true;
      journal('credential-transaction-started','IN_PROGRESS');
      await client.query("set local search_path=pg_catalog; set local lock_timeout='5s'; set local statement_timeout='30s'; set local password_encryption='scram-sha-256'; set local log_parameter_max_length_on_error=0");
      const logging=await client.query(LOGGING_SAFETY_SQL,[]);
      if(logging.rows?.length!==1||logging.rows[0]?.safe!==true)fail();
      await client.query(CREATE_BINDER_SQL,[]);
      await client.query('select pg_temp.blackspire_bind_buyer_writer_password($1::name,$2::text)',['buyer_writer_runtime',gateway.runtime.password]);
      await client.query('select pg_temp.blackspire_bind_buyer_writer_password($1::name,$2::text)',['buyer_writer_issuer',gateway.issuer.password]);
      await client.query("alter role buyer_writer_owner nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls password null; alter role buyer_writer_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls; alter role buyer_writer_issuer login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls");
      const finalEvidence=await verified(client,gateway.creatorOid);
      recheckSnapshots();
      commitSent=true;await client.query('commit');began=false;
      await client.query('begin read only');
      const committedEvidence=await verified(client,gateway.creatorOid);
      await client.query('rollback');
      await authenticate('runtime',gateway.runtime);await authenticate('issuer',gateway.issuer);
      recheckSnapshots();
      if(finalEvidence.compliant!==true)fail();
      journal('verified-committed','COMPLETED');
      return Object.freeze({status:'PROVISIONED',idempotent:false,evidence:committedEvidence});
    }catch{
      if(began&&!commitSent)try{await client.query('rollback');}catch{}
      throw new Error('Buyer writer credential transaction failed');
    }
  }catch{
    await closeClient(client);client=null;
    if(mutationStarted){
      const safeJournal=(phase,status)=>{try{journal(phase,status);}catch{}};
      try{await disableLogins({connect,management,creatorOid:gateway.creatorOid,onLocked:()=>safeJournal('started','IN_PROGRESS'),
        onDisabled:()=>safeJournal('roles-disabled','IN_PROGRESS')});}
      catch(error){safeJournal('failed','FAILED');throw error;}
      safeJournal('fail-closed','FAIL_CLOSED');
    }
    fail();
  }finally{await closeClient(client);}
}
