import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {prepareBuyerMigrationPackage} from '../packages/buyer-writer/migration-package.js';
import {prepareBuyerMigrationExecution,executeBuyerMigration} from '../packages/buyer-writer/migration-executor.js';
assert.equal(process.env.ZOLA_DISPOSABLE_EXECUTOR,'1');
assert.equal(process.versions.node,'22.23.1');
const namespace=fs.readlinkSync('/proc/self/ns/net');
assert.match(process.env.ZOLA_DISPOSABLE_NETNS??'',/^net:\[\d+\]$/);
assert.equal(namespace,process.env.ZOLA_DISPOSABLE_NETNS);
assert.notEqual(namespace,fs.readlinkSync('/proc/1/ns/net'));
assert.deepEqual(fs.readFileSync('/proc/net/dev','utf8').trim().split('\n').slice(2).map(line=>line.split(':')[0].trim()),['lo']);
assert.equal(fs.readFileSync('/proc/net/route','utf8').trim().split('\n').length,1);
// Child of the owned --network=none container's network namespace. Only
// loopback exists. Inputs are synthetic catalogs, never production credentials.
const providerManifest=JSON.parse(fs.readFileSync(0,'utf8'));
assert.equal(providerManifest.baseline.database,'postgres');
const clients=[];
const connect=async user=>{const c=new pg.Client({host:'127.0.0.1',port:5432,user:user??'postgres',database:'postgres',connectionTimeoutMillis:2000,query_timeout:35000});await c.connect();clients.push(c);return c;};
const makePlan=(letter,version)=>{
 const releaseSha=letter.repeat(40),p=prepareBuyerMigrationPackage({releaseSha,providerManifest});
 return prepareBuyerMigrationExecution({releaseSha,providerManifest,body:p.body,manifestBytes:p.manifestBytes,
  expectedManifestSha256:createHash('sha256').update(p.manifestBytes).digest('hex'),migrationVersion:version});
};
const checks=[];
try{
 const client=await connect(),plan=makePlan('a','20260908000000');
 const initial=await client.query('SELECT count(*)::int AS count FROM public."SearchJob"');
 assert.equal((await executeBuyerMigration({client,plan,mode:'reconcile'})).status,'not-recorded-retry-not-authorized');
 assert.equal((await executeBuyerMigration({client,plan,mode:'apply'})).status,'committed');
 assert.equal((await client.query('SELECT count(*)::int AS count FROM public."SearchJob"')).rows[0].count,initial.rows[0].count);
 assert.equal((await client.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,1);
 checks.push('actual nonsuperuser PG17 application and atomic history commit');
 assert.equal((await executeBuyerMigration({client,plan,mode:'apply'})).status,'committed-history-verified');
 assert.equal((await executeBuyerMigration({client,plan,mode:'reconcile'})).status,'committed-history-verified');
 checks.push('exact history replay and read-only reconciliation do not rerun body');
 const locker=await connect();await locker.query('BEGIN; SELECT pg_advisory_xact_lock(206994,125)');
 await assert.rejects(executeBuyerMigration({client,plan,mode:'reconcile'}),e=>e.code==='MIGRATION_FAILED');
 await locker.query('ROLLBACK');checks.push('active competing backend denies absence inference');
 const lost=await connect(),lostPlan=makePlan('b','20260908000001'),query=lost.query.bind(lost);
 lost.query=async(...args)=>{const r=await query(...args);if(args[0]==='COMMIT')throw new Error('synthetic lost COMMIT response');return r;};
 await assert.rejects(executeBuyerMigration({client:lost,plan:lostPlan,mode:'apply'}),e=>e.code==='OUTCOME_UNKNOWN');
 assert.equal((await executeBuyerMigration({client,plan:lostPlan,mode:'reconcile'})).status,'committed-history-verified');
 checks.push('actual COMMIT with lost acknowledgement reconciles once without replay');
 const admin=await connect('fixture_admin');
 await admin.query('GRANT SELECT ON net.http_request_queue TO buyer_writer_runtime');
 await assert.rejects(executeBuyerMigration({client,plan:makePlan('c','20260908000002'),mode:'apply'}),e=>e.code==='MIGRATION_FAILED');
 assert.equal((await client.query('SELECT count(*)::int AS count FROM supabase_migrations.schema_migrations')).rows[0].count,2);
 await admin.query('REVOKE SELECT ON net.http_request_queue FROM buyer_writer_runtime');
 checks.push('provider ACL drift aborts before application/history writes');
 await client.query("UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['tampered'] WHERE version='20260908000000'");
 await assert.rejects(executeBuyerMigration({client,plan,mode:'reconcile'}),e=>e.code==='MIGRATION_FAILED');
 checks.push('tampered history rejected');
 console.log(JSON.stringify({status:'PASS',checks,environment:'isolated PostgreSQL17.6 nonsuperuser postgres; inert provider stand-ins',productionMutations:0,paidProviderCalls:0}));
}finally{for(const c of clients){try{await c.end();}catch{}}}
