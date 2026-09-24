import {ownedDatabaseConnection,validateDatabaseTarget,validateManagementCredential,readOwnedDatabaseProfile,verifyOwnedDatabaseIdentity} from './database-profile.js';
const fail=()=>{throw new Error('Buyer writer catalog collection failed');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const DIGEST=/^[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;

export const SOURCE_V1_CATALOG_SQL=`select
 session_user as "sessionUser",current_user as "currentUser",
 current_database() as "database",
 current_setting('server_version_num')::int as "serverVersionNum",
 (select oid::int from pg_roles where rolname=session_user) as "sessionUserOid",
 (select oid::int from pg_roles where rolname=current_user) as "currentUserOid",
 (select datdba::int from pg_database where datname=current_database()) as "creatorOid",
 (select rolname from pg_roles where oid=(
   select datdba from pg_database where datname=current_database())) as "creatorRole",
 pg_is_in_recovery() as "inRecovery"`;

function management(value,target,ownedProfile){
  if(ownedDatabaseConnection(target)){
    validateDatabaseTarget(target,{ownedProfile});
    if(value.profileDigest!==target.profileDigest||value.ca!==target.ca)fail();
    return validateManagementCredential(value,{ownedProfile});
  }
  if(!exact(value,['host','password','ca'])||value.host!==target.host
    ||typeof value.password!=='string'||value.password.length<1||value.password.length>4096
    ||value.password.includes('\0')||typeof value.ca!=='string'||value.ca!==target.ca
    ||!value.ca.startsWith('-----BEGIN CERTIFICATE-----'))fail();
  return value;
}
export async function collectBuyerWriterSourceV1Catalog({releaseSha,artifactDigest,
  credentialSourceDigest,creatorOid,target,managementConfiguration},{
  connect,now=Date.now,readProfile=readOwnedDatabaseProfile
}={}){
  let client,began=false;
  try{
    if(!SHA.test(releaseSha??'')||!DIGEST.test(artifactDigest??'')
      ||!DIGEST.test(credentialSourceDigest??'')
      ||!Number.isInteger(creatorOid)||creatorOid<1||creatorOid>4294967295
      ||!exact(target,['host','port','database','ca',...(ownedDatabaseConnection(target)?['backendProfile','profileDigest']:[])])
      ||target.port!==(ownedDatabaseConnection(target)?55432:5432)||target.database!=='postgres'
      ||typeof connect!=='function'||typeof now!=='function')fail();
    const ownedProfile=ownedDatabaseConnection(target)?readProfile():undefined;
    if(ownedProfile&&ownedProfile.creatorOid!==creatorOid)fail();
    const credential=management(managementConfiguration,target,ownedProfile);
    client=await connect(credential);
    if(!client||typeof client.query!=='function'||typeof client.end!=='function')fail();
    await client.query('begin read only');began=true;
    await client.query("set local search_path=pg_catalog; set local statement_timeout='7s'; set local lock_timeout='1s'");
    if(ownedProfile)await verifyOwnedDatabaseIdentity(client,ownedProfile);
    const result=await client.query(SOURCE_V1_CATALOG_SQL,[]);
    const row=result?.rows?.length===1?result.rows[0]:null;
    const keys=['sessionUser','currentUser','database','serverVersionNum','sessionUserOid',
      'currentUserOid','creatorOid','creatorRole','inRecovery'];
    if(!exact(row,keys)||row.sessionUser!=='postgres'||row.currentUser!=='postgres'
      ||row.database!=='postgres'||row.serverVersionNum<170000||row.serverVersionNum>=180000
      ||row.sessionUserOid!==creatorOid||row.currentUserOid!==creatorOid
      ||row.creatorOid!==creatorOid||row.creatorRole!=='postgres'||row.inRecovery!==false)fail();
    await client.query('rollback');began=false;
    if(ownedProfile&&JSON.stringify(readProfile())!==JSON.stringify(ownedProfile))fail();
    const capturedAt=new Date(now()).toISOString();
    return Object.freeze({version:ownedProfile?2:1,kind:'buyer-writer-authenticated-catalog-evidence',
      releaseSha,environment:'production',workspace:'blackspire-command',artifactDigest,
      credentialSourceDigest,capturedAt,
      target:Object.freeze({host:target.host,port:target.port,database:target.database,serverMajor:17,...(ownedProfile?{backendProfile:target.backendProfile,profileDigest:target.profileDigest,systemIdentifier:ownedProfile.systemIdentifier}:{})}),
      authentication:Object.freeze({sessionUser:row.sessionUser,currentUser:row.currentUser,
        creatorRole:row.creatorRole,sessionUserOid:row.sessionUserOid,
        currentUserOid:row.currentUserOid,creatorOid:row.creatorOid,authenticated:true})});
  }catch{fail();}
  finally{
    if(began)try{await client?.query('rollback');}catch{}
    try{await client?.end();}catch{}
  }
}
