import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {OWNED_DATABASE_BOUNDARY_SQL,verifyOwnedDatabaseBoundary} from '../packages/buyer-writer/owned-database-evidence.js';
import {OWNED_POSTGRES_TARGET,OWNED_POSTGRES_BOOTSTRAP_SQL,OWNED_POSTGRES_TEMPLATE_SQL,OWNED_POSTGRES_OBSERVE_SQL} from '../packages/buyer-writer/owned-postgres.js';
assert.equal(process.versions.node,'22.23.1');
const name=`zola-owned-test-${randomUUID()}`,owner=randomUUID();let id;
const run=(args,input)=>spawnSync('docker',args,{input,encoding:'utf8',timeout:60000,maxBuffer:1048576});
const checked=(args,input)=>{const r=run(args,input);assert.equal(r.status,0,(r.stderr||'Docker command failed').slice(0,500));return r.stdout.trim();};
const sql=(text,database='postgres',fail=false)=>{const r=run(['exec','-i',id,'psql','-X','-qAt','-U','blackspire_cluster_admin','-d',database,'-v','ON_ERROR_STOP=1'],text);if(fail){assert.notEqual(r.status,0);return;}assert.equal(r.status,0,(r.stderr||'SQL failed').slice(0,500));return r.stdout.trim();};
try{
 id=checked(['create','--name',name,'--pull','never','--label',`blackspire.test-owner=${owner}`,'--network','none','--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=8m','-e','POSTGRES_USER=blackspire_cluster_admin','-e','POSTGRES_DB=postgres','-e','POSTGRES_HOST_AUTH_METHOD=trust',OWNED_POSTGRES_TARGET.image]);
 assert.match(id,/^[a-f0-9]{64}$/);checked(['start',id]);
 let ready=false;for(let i=0;i<80;i++){if(run(['exec',id,'sh','-c','test "$(cat /proc/1/comm)" = postgres && pg_isready -U blackspire_cluster_admin']).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
 assert.equal(checked(['exec',id,'id','-u','postgres']),'70');
 sql(OWNED_POSTGRES_TEMPLATE_SQL,'template1');sql(OWNED_POSTGRES_BOOTSTRAP_SQL);
 sql(OWNED_POSTGRES_BOOTSTRAP_SQL,'postgres',true);
 const observation=JSON.parse(sql(OWNED_POSTGRES_OBSERVE_SQL));
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:observation.creatorOid,systemIdentifier:observation.systemIdentifier,caSha256:'a'.repeat(64)};
 const boundary=JSON.parse(sql('SET SESSION AUTHORIZATION postgres;BEGIN READ ONLY;'+OWNED_DATABASE_BOUNDARY_SQL+';COMMIT;'));
 assert.equal(verifyOwnedDatabaseBoundary(boundary,profile).pgNetAbsent,true);
 assert.ok(observation.creatorOid>10);assert.ok(observation.ownerMatches&&observation.providerObjectsAbsent&&observation.sourceCredentialsAbsent);
 assert.equal(sql("SELECT rolsuper||','||rolcanlogin||','||rolcreatedb||','||rolcreaterole||','||rolreplication||','||rolbypassrls FROM pg_roles WHERE rolname='postgres'"),'false,false,true,true,true,true');
 assert.equal(sql("SET SESSION AUTHORIZATION postgres;SELECT system_identifier::text FROM pg_control_system()"),observation.systemIdentifier);
 // Canonical-shaped fixture only: this lane makes no production schema/auth migration claim.
 sql('SET SESSION AUTHORIZATION postgres;'+readFileSync(new URL('../tests/fixtures/buyer-writer/schema.sql',import.meta.url),'utf8'));
 sql('SET SESSION AUTHORIZATION postgres;'+readFileSync(new URL('../frontend/supabase/migrations/20260904223151_buyer_browser_security.sql',import.meta.url),'utf8'));
 const installer=readFileSync(new URL('../packages/buyer-writer/sql/install.sql',import.meta.url),'utf8');
 sql(`SET SESSION AUTHORIZATION postgres;SET blackspire.buyer_writer_creator_oid='${observation.creatorOid}';`+installer);
 assert.equal(sql("SELECT count(*) FROM pg_roles WHERE rolname IN('buyer_writer_owner','buyer_writer_runtime','buyer_writer_issuer','buyer_writer_admission')"),'4');
 assert.equal(sql("SELECT has_function_privilege('buyer_writer_runtime','pg_catalog.pg_control_system()','EXECUTE')"),'f');
 assert.equal(sql("SELECT has_database_privilege('buyer_writer_runtime','postgres','TEMP') OR has_database_privilege('buyer_writer_runtime','postgres','CREATE')"),'f');
 sql(`SET SESSION AUTHORIZATION postgres;SET blackspire.buyer_writer_creator_oid='${observation.creatorOid}';`+installer);
 sql("CREATE SCHEMA net;CREATE SEQUENCE net.queue_id;GRANT USAGE ON SEQUENCE net.queue_id TO PUBLIC;");
 sql(`SET SESSION AUTHORIZATION postgres;SET blackspire.buyer_writer_creator_oid='${observation.creatorOid}';`+installer,'postgres',true);
 sql('REVOKE ALL ON SEQUENCE net.queue_id FROM PUBLIC;DROP SCHEMA net CASCADE;');
 sql(`SET SESSION AUTHORIZATION postgres;SET blackspire.buyer_writer_creator_oid='${observation.creatorOid}';`+installer);
 console.log(JSON.stringify({ok:true,checks:8,postgres:'17.6',strictInstallerUnchanged:true,productionTouched:false}));
}finally{
 if(id){const c=JSON.parse(checked(['inspect',id]))[0];assert.equal(c.Config.Labels['blackspire.test-owner'],owner);checked(['rm','-f',id]);}
}
