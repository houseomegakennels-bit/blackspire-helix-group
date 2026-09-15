import test from 'node:test';
import assert from 'node:assert/strict';
import {BUYER_WRITER_GATEWAY_CONFIG,observeBuyerWriterConfiguredIsolation,observeBuyerWriterRuntimeIsolation}
 from '../packages/zola-release/pg-net-host-observer.js';
import {APPLICATION_FUNCTION_PG_NET_SQL} from '../packages/zola-release/pg-net-isolation.js';
import {PROVIDER_ACL_CHECK_SQL,queryFixedProviderAcl} from '../packages/zola-release/production-acl-writer.js';

const releaseSha='a'.repeat(40),secret=Buffer.alloc(32,7).toString('base64url');
const gateway={version:2,workspace:'blackspire-command',socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:secret,
 authority:{releaseSha,operationId:'11111111-1111-4111-8111-111111111111',attemptId:'22222222-2222-4222-8222-222222222222',
  workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'},
 runtime:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:'runtime-secret'},
 issuer:{host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:'issuer-secret'}};
const snapshot=()=>({value:structuredClone(gateway),identity:{uid:0,gid:61001,mode:0o100640,nlink:1,size:1,dev:1,ino:1,mtimeMs:1,ctimeMs:1}});
const state=(user)=>({ActiveState:'inactive',SubState:'dead',MainPID:'0',User:user,Group:'blackspire'});
const unit=(name,text='[Service]\nEnvironmentFile=/etc/blackspire/test.env\n')=>({text,
 state:state(name==='blackspire-command.service'?'blackspire-api':'blackspire-worker')});
const lookup=(_file,args)=>args[0]==='group'&&args[1]==='blackspire-writer'?'blackspire-writer:x:61001:\n':(()=>{throw new Error('unexpected lookup');})();
const baseDeps={run:lookup,readSnapshot:snapshot,readUnit:unit,readEnv:()=>`NODE_ENV=production\nBLACKSPIRE_RUNTIME_MODE=production\n`,
 canRead:user=>user==='blackspire-writer'};

test('configured-state isolation proves inactive API/worker configuration and gateway-secret denial',()=>{
 const result=observeBuyerWriterConfiguredIsolation({releaseSha},baseDeps);
 assert.deepEqual(result,{applicationDbCredentialsAbsent:true,apiConfiguredCredentialsAbsent:true,workerConfiguredCredentialsAbsent:true,
  apiGatewaySecretDenied:true,workerGatewaySecretDenied:true,gatewayCredentialReadable:true,configuredStateVerified:true});
});

test('configured-state isolation fails closed on prohibited keys or secret readability',()=>{
 const prohibited=observeBuyerWriterConfiguredIsolation({releaseSha},{...baseDeps,readEnv:()=>`NODE_ENV=production\nDATABASE_URL=not-disclosed\n`});
 assert.equal(prohibited.configuredStateVerified,false);assert.equal(prohibited.apiConfiguredCredentialsAbsent,false);
 const readable=observeBuyerWriterConfiguredIsolation({releaseSha},{...baseDeps,canRead:()=>true});
 assert.equal(readable.configuredStateVerified,false);assert.equal(readable.apiGatewaySecretDenied,false);
});

test('configured-state isolation catches prohibited authority in non-Environment unit directives',()=>{
 for(const text of ['[Service]\nPassEnvironment=DATABASE_URL\n','[Service]\nLoadCredential=database:PGPASSWORD\n',
  '[Service]\nExecStart=/usr/bin/env BUYER_WRITER_RUNTIME_PASSWORD=hidden /bin/false\n']){
  const result=observeBuyerWriterConfiguredIsolation({releaseSha},{...baseDeps,readUnit:name=>unit(name,text)});
  assert.equal(result.configuredStateVerified,false);
  assert.equal(result.apiConfiguredCredentialsAbsent,false);
 }
});

test('configured-state acceptance does not weaken final running-state requirements',()=>{
 assert.equal(observeBuyerWriterConfiguredIsolation({releaseSha},baseDeps).configuredStateVerified,true);
 assert.deepEqual(observeBuyerWriterRuntimeIsolation({releaseSha},baseDeps),{applicationDbCredentialsAbsent:false,
  gatewayTransportVerified:false,arbitrarySqlDenied:false,arbitraryFunctionDenied:false,arbitraryUrlDenied:false});
});

test('operator catalog observer accepts only two fixed read-only statements and never exposes configuration',async()=>{
 const calls=[];let ended=0,released=0;
 class Pool{constructor(config){assert.equal(config.user,'buyer_writer_runtime');assert.equal(config.password,'runtime-secret');
   assert.equal(config.options.includes('default_transaction_read_only=on'),true);}
  async connect(){return{query:async(sql,values)=>{calls.push([sql,values]);return sql==='begin read only'||sql==='rollback'?{}:{rows:[]};},
   release:destroy=>{assert.equal(destroy,true);released++;}};}
  async end(){ended++;}}
 const deps={Pool,lookup:()=>`blackspire-writer:x:61001:\n`,readSnapshot:snapshot};
 for(const sql of [APPLICATION_FUNCTION_PG_NET_SQL,PROVIDER_ACL_CHECK_SQL]){
  const result=await queryFixedProviderAcl(BUYER_WRITER_GATEWAY_CONFIG,sql,[],deps);assert.deepEqual(result,{rows:[]});
 }
 assert.deepEqual(calls.map(([sql])=>sql),['begin read only',APPLICATION_FUNCTION_PG_NET_SQL,'rollback','begin read only',PROVIDER_ACL_CHECK_SQL,'rollback']);
 assert.equal(ended,2);assert.equal(released,2);
 await assert.rejects(()=>queryFixedProviderAcl(BUYER_WRITER_GATEWAY_CONFIG,'select $1',[1],deps),/operation rejected/);
 await assert.rejects(()=>queryFixedProviderAcl('/etc/blackspire/legacy.json',APPLICATION_FUNCTION_PG_NET_SQL,[],deps),/operation rejected/);
});
