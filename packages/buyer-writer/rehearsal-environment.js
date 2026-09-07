import {parseAdminPasswordHash} from '../shared/password-auth.js';
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));

// Pure pre-start boundary for generated profiles, never ambient process.env or
// sourced production files. Actual filesystem/authority/resource verification
// is additionally required in the root launcher before either role is spawned.
// Returned evidence contains neither authentication values nor their hashes.
export function validateBuyerWriterRehearsalEnvironments({descriptor,api,worker}){
  try{
    if(!exact(descriptor,['version','kind','id','releaseSha','workspace','port','postgresPort'])||descriptor.version!==1
      ||descriptor.kind!=='isolated-production-rehearsal'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(descriptor.id??'')
      ||!/^[a-f0-9]{40}$/.test(descriptor.releaseSha??'')||typeof descriptor.workspace!=='string'||!/^[A-Za-z0-9._:-]{1,128}$/.test(descriptor.workspace)
      ||[descriptor.port,descriptor.postgresPort].some(port=>!Number.isInteger(port)||port<40000||port>49000)||descriptor.port===descriptor.postgresPort)throw new Error();
    const {id}=descriptor,root=`/var/lib/blackspire-zola-rehearsal/activation/${id}`;
    const shared={NODE_ENV:'production',BLACKSPIRE_RUNTIME_MODE:'production',BLACKSPIRE_STATE_OWNER:'vps-production',BLACKSPIRE_RELEASE_ROOT:root,
      BLACKSPIRE_DB_PATH:root+'/shared/database/command.sqlite',BLACKSPIRE_DATA_DIR:root+'/shared',BLACKSPIRE_BACKUP_DIR:root+'/shared/backups',
      BLACKSPIRE_WORKSPACE_ROOT:root+'/shared/workspace',TELEGRAM_TMP_DIR:root+'/shared/telegram-files',BLACKSPIRE_PROVIDER_MODE:'manual',
      BLACKSPIRE_HERMES_MODE:'restricted',BLACKSPIRE_PRODUCTION_EXECUTION:'disabled',TELEGRAM_MODE:'dry-run',UNIFIED_IPHONE_TEST_MODE:'false',
      BLACKSPIRE_RUN_MIGRATIONS:'false',BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT:'true',BLACKSPIRE_STARTUP_TIMEOUT_SECONDS:'30',BLACKSPIRE_HEALTH_TIMEOUT_SECONDS:'5',
      BIND_HOST:'127.0.0.1',PORT:String(descriptor.port),SECURE_COOKIES:'true',RATE_LIMIT_DISABLED:'false',DEBUG:'false',TRUST_PROXY:'false',GIT_WORKFLOW_ENABLED:'false',
      PATH:'/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin',WORKER_ID:'zola-rehearsal-'+id,BLACKSPIRE_OPERATOR_PRINCIPAL_ID:'zola-rehearsal-'+id};
    const apiFixed={...shared,HOME:root+'/shared/api-home',ALLOW_BEARER_AUTH:'false',PUBLIC_BASE_URL:`https://zola-${id}.invalid`,BUYER_WRITER_MODE:'scoped',
      BUYER_WRITER_WORKSPACE_ID:descriptor.workspace,BUYER_WRITER_CONFIG_FILE:root+'/config/writer.json'};
    const workerFixed={...shared,HOME:root+'/shared/worker-home'};
    if(!exact(api,[...Object.keys(apiFixed),'SESSION_SECRET','COMMAND_ADMIN_PASSWORD_HASH'])||!exact(worker,Object.keys(workerFixed))
      ||Object.entries(apiFixed).some(([key,value])=>api[key]!==value)||Object.entries(workerFixed).some(([key,value])=>worker[key]!==value)
      ||typeof api.SESSION_SECRET!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(api.SESSION_SECRET)
      ||Buffer.from(api.SESSION_SECRET,'base64url').toString('base64url')!==api.SESSION_SECRET||!parseAdminPasswordHash(api.COMMAND_ADMIN_PASSWORD_HASH))throw new Error();
    return Object.freeze({root,artifactRoot:`${root}/releases/${descriptor.releaseSha}`,databasePath:shared.BLACKSPIRE_DB_PATH,
      apiUnit:`zola-writer-api-${id}.service`,workerUnit:`zola-writer-worker-${id}.service`,workspace:descriptor.workspace,
      releaseSha:descriptor.releaseSha,principal:shared.BLACKSPIRE_OPERATOR_PRINCIPAL_ID,workerId:shared.WORKER_ID,host:'127.0.0.1',port:descriptor.port});
  }catch{throw new Error('Buyer writer rehearsal startup environment rejected');}
}
