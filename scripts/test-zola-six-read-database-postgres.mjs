import {randomBytes} from 'node:crypto';
import { readFileSync,readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { DIVISION_TABLES, divisionSnapshotSQL, ownerWitnessSQL, validateDivisionSnapshot, validateOwnerWitness, compareDivisionSnapshots } from '../packages/zola-six-reads/database-observer.js';

assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const runId=randomBytes(16).toString('hex');
assert.match(runId??'',/^[a-f0-9]{32}$/);
const name = `zola-database-observer-${runId}`;
let owned = false;
let creationAttempted = false;
let containerId;
const ownership=randomBytes(16).toString('hex');
assert.match(ownership??'',/^[a-f0-9]{32}$/);
const run = (args, input) => spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
const sql = (statement, { fail = false } = {}) => {
  const r = run(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'], 'set client_min_messages=warning;'+statement);
  if (fail) { assert.equal(r.error,undefined);assert.equal(r.status,3,'expected psql SQL denial');assert.match(r.stderr,fail);return; }
  assert.equal(r.status, 0, `isolated SQL failed: ${(r.stderr ?? '').replace(/DETAIL:[\s\S]*/, '').slice(0, 600)}`);
  return r.stdout.trim();
};
const cleanup = () => {
  if(!owned && creationAttempted) {
    // A create RPC can time out after daemon-side creation. It has not been
    // started yet. Recover only our unpredictable ownership label, never a name
    // alone; deletion uses the immutable container ID to avoid name reuse races.
    const inspected=run(['inspect',name]);
    if(inspected.status===0) {
      const candidate=JSON.parse(inspected.stdout)[0];
      assert.equal(candidate.Config.Labels['blackspire.test-owner'],ownership,'container ownership mismatch');
      containerId=candidate.Id;owned=true;
    } else {
      assert.match(inspected.stderr??'',/no such (object|container)/i,'ambiguous create cleanup could not be verified');
    }
  }
  if(!owned) return;
  assert.match(containerId,/^[a-f0-9]{64}$/);
  const removed=run(['rm','-f',containerId]);
  assert.equal(removed.status,0,'owned disposable container cleanup failed');
  owned=false;creationAttempted=false;
};
for(const [signal,code] of [['SIGTERM',143],['SIGINT',130]]) process.once(signal,()=>{cleanup();process.exit(code);});
const literal=value=>"'"+String(value).replaceAll("'","''")+"'";
try {
  creationAttempted=true;
  const created = run(['create','--name',name,'--label','blackspire.disposable=buyer-writer-test','--label',`blackspire.test-owner=${ownership}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m','-e','POSTGRES_USER=fixture_admin','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=postgres',image]);
  assert.equal(created.status,0,'isolated PostgreSQL container creation failed');
  containerId=created.stdout.trim();assert.match(containerId,/^[a-f0-9]{64}$/);
  const container = JSON.parse(run(['inspect',containerId]).stdout)[0];
  assert.equal(container.Config.Labels['blackspire.test-owner'],ownership);
  owned = true;
  assert.equal(container.HostConfig.NetworkMode,'none');assert.equal(container.HostConfig.ReadonlyRootfs,true);
  assert.equal(container.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  assert.equal(run(['start',containerId]).status,0,'isolated PostgreSQL container failed to start');
  let ready = false;
  for (let i=0;i<60;i++) {
    if (run(['exec',containerId,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U postgres -d postgres']).status===0) { ready=true;break; }
    await new Promise(r=>setTimeout(r,500));
  }
  assert.ok(ready,'isolated PostgreSQL readiness timed out');
  const bootstrap=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],'CREATE ROLE postgres SUPERUSER LOGIN; ALTER DATABASE postgres OWNER TO postgres;');
  assert.equal(bootstrap.status,0,bootstrap.stderr?.slice(0,500));
  assert.match(sql('show server_version'),/^17\.6/);

  const owner='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
  sql(`CREATE ROLE authenticated; GRANT authenticated TO postgres;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid); INSERT INTO auth.users VALUES('${owner}'),('${foreign}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT current_setting(''request.jwt.claim.sub'',true)::uuid';
    GRANT USAGE ON SCHEMA auth TO authenticated; GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;`);
  for (const table of DIVISION_TABLES) sql(`CREATE TABLE public."${table}"(id uuid,user_id uuid,payload text); INSERT INTO public."${table}" VALUES('${owner}','${owner}','fixture');`);
  sql(`ALTER TABLE public."SearchJob" ENABLE ROW LEVEL SECURITY; GRANT SELECT ON public."SearchJob" TO authenticated;
    CREATE POLICY own_read ON public."SearchJob" FOR SELECT TO authenticated USING(user_id=auth.uid());`);
  const demote=run(['exec','-i',containerId,'psql','-X','-qAt','-U','fixture_admin','-d','postgres','-v','ON_ERROR_STOP=1'],'ALTER ROLE postgres NOSUPERUSER BYPASSRLS;');
  assert.equal(demote.status,0);
  const config={releaseSha:'a'.repeat(40),runId:'postgres-observer-fixture'};
  const observe=phase=>validateDivisionSnapshot(JSON.parse(sql(divisionSnapshotSQL(config,phase)).split('\n').at(-1)),config,phase);
  const witness=()=>JSON.parse(sql(ownerWitnessSQL(config,'before')).split('\n').at(-1));
  const before=observe('before');assert.equal(validateOwnerWitness(witness(),config,'before').foreignVisible,0);
  assert.equal(compareDivisionSnapshots(before,observe('after'),config).netMutationDelta,0);
  sql(`UPDATE public."BuyerProfile" SET payload=payload;`);
  const after=observe('after');assert.equal(before.tables.find(t=>t.name==='BuyerProfile').digest,after.tables.find(t=>t.name==='BuyerProfile').digest);
  assert.throws(()=>compareDivisionSnapshots(before,after,config),/DIVISION_ROWS_CHANGED/);
  sql(`CREATE POLICY unsafe_foreign ON public."SearchJob" FOR SELECT TO authenticated USING(true);`);
  assert.throws(()=>validateOwnerWitness(witness(),config,'before'),/DATABASE_OWNER_DENIAL_FAILED/);
  sql(`DROP POLICY unsafe_foreign ON public."SearchJob"; DELETE FROM auth.users WHERE id='${foreign}';`);
  // With no real second user, SQL may reject an empty UUID itself; no PASS possible.
  const missing=run(['exec','-i',containerId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],ownerWitnessSQL(config,'before'));
  if(missing.status===0)assert.throws(()=>validateOwnerWitness(JSON.parse(missing.stdout.trim().split('\n').at(-1)),config,'before'));
  else assert.equal(missing.status,3);
  sql('BEGIN READ ONLY; UPDATE public."BuyerProfile" SET payload=payload; ROLLBACK;', {fail:/read-only transaction/});
  console.log(JSON.stringify({status:'PASS',groups:6,postgresVersion:'17.6',scope:'Disposable PostgreSQL, full row and tuple digests, actual role and real fixture-owner policy, policy drift, missing owner and read-only write denial',productionExecuted:false}));
} finally { cleanup(); }
