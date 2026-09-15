import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {validateBuyerWriterRehearsalEnvironments} from '../packages/buyer-writer/rehearsal-environment.js';
function fixture(){
  const id='00000000-0000-4000-8000-000000000001',root=`/var/lib/blackspire-zola-rehearsal/activation/${id}`;
  const descriptor={version:1,kind:'isolated-production-rehearsal',id,releaseSha:'a'.repeat(40),workspace:'isolated',port:45000,postgresPort:45001};
  const shared={NODE_ENV:'production',BLACKSPIRE_RUNTIME_MODE:'production',BLACKSPIRE_STATE_OWNER:'vps-production',BLACKSPIRE_RELEASE_ROOT:root,
    BLACKSPIRE_DB_PATH:root+'/shared/database/command.sqlite',BLACKSPIRE_DATA_DIR:root+'/shared',BLACKSPIRE_BACKUP_DIR:root+'/shared/backups',
    BLACKSPIRE_WORKSPACE_ROOT:root+'/shared/workspace',TELEGRAM_TMP_DIR:root+'/shared/telegram-files',BLACKSPIRE_PROVIDER_MODE:'manual',
    BLACKSPIRE_HERMES_MODE:'restricted',BLACKSPIRE_PRODUCTION_EXECUTION:'disabled',TELEGRAM_MODE:'dry-run',UNIFIED_IPHONE_TEST_MODE:'false',
    BLACKSPIRE_RUN_MIGRATIONS:'false',BLACKSPIRE_REQUIRE_WORKER_HEARTBEAT:'true',BLACKSPIRE_STARTUP_TIMEOUT_SECONDS:'30',BLACKSPIRE_HEALTH_TIMEOUT_SECONDS:'5',
    BIND_HOST:'127.0.0.1',PORT:'45000',SECURE_COOKIES:'true',RATE_LIMIT_DISABLED:'false',DEBUG:'false',TRUST_PROXY:'false',GIT_WORKFLOW_ENABLED:'false',
    PATH:'/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin',WORKER_ID:'zola-rehearsal-'+id,BLACKSPIRE_OPERATOR_PRINCIPAL_ID:'zola-rehearsal-'+id};
  const api={...shared,HOME:root+'/shared/api-home',ALLOW_BEARER_AUTH:'false',PUBLIC_BASE_URL:`https://zola-${id}.invalid`,BUYER_WRITER_MODE:'scoped',
    BUYER_WRITER_WORKSPACE_ID:'isolated',BUYER_WRITER_CONFIG_FILE:root+'/config/writer.json',SESSION_SECRET:randomBytes(32).toString('base64url'),COMMAND_ADMIN_PASSWORD_HASH:['v1','scrypt','16384','8','1',randomBytes(16).toString('base64url'),randomBytes(64).toString('base64url'),'p13-128'].join('$')};
  const worker={...shared,HOME:root+'/shared/worker-home'};
  return{descriptor,api,worker,root};
}
test('both explicit rehearsal environments bind identical isolated state without worker authentication secrets',()=>{
  const f=fixture(),result=validateBuyerWriterRehearsalEnvironments(f);
  assert.equal(result.root,f.root);assert.equal(result.apiUnit,'zola-writer-api-'+f.descriptor.id+'.service');
  assert.ok(!JSON.stringify(result).includes(f.api.SESSION_SECRET));assert.ok(Object.isFrozen(result));
});
test('either role can veto startup before spawning, including unknown keys, production paths and secret crossover',()=>{
  for(const mutate of [
    f=>{f.worker.BLACKSPIRE_DB_PATH='/var/lib/blackspire-command/command.sqlite';},f=>{f.api.BLACKSPIRE_DATA_DIR='/var/lib/blackspire-command';},
    f=>{f.worker.SESSION_SECRET=f.api.SESSION_SECRET;},f=>{f.worker.BUYER_WRITER_CONFIG_FILE=f.api.BUYER_WRITER_CONFIG_FILE;},
    f=>{f.worker.OPENAI_API_KEY='synthetic';},f=>{f.api.NODE_OPTIONS='--require=other';},f=>{f.api.HTTPS_PROXY='http://proxy.invalid';},
    f=>{f.worker.BLACKSPIRE_RUNTIME_USER='blackspire-api';},f=>{f.worker.INVOCATION_ID='a'.repeat(32);},
    f=>{f.worker.WORKER_ID='other';},f=>{f.api.PORT='8789';},f=>{f.api.PUBLIC_BASE_URL='https://production.invalid';},
    f=>{f.api.SESSION_SECRET='weak';},f=>{f.api.COMMAND_ADMIN_PASSWORD_HASH='invalid';},f=>{f.api.extra='';},
    f=>{f.descriptor.id='../../production';},f=>{f.descriptor.port=45001;},f=>{f.descriptor.extra=true;},
  ]){const f=fixture();mutate(f);assert.throws(()=>validateBuyerWriterRehearsalEnvironments(f),error=>error.message==='Buyer writer rehearsal startup environment rejected'&&!error.cause);}
});
