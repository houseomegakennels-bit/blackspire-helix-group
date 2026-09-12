// Fixed, read-only database observations. No credentials, connection or I/O on import.
import { createHash } from 'node:crypto';
import { refuse } from './collector.js';
export const DIVISION_TABLES = Object.freeze(['BuyerProfile','BuyerReport','CleanSale','RawSale','SearchJob','buyer_group_registry','buyer_matches','data_sources','deal_analysis','deal_leads','nexus_contacts','owners','properties','seller_conversations','seller_leads']);
const hash = text => createHash('sha256').update(text).digest('hex');
const literal = value => `'${value}'`; // Only validated SHA/identifier/enum inputs enter SQL.
function binding(config, phase) {
  if (!/^[a-f0-9]{40}$/.test(config.releaseSha ?? '') || !/^[A-Za-z0-9._:-]{1,128}$/.test(config.runId ?? '') || !['before','after'].includes(phase)) refuse('OBSERVER_BINDING_REJECTED');
  return `'releaseSha',${literal(config.releaseSha)},'runId',${literal(config.runId)},'phase',${literal(phase)}`;
}
const begin = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '15s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '20s';
SET LOCAL row_security = off;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
`;
// Full table rows stay in PostgreSQL. Both content and tuple-version digests are
// returned, so same-value updates/reinserts are detected as well as net changes.
// This is still NOT a complete mutation-attempt audit or egress observation.
export function divisionSnapshotSQL(config, phase) {
  const bind = binding(config, phase);
  const selects = DIVISION_TABLES.map(table => `SELECT '${table}' AS name, count(*)::int AS rows,
    encode(sha256(convert_to(coalesce(string_agg(row_hash, '' ORDER BY row_hash), ''),'UTF8')),'hex') AS digest,
    encode(sha256(convert_to(coalesce(string_agg(version_hash, '' ORDER BY version_hash), ''),'UTF8')),'hex') AS version_digest
    FROM (SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') AS row_hash,
      encode(sha256(convert_to(to_jsonb(t)::text || ':' || xmin::text,'UTF8')),'hex') AS version_hash
      FROM public."${table}" t LIMIT 250001) bounded`).join('\nUNION ALL\n');
  return `${begin}WITH observed AS (${selects}), relations AS (
    SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND c.relname IN (${DIVISION_TABLES.map(literal).join(',')})
  ) SELECT jsonb_build_object('version',1,${bind},'capturedAt',clock_timestamp(),
    'database',current_database(),'role',current_user,'readOnly',current_setting('transaction_read_only')='on',
    'primary',NOT pg_is_in_recovery(),'bypassRls',(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user),
    'ordinaryTables',(SELECT count FROM relations),
    'tables',(SELECT jsonb_agg(to_jsonb(observed) ORDER BY name) FROM observed)) AS observation;
ROLLBACK;`;
}

// Exercises the actual authenticated PostgreSQL role and real auth.users IDs.
// It does not forge or claim a browser/GoTrue session. Only a witness digest and
// counts leave PostgreSQL; auth user/job identifiers remain transaction-local.
export function ownerWitnessSQL(config, phase) {
  const bind = binding(config, phase);
  const sql = `${begin}SELECT set_config('zola.owner',coalesce((SELECT j.user_id::text FROM public."SearchJob" j JOIN auth.users u ON u.id=j.user_id ORDER BY j.id LIMIT 1),''),true);
SELECT set_config('zola.foreign',coalesce((SELECT id::text FROM auth.users WHERE id::text<>current_setting('zola.owner') ORDER BY id LIMIT 1),''),true);
SELECT set_config('zola.job',coalesce((SELECT id::text FROM public."SearchJob" WHERE user_id::text=current_setting('zola.owner') ORDER BY id LIMIT 1),''),true);
SELECT set_config('zola.witness',encode(sha256(convert_to(current_setting('zola.owner')||':'||current_setting('zola.foreign')||':'||current_setting('zola.job'),'UTF8')),'hex'),true);
SET LOCAL row_security = on;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('zola.owner'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',current_setting('zola.owner'),true);
SELECT set_config('zola.own_count',(SELECT count(*)::text FROM public."SearchJob" WHERE id::text=current_setting('zola.job')),true);
SELECT set_config('request.jwt.claims',jsonb_build_object('sub',current_setting('zola.foreign'),'role','authenticated')::text,true),set_config('request.jwt.claim.sub',current_setting('zola.foreign'),true);
SELECT jsonb_build_object('version',1,${bind},'capturedAt',clock_timestamp(),'database',current_database(),
  'role',current_user,'readOnly',current_setting('transaction_read_only')='on',
  'witness',current_setting('zola.witness'),'realDistinctUsers',current_setting('zola.owner')<>'' AND current_setting('zola.foreign')<>'' AND current_setting('zola.owner')<>current_setting('zola.foreign'),
  'ownVisible',current_setting('zola.own_count')::int,
  'foreignVisible',(SELECT count(*)::int FROM public."SearchJob" WHERE id::text=current_setting('zola.job'))) AS observation;
ROLLBACK;`;
  return sql.split('\n').map(line => line.startsWith('SELECT set_config(') ? `SELECT true AS configured FROM (${line.slice(0,-1)}) AS configuration;` : line).join('\n');
}
function exact(value, keys) { return value && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(','); }
function common(value, config, phase) {
  binding(config, phase);
  if (!value || value.version !== 1 || value.releaseSha !== config.releaseSha || value.runId !== config.runId || value.phase !== phase || value.database !== 'postgres' || value.readOnly !== true || (typeof value.capturedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value.capturedAt) || !Number.isFinite(Date.parse(value.capturedAt)))) refuse('DATABASE_OBSERVATION_BINDING');
}
export function validateDivisionSnapshot(value, config, phase) {
  common(value, config, phase);
  if (!exact(value,'version,releaseSha,runId,phase,capturedAt,database,role,readOnly,primary,bypassRls,ordinaryTables,tables') || value.role !== 'postgres' || value.primary !== true || value.bypassRls !== true || value.ordinaryTables !== DIVISION_TABLES.length || !Array.isArray(value.tables) || value.tables.length !== DIVISION_TABLES.length) refuse('DATABASE_OBSERVATION_SCOPE');
  if (value.tables.map(t=>t.name).sort().join(',') !== DIVISION_TABLES.join(',')) refuse('DATABASE_OBSERVATION_TABLES');
  for (const table of value.tables) if (!exact(table,'name,rows,digest,version_digest') || !Number.isInteger(table.rows) || table.rows < 0 || table.rows > 250000 || !/^[a-f0-9]{64}$/.test(table.digest ?? '') || !/^[a-f0-9]{64}$/.test(table.version_digest ?? '')) refuse('DATABASE_OBSERVATION_BOUND');
  return structuredClone(value);
}
export function validateOwnerWitness(value, config, phase) {
  common(value, config, phase);
  if (!exact(value,'version,releaseSha,runId,phase,capturedAt,database,role,readOnly,witness,realDistinctUsers,ownVisible,foreignVisible') || value.role !== 'authenticated' || value.realDistinctUsers !== true || value.ownVisible !== 1 || value.foreignVisible !== 0 || !/^[a-f0-9]{64}$/.test(value.witness ?? '')) refuse('DATABASE_OWNER_DENIAL_FAILED');
  return structuredClone(value);
}
export function compareDivisionSnapshots(before, after, config) {
  validateDivisionSnapshot(before, config, 'before'); validateDivisionSnapshot(after, config, 'after');
  if (Date.parse(after.capturedAt) < Date.parse(before.capturedAt)) refuse('DATABASE_OBSERVATION_TIME_ORDER');
  const changedTables = DIVISION_TABLES.filter(name => {
    const a = before.tables.find(t=>t.name===name), b = after.tables.find(t=>t.name===name);
    return a.rows !== b.rows || a.digest !== b.digest || a.version_digest !== b.version_digest;
  });
  if (changedTables.length) refuse('DIVISION_ROWS_CHANGED');
  return { status: 'PASS_UNCHANGED_DIVISION_ROWS', tableCount: DIVISION_TABLES.length, rowCount: before.tables.reduce((sum,t)=>sum+t.rows,0),
    snapshotDigest: hash(JSON.stringify(before.tables)), netMutationDelta: 0, tupleVersionDelta: 0,
    scope: 'All rows in the fifteen named division tables, before/after this collection; no claim of complete attempted/transient writes or provider egress' };
}

export async function queryObservation(client, sql) {
  try {
    const responses = await client.query(sql);
    const candidates = (Array.isArray(responses) ? responses : [responses]).flatMap(r=>r.rows ?? []).filter(r=>Object.hasOwn(r,'observation'));
    if (candidates.length !== 1 || Object.keys(candidates[0]).join(',') !== 'observation') refuse('DATABASE_OBSERVATION_RESPONSE');
    return candidates[0].observation;
  } catch { refuse('DATABASE_OBSERVATION_FAILED'); }
  finally { await client.query('ROLLBACK').catch(()=>{}); }
}
