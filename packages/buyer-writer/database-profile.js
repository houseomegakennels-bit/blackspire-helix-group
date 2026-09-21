import {checkServerIdentity} from 'node:tls';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {validateOwnedPostgresProfile,ownedPostgresProfileDigest} from './owned-postgres.js';
export {validateOwnedPostgresProfile as validateOwnedDatabaseProfile,ownedPostgresProfileDigest as databaseProfileDigest};
export const OWNED_DATABASE_PROFILE='/etc/blackspire/owned-postgres/profile.json';
export const OWNED_DATABASE_MANAGEMENT='/etc/blackspire/owned-postgres/management.json';
export const LEGACY_DATABASE_MANAGEMENT='/etc/blackspire-buyer-writer-gateway/management.json';
export const LEGACY_DATABASE_HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
export const LEGACY_DATABASE_CA_SHA256='700723581420dd1ac98fd7e9ac529f0ef210eadcaf87fc868a3ad7d114c2f3b7';
const fail=()=>{throw new Error('Database backend profile rejected');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const digest=value=>createHash('sha256').update(value).digest('hex');
const pem=value=>typeof value==='string'&&value.length<=16384&&value.startsWith('-----BEGIN CERTIFICATE-----');
export function ownedDatabaseConnection(value){return value?.backendProfile==='owned-postgres-v1';}
// Shape-only validation is usable in the gateway trust zone. Root adapters must
// additionally bind this shape to the protected descriptor before connecting.
export function validateOwnedConnectionShape(value){
 if(!ownedDatabaseConnection(value)||value.host!=='127.0.0.1'||value.port!==55432||value.database!=='postgres'
  ||!/^[a-f0-9]{64}$/.test(value.profileDigest??'')||!pem(value.ca))fail();return value;
}
export function readOwnedDatabaseProfile({readSnapshot=readRootOwnedJsonSnapshot}={}){
 const first=readSnapshot(OWNED_DATABASE_PROFILE,{groupId:0,maxBytes:16384});
 if(first.identity.uid!==0||first.identity.gid!==0||(first.identity.mode&0o7777)!==0o600)fail();
 const profile=validateOwnedPostgresProfile(first.value),second=readSnapshot(OWNED_DATABASE_PROFILE,{groupId:0,maxBytes:16384});
 if(JSON.stringify(first)!==JSON.stringify(second))fail();return profile;
}
export function validateDatabaseTarget(value,{ownedProfile,pinLegacyCa=false}={}){
 if(ownedDatabaseConnection(value)){
  validateOwnedConnectionShape(value);const profile=validateOwnedPostgresProfile(ownedProfile);
  if(value.profileDigest!==ownedPostgresProfileDigest(profile)||digest(value.ca)!==profile.caSha256)fail();
 }else if(value?.backendProfile!==undefined||value?.profileDigest!==undefined||value?.host!==LEGACY_DATABASE_HOST
  ||value.port!==5432||value.database!=='postgres'||!pem(value.ca)||pinLegacyCa&&digest(value.ca)!==LEGACY_DATABASE_CA_SHA256)fail();
 return value;
}
export function validateManagementCredential(value,{ownedProfile,pinLegacyCa=false}={}){
 if(!value||typeof value.password!=='string'||value.password.length<1||value.password.length>4096||value.password.includes('\0')||!pem(value.ca))fail();
 if(ownedDatabaseConnection(value)){
  if(!exact(value,['backendProfile','profileDigest','host','password','ca']))fail();
  const profile=validateOwnedPostgresProfile(ownedProfile);
  validateDatabaseTarget({...value,port:55432,database:'postgres'},{ownedProfile:profile});
  return Object.freeze({host:profile.host,port:profile.port,database:profile.database,user:profile.managementUser,password:value.password,ca:value.ca});
 }
 if(!exact(value,['host','password','ca']))fail();
 validateDatabaseTarget({...value,port:5432,database:'postgres'},{pinLegacyCa});
 return Object.freeze({host:value.host,port:5432,database:'postgres',user:'postgres',password:value.password,ca:value.ca});
}
export function managementPathFor(target){
 if(ownedDatabaseConnection(target))return OWNED_DATABASE_MANAGEMENT;
 if(target?.backendProfile!==undefined||target?.profileDigest!==undefined||target?.host!==LEGACY_DATABASE_HOST)fail();return LEGACY_DATABASE_MANAGEMENT;
}
// System identifier is read from the server, never inferred from host/CA. The
// bootstrap grants only this diagnostic to the bounded management role.
export const OWNED_DATABASE_IDENTITY_SQL=`select (pg_control_system()).system_identifier::text as "systemIdentifier",current_database() as database,current_user as actor,(select oid::int from pg_roles where rolname=current_user) as "creatorOid",current_setting('server_version_num')::int as version,pg_is_in_recovery() as recovery`;
export async function verifyOwnedDatabaseIdentity(client,profile){
 profile=validateOwnedPostgresProfile(profile);const result=await client.query(OWNED_DATABASE_IDENTITY_SQL,[]),row=result?.rows?.[0];
 if(result?.rows?.length!==1||!exact(row,['systemIdentifier','database','actor','creatorOid','version','recovery'])
  ||row.systemIdentifier!==profile.systemIdentifier||row.database!==profile.database||row.actor!==profile.managementUser||row.creatorOid!==profile.creatorOid
  ||!Number.isInteger(row.version)||row.version<170000||row.version>=180000||row.recovery!==false)fail();return true;
}

// pg omits SNI for an IP host. Preserve CA verification and bind certificate
// identity to the fixed validated IP instead of Node's implicit localhost.
export function databaseTlsOptions(connection){
 const owned=ownedDatabaseConnection(connection)||(connection?.host==='127.0.0.1'&&connection?.port===55432);
 if(owned){
  if(connection.host!=='127.0.0.1'||connection.port!==55432||!pem(connection.ca))fail();
  return {rejectUnauthorized:true,ca:connection.ca,checkServerIdentity:(_hostname,certificate)=>checkServerIdentity('127.0.0.1',certificate)};
 }
 return {rejectUnauthorized:true,...(connection.ca===undefined?{}:{ca:connection.ca})};
}
