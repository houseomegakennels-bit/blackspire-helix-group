import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
import {randomBytes} from 'node:crypto';
import { readFileSync,readlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { EXTENSION_ACL_CATALOG_SQL } from '../packages/buyer-writer/extension-acl-catalog.js';
import { prepareBuyerWriterExtensionAcl } from '../packages/buyer-writer/extension-acl.js';
assert.equal(process.versions.node, '22.23.1');
const image = process.env.BUYER_WRITER_TEST_IMAGE;
assert.match(image ?? '', /^postgres@sha256:[a-f0-9]{64}$/);
const runId=randomBytes(16).toString('hex');
assert.match(runId??'',/^[a-f0-9]{32}$/);
const name = `zola-owned-schema-${runId}`;
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
  assert.equal(bootstrap.status,0,'fixture bootstrap failed');
  const body=prepareOwnedBuyerSchema(JSON.parse(readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)))).body;
  sql(body);
  assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'"),'6');
  assert.equal(sql("SELECT count(*) FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace"),'5');
  assert.equal(sql("SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relrowsecurity"),'6');
  sql(`INSERT INTO public."SearchJob"(id,user_id,state,county,property_type) VALUES('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','TX','Synthetic','home');
  INSERT INTO public.exports(user_id,search_job_id,file_name,storage_path) VALUES('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001','fixture.csv','synthetic');
  INSERT INTO public."BuyerProfile"(buyer_name,total_spend,updated_at) VALUES('Synthetic',123456789012345678901234567890.1234567890123456789,'2026-09-21T00:00:00.123456Z');`);
  assert.equal(sql(`SELECT total_spend::text FROM public."BuyerProfile"`),'123456789012345678901234567890.1234567890123456789');
  assert.equal(sql(`SELECT to_char(updated_at,'US') FROM public."BuyerProfile"`),'123456');
  assert.equal(sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000002';SELECT count(*) FROM public."SearchJob";ROLLBACK;`),'1');
  assert.equal(sql(`BEGIN;SET LOCAL ROLE authenticated;SET LOCAL request.jwt.claim.sub='00000000-0000-4000-8000-000000000003';SELECT count(*) FROM public."SearchJob";SELECT count(*) FROM public.exports;ROLLBACK;`),'0\n0');
  sql(`DELETE FROM public."SearchJob"`);assert.equal(sql('SELECT count(*) FROM public.exports'),'0');
  console.log(JSON.stringify({status:'PASS',checks:['six-table generated DDL','five foreign keys','six RLS tables','auth.uid owner/foreign isolation','numeric/microsecond precision','exports cascade'],productionConnections:0,nativeCopyDriverRehearsed:false}));
}finally{cleanup();}
