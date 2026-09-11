import {createHash} from 'node:crypto';
import {prepareBuyerMigrationPackage} from './migration-package.js';

const digest=value=>createHash('sha256').update(value).digest('hex');
const plans=new WeakMap();

// No credential discovery or gate override. The release commander owns the
// protected file readers, exclusive window, fresh acceptance and session TLS.
// Only byte-identical regenerated reviewed packages become executable plans.
export function prepareBuyerMigrationExecution({releaseSha,providerManifest,manifestBytes,body,expectedManifestSha256,migrationVersion}) {
  try {
    if(typeof manifestBytes!=='string'||typeof body!=='string'||!/^\d{14}$/.test(migrationVersion??'')
      ||digest(manifestBytes)!==expectedManifestSha256)throw new Error();
    const prepared=prepareBuyerMigrationPackage({releaseSha,providerManifest});
    if(prepared.manifestBytes!==manifestBytes||prepared.body!==body)throw new Error();
    const name=`zola_guarded_application_${releaseSha}`;
    const key=`zola:${releaseSha}:${digest(body)}`;
    const plan=Object.freeze({releaseSha,migrationVersion,bodySha256:digest(body),manifestSha256:expectedManifestSha256});
    plans.set(plan,{body,name,key});
    return plan;
  }catch{throw new Error('Buyer migration execution package rejected');}
}

// A dedicated already-connected pg Client is required, never a Pool.query
// facade: BEGIN, body, history and COMMIT must share one session. The caller
// must discard this session after any failure, and durably journal intent
// before mode=apply. An uncertain commit allows mode=reconcile only; absence
// is not permission to retry because the original backend may still be alive.
export async function executeBuyerMigration({client,plan,mode,fence}) {
  const data=plans.get(plan);
  if(!data||!['apply','reconcile','recover'].includes(mode)||!client||typeof client.query!=='function'
    ||typeof client.processID!=='number'||!Number.isSafeInteger(client.processID)||client.processID<1
    ||fence!==undefined&&typeof fence!=='function') {
    throw new Error('Buyer migration execution rejected');
  }
  let began=false,commitSent=false;
  const result=status=>Object.freeze({status,releaseSha:plan.releaseSha,migrationVersion:plan.migrationVersion,
    bodySha256:plan.bodySha256,manifestSha256:plan.manifestSha256,productionAcceptance:false});
  try {
    await client.query(mode==='reconcile'?'BEGIN READ ONLY':'BEGIN');began=true;
    await client.query("SET LOCAL search_path=pg_catalog; SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='30s'; SET LOCAL transaction_timeout='120s'; SET LOCAL idle_in_transaction_session_timeout='10s';");
    const identity=await client.query("SELECT current_user AS actor, current_database() AS database, pg_backend_pid() AS pid, current_setting('server_version_num')::int AS version, (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) AS superuser");
    const actor=identity.rows?.[0];
    if(identity.rows?.length!==1||actor.actor!=='postgres'||actor.database!=='postgres'||actor.pid!==client.processID
      ||actor.version<170000||actor.version>=180000||actor.superuser!==false)throw new Error();
    // A fixed lock serializes all releases, including reconciliation. A failed
    // try-lock means an old backend could still commit: never infer absence.
    const lock=await client.query('SELECT pg_try_advisory_xact_lock(206994,125) AS acquired');
    if(lock.rows?.[0]?.acquired!==true)throw new Error();
    // Re-establish host admission authority only after this transaction owns
    // the database-wide migration lock. A moved lifecycle or generation must
    // abort before either the body or migration history can persist.
    if(fence)await fence();
    const prior=await client.query('SELECT version,name,statements,idempotency_key FROM supabase_migrations.schema_migrations WHERE version=$1 OR idempotency_key=$2 OR name=$3 OR name=$4',[plan.migrationVersion,data.key,data.name,`zola_guarded_connected_${plan.releaseSha}`]);
    if(!Array.isArray(prior.rows)||prior.rows.length>1)throw new Error();
    if(prior.rows.length===1){
      const row=prior.rows[0];
      if(row.version!==plan.migrationVersion||row.name!==data.name||row.idempotency_key!==data.key
        ||!Array.isArray(row.statements)||row.statements.length!==1||row.statements[0]!==data.body)throw new Error();
      await client.query('ROLLBACK');began=false;
      return result('committed-history-verified');
    }
    if(mode==='reconcile'){
      await client.query('ROLLBACK');began=false;
      return result('not-recorded-retry-not-authorized');
    }
    // The body contains provider postconditions before and after, exact row
    // preservation, browser denial and private writer authority preservation.
    if(fence)await fence();
    await client.query(data.body);
    const inserted=await client.query('INSERT INTO supabase_migrations.schema_migrations(version,name,statements,idempotency_key) VALUES($1,$2,$3,$4)',[plan.migrationVersion,data.name,[data.body],data.key]);
    if(inserted.rowCount!==1)throw new Error();
    if(fence)await fence();
    commitSent=true;
    await client.query('COMMIT');began=false;
    return result('committed');
  }catch{
    let rollbackConfirmed=false;
    if(began&&!commitSent){try{await client.query('ROLLBACK');rollbackConfirmed=true;}catch{/* discard session; do not log driver errors */}}
    const error=new Error(commitSent?'Buyer migration commit outcome unknown; reconcile only':'Buyer migration execution failed; session must be discarded');
    error.code=commitSent?'OUTCOME_UNKNOWN':mode==='recover'?(rollbackConfirmed?'MIGRATION_ABORTED':'ROLLBACK_OUTCOME_UNKNOWN'):'MIGRATION_FAILED';
    throw error;
  }
}
