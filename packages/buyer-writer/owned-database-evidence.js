import {createHash} from 'node:crypto';
import {validateOwnedPostgresProfile} from './owned-postgres.js';
import {BUYER_WRITER_PRODUCTION_VERIFY_SQL,verifyBuyerWriterProductionEvidence} from './production-verifier.js';
import {BUYER_WRITER_ROUTINES} from './routine-policy.js';

const reject=()=>{throw new Error('Owned database isolation evidence rejected');};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Actual cluster identity is read from PostgreSQL, never inferred from a host
// string. This query is management-only, catalog-only and requires READ ONLY.
// An empty result or a missing catalog is not an isolation proof.
export const OWNED_DATABASE_BOUNDARY_SQL=`select jsonb_build_object(
 'database',current_database(),'actor',current_user,'sessionActor',session_user,
 'creatorOid',(select oid::text from pg_roles where rolname='postgres'),
 'databaseOwnerOid',(select datdba::text from pg_database where datname=current_database()),
 'systemIdentifier',(select system_identifier::text from pg_control_system()),
 'serverVersion',current_setting('server_version_num')::integer,
 'recovery',pg_is_in_recovery(),
 'readOnly',current_setting('transaction_read_only')='on',
 'managementSuperuser',(select rolsuper from pg_roles where rolname=current_user),
 'extensions',(select coalesce(jsonb_agg(extname order by extname),'[]'::jsonb) from pg_extension),
 'netSchemas',(select count(*)::integer from pg_namespace where nspname='net'),
 'networkRoutines',(select count(*)::integer from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='net' or p.proname ~ '^dblink($|_)'),
 'foreignDataWrappers',(select count(*)::integer from pg_foreign_data_wrapper),
 'foreignServers',(select count(*)::integer from pg_foreign_server),
 'foreignTables',(select count(*)::integer from pg_foreign_table),
 'userMappings',(select count(*)::integer from pg_user_mappings)
) as boundary`;

export const OWNED_DATABASE_ACL_SQL=`with boundary_observation as (${OWNED_DATABASE_BOUNDARY_SQL}),
 writer_observation as (${BUYER_WRITER_PRODUCTION_VERIFY_SQL})
 select boundary_observation.boundary,writer_observation.evidence as writer from boundary_observation cross join writer_observation`;

export function verifyOwnedDatabaseBoundary(raw,profile){
 const target=validateOwnedPostgresProfile(profile);
 if(!exact(raw,['database','actor','sessionActor','creatorOid','databaseOwnerOid','systemIdentifier','serverVersion','recovery','readOnly','managementSuperuser',
  'extensions','netSchemas','networkRoutines','foreignDataWrappers','foreignServers','foreignTables','userMappings'])
  ||raw.database!==target.database||raw.actor!==target.managementUser||raw.sessionActor!==target.managementUser
  ||raw.creatorOid!==String(target.creatorOid)||raw.databaseOwnerOid!==String(target.creatorOid)
  ||raw.systemIdentifier!==target.systemIdentifier||raw.serverVersion!==170006||raw.readOnly!==true||raw.recovery!==false||raw.managementSuperuser!==false
  ||JSON.stringify(raw.extensions)!=='["plpgsql"]'
  ||!['netSchemas','networkRoutines','foreignDataWrappers','foreignServers','foreignTables','userMappings'].every(key=>raw[key]===0))reject();
 return Object.freeze({kind:'owned-postgres-isolation-v1',systemIdentifier:raw.systemIdentifier,creatorOid:target.creatorOid,
  database:target.database,pgNetAbsent:true,foreignDataAccessAbsent:true,boundaryDigest:hash(raw)});
}

export function verifyOwnedDatabaseAclResult(result,profile){
 if(!result||!Array.isArray(result.rows)||result.rows.length!==1||!exact(result.rows[0],['boundary','writer']))reject();
 const row=result.rows[0],boundary=verifyOwnedDatabaseBoundary(row.boundary,profile);
 // Reuse every canonical target, routine, ownership, role, membership and
 // privilege check. The legacy pgNet observation must explicitly report every
 // expected name absent; it is not exported as twelve installed functions.
 const writer=verifyBuyerWriterProductionEvidence(row.writer,boundary.creatorOid);
 if(writer.pgNet.some(value=>value.signature!==null||value.owner!==null
  ||['publicExecute','ownerExecute','runtimeExecute','issuerExecute','admissionExecute'].some(key=>value[key]!==false)))reject();
 return Object.freeze({...boundary,writerIsolationVerified:true,targetTablePublicPrivilegeCount:0,targetColumnPublicPrivilegeCount:0,
  directTableAccessDenied:true,directSequenceAccessDenied:true,schemaCreateDenied:true,crossRoutineAccessDenied:true,
  writerCatalogDigest:hash(row.writer)});
}

export const ownedDatabaseAclParameters=profile=>{
 const value=validateOwnedPostgresProfile(profile);
 return [value.creatorOid,JSON.stringify(BUYER_WRITER_ROUTINES)];
};
