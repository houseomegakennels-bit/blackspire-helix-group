import {createHash} from 'node:crypto';

export const OWNED_POSTGRES_TARGET=Object.freeze({kind:'owned-postgres-v1',host:'127.0.0.1',port:55432,database:'postgres',managementUser:'postgres',image:'postgres@sha256:ef257d85f76e48da1c64832459b59fcaba1a4dac97bf5d7450c77753542eee94'});
export const OWNED_POSTGRES_PROFILE_PATH='/etc/blackspire/owned-postgres/profile.json';
export const OWNED_POSTGRES_DATA_PATH='/mnt/blackspire-builds/zola-owned-postgres/data';
const refused=()=>{throw new Error('Owned PostgreSQL profile rejected');};
export function validateOwnedPostgresProfile(value){
 if(!value||typeof value!=='object'||Array.isArray(value))refused();
 const keys=['version',...Object.keys(OWNED_POSTGRES_TARGET),'creatorOid','systemIdentifier','caSha256'];
 if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k))||value.version!==1
  ||Object.entries(OWNED_POSTGRES_TARGET).some(([k,v])=>value[k]!==v)
  ||!Number.isInteger(value.creatorOid)||value.creatorOid<=10||value.creatorOid>4294967295
  ||typeof value.systemIdentifier!=='string'||!(/^[1-9][0-9]{0,19}$/).test(value.systemIdentifier)
  ||BigInt(value.systemIdentifier)>18446744073709551615n
  ||typeof value.caSha256!=='string'||!(/^[a-f0-9]{64}$/).test(value.caSha256))refused();
 return Object.freeze({...value});
}
export function ownedPostgresProfileDigest(value){
 const p=validateOwnedPostgresProfile(value);
 return createHash('sha256').update(JSON.stringify({version:p.version,...OWNED_POSTGRES_TARGET,creatorOid:p.creatorOid,systemIdentifier:p.systemIdentifier,caSha256:p.caSha256})).digest('hex');
}
// Only a fresh isolated cluster. No application/auth schemas or runtime credentials.
export const OWNED_POSTGRES_BOOTSTRAP_SQL=`BEGIN;
SET LOCAL search_path=pg_catalog;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$BEGIN
 IF current_database()<>'postgres' OR session_user<>'blackspire_cluster_admin' OR current_user<>session_user
  OR NOT EXISTS(SELECT FROM pg_roles WHERE oid=10 AND rolname=session_user AND rolsuper)
  OR EXISTS(SELECT FROM pg_roles WHERE rolname='postgres')
  OR EXISTS(SELECT FROM pg_database WHERE datname NOT IN('postgres','template0','template1'))
  OR EXISTS(SELECT FROM pg_extension WHERE extname<>'plpgsql')
  OR EXISTS(SELECT FROM pg_foreign_server)
  OR EXISTS(SELECT FROM pg_namespace WHERE nspname NOT IN('public','information_schema') AND nspname!~'^pg_')
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 THEN RAISE EXCEPTION 'Fresh owned cluster required'; END IF;
END$$;
CREATE ROLE postgres NOLOGIN NOSUPERUSER CREATEDB CREATEROLE REPLICATION BYPASSRLS;
ALTER DATABASE postgres OWNER TO postgres;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
REVOKE CREATE,TEMPORARY ON DATABASE template0,template1 FROM PUBLIC;
REVOKE CONNECT ON DATABASE template0 FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION pg_catalog.pg_control_system() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE USAGE ON TYPES FROM PUBLIC;
COMMIT;
`;
export const OWNED_POSTGRES_TEMPLATE_SQL=`BEGIN;
SET LOCAL search_path=pg_catalog;
DO $$BEGIN
 IF current_database()<>'template1' OR session_user<>'blackspire_cluster_admin'
  OR NOT EXISTS(SELECT FROM pg_database WHERE datname=current_database() AND datdba=10 AND datistemplate)
  OR EXISTS(SELECT FROM pg_extension WHERE extname<>'plpgsql')
  OR EXISTS(SELECT FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
 THEN RAISE EXCEPTION 'Inert template required'; END IF;
END$$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
COMMIT;
`;
export const OWNED_POSTGRES_OBSERVE_SQL=`SELECT jsonb_build_object(
 'creatorOid',(SELECT oid::integer FROM pg_roles WHERE rolname='postgres'),
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'database',current_database(),
 'ownerMatches',(SELECT datdba=(SELECT oid FROM pg_roles WHERE rolname='postgres') FROM pg_database WHERE datname=current_database()),
 'providerObjectsAbsent',NOT EXISTS(SELECT FROM pg_extension WHERE extname<>'plpgsql') AND NOT EXISTS(SELECT FROM pg_foreign_server)
  AND NOT EXISTS(SELECT FROM pg_namespace WHERE nspname IN('net','extensions')),
 'sourceCredentialsAbsent',NOT EXISTS(SELECT FROM pg_user_mappings)) AS observation`;
export const OWNED_POSTGRES_CONFIGURATION=`listen_addresses = '*'
port = 5432
ssl = on
ssl_cert_file = '/etc/zola-postgres/server.crt'
ssl_key_file = '/etc/zola-postgres/server.key'
ssl_min_protocol_version = 'TLSv1.2'
hba_file = '/etc/zola-postgres/pg_hba.conf'
ident_file = '/etc/zola-postgres/pg_ident.conf'
password_encryption = 'scram-sha-256'
shared_buffers = '128MB'
work_mem = '4MB'
maintenance_work_mem = '64MB'
max_connections = 40
max_wal_size = '512MB'
min_wal_size = '80MB'
wal_level = replica
archive_mode = off
logging_collector = off
log_statement = 'none'
log_min_error_statement = panic
log_parameter_max_length = 0
log_parameter_max_length_on_error = 0
log_connections = off
log_disconnections = off
`;
export const OWNED_POSTGRES_HBA=`# Bootstrap superuser has no TCP authentication route.
local all blackspire_cluster_admin peer map=bootstrap
local all all reject
hostnossl all all 0.0.0.0/0 reject
hostnossl all all ::/0 reject
hostssl postgres postgres 0.0.0.0/0 scram-sha-256
hostssl postgres buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission_login 0.0.0.0/0 scram-sha-256
hostssl postgres buyer_repository_login,buyer_capability_login 0.0.0.0/0 scram-sha-256
hostssl template1 buyer_writer_runtime,buyer_writer_issuer,buyer_writer_admission_login 0.0.0.0/0 scram-sha-256
host all all 0.0.0.0/0 reject
host all all ::/0 reject
`;
export const OWNED_POSTGRES_IDENT='bootstrap postgres blackspire_cluster_admin\n';
export function ownedPostgresContainerArguments(){
 return Object.freeze(['create','--name','blackspire-owned-postgres','--pull','never','--label','blackspire.role=owned-postgres-v1',
 '--network','blackspire-owned-postgres','--read-only','--user','70:70','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','768m','--cpus','1',
 '--pids-limit','128','--restart','no','--log-driver','local','--log-opt','max-size=10m','--log-opt','max-file=3',
 '--publish','127.0.0.1:55432:5432','--mount',`type=bind,src=${OWNED_POSTGRES_DATA_PATH},dst=/var/lib/postgresql/data`,
 '--mount','type=bind,src=/etc/blackspire/owned-postgres/server,dst=/etc/zola-postgres,readonly',
 '--tmpfs','/var/run/postgresql:rw,noexec,nosuid,size=8m,uid=70,gid=70',OWNED_POSTGRES_TARGET.image,
 'postgres','-D','/var/lib/postgresql/data','-c','config_file=/etc/zola-postgres/postgresql.conf']);
}
export const OWNED_POSTGRES_SERVICE=`[Unit]
Description=Zola isolated owned PostgreSQL
Requires=docker.service
After=docker.service
RequiresMountsFor=/mnt/blackspire-builds/zola-owned-postgres/data
[Service]
Type=simple
ExecStart=/usr/bin/docker start --attach blackspire-owned-postgres
ExecStop=/usr/bin/docker stop --time 60 blackspire-owned-postgres
TimeoutStopSec=75
Restart=on-failure
RestartSec=5
[Install]
WantedBy=multi-user.target
`;
