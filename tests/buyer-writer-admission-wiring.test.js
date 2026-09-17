import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,randomUUID} from 'node:crypto';
import {createBuyerWriterLocalGateway,BUYER_WRITER_LOCAL_STATEMENTS} from '../packages/buyer-writer/local-gateway-server.js';
import {createBuyerWriterLocalClient} from '../packages/buyer-writer/local-gateway-client.js';
import {startBuyerWriterGateway,validateBuyerWriterGatewayServiceConfiguration} from '../packages/buyer-writer/gateway-entry.js';
import {BUYER_WRITER_DEFAULT_SOCKET} from '../packages/buyer-writer/local-gateway-protocol.js';
import {BUYER_WRITER_ADMISSION_LOGIN} from '../packages/buyer-writer/admission-postgres.js';

const id=()=>randomUUID();
const workspace='isolated';
const authority={releaseSha:'a'.repeat(40),operationId:id(),attemptId:id(),workspace,gatewayIdentity:'blackspire-writer'};
const capability=randomBytes(32).toString('base64url');
const permitConfiguration=JSON.stringify({issuer:'issuer',audience:'audience',subject:id(),keyId:'key',
  origin:'https://writer.invalid',releaseSha:authority.releaseSha,operationId:authority.operationId,
  attemptId:authority.attemptId,workspace});
const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const credential=()=>randomBytes(32).toString('base64url');
const runtime={host:'db.invalid',port:5432,database:'isolated',password:credential(),ca};
const issuer={host:'db.invalid',port:5432,database:'isolated',password:credential(),ca};
const admission={connection:{host:'db.invalid',port:5432,database:'isolated',user:BUYER_WRITER_ADMISSION_LOGIN,
  password:credential(),ca},operationPermitConfiguration:permitConfiguration,
  publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'})};
const serviceConfig={version:3,mode:'research-admission',workspace,socketPath:BUYER_WRITER_DEFAULT_SOCKET,
  gatewayCapability:capability,creatorOid:16384,authority,runtime,issuer,admission};

test('research service configuration and startup wire only the attested admission executor into the bridge',async()=>{
  assert.equal(validateBuyerWriterGatewayServiceConfiguration(serviceConfig).mode,'research-admission');
  for(const bad of [{...serviceConfig,extra:true},{...serviceConfig,mode:'production'},
    {...serviceConfig,admission:{...admission,connection:{...admission.connection,user:'admin'}}},
    {...serviceConfig,admission:{...admission,connection:{...admission.connection,host:'other.invalid'}}},
    {...serviceConfig,admission:{...admission,connection:{...admission.connection,password:runtime.password}}},
    {...serviceConfig,admission:{...admission,operationPermitConfiguration:JSON.stringify({...JSON.parse(permitConfiguration),workspace:'other'})}},
    {...serviceConfig,admission:{...admission,publicKeyPem:generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'})}}])
    assert.throws(()=>validateBuyerWriterGatewayServiceConfiguration(bad),/startup rejected/);
  const events=[],executor={},database={runtimeQuery(){},issuerQuery(){},close:async()=>events.push('database-close')};
  const admissionDatabase={executor,close:async()=>events.push('admission-close')};
  const gateway={listen:async()=>events.push('listen'),close:async()=>events.push('gateway-close')};
  const started=await startBuyerWriterGateway({configurationFile:'/ignored',
    resolveIdentity:()=>({verified:true}),read:()=>serviceConfig,
    createPostgres:async options=>{assert.deepEqual(options,{runtime,issuer,creatorOid:16384});return database;},
    createAdmissionPostgres:async options=>{assert.deepEqual(options,{connection:admission.connection,expectedCreatorOid:16384});return admissionDatabase;},
    createBridge:options=>{assert.equal(options.mode,'research-admission');assert.equal(options.admissionExecutor,executor);
      assert.equal(options.configuration,permitConfiguration);return async()=>({status:503,body:{ok:false}});},
    createGateway:options=>{assert.equal(typeof options.admissionBridge,'function');return gateway;}});
  assert.equal(started.admissionDatabase,admissionDatabase);
  await started.close();
  assert.deepEqual(events,['listen','gateway-close','database-close','admission-close']);
});

test('research local transport preserves signed bytes and ordered headers and closes legacy apply and receipt',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-admission-wire-'));fs.chmodSync(root,0o700);
  const socketPath=path.join(root,'writer.sock'),captured=[],runtimeCalls=[],issuerCalls=[];
  const criteria={state:'NC',county:'Wake',property_type:'land',date_range_start:'2026-01-01',
    date_range_end:'2026-12-31',min_purchases:1,cash_buyers_only:false,llc_buyers_only:false};
  const context={version:1,mode:'county_fetch',sources:[{sourceId:id(),sourceType:'arcgis',
    endpointId:'approved-fixture',endpointConfigDigest:'b'.repeat(64),cashDisabled:false}],
    budgets:{maxRequests:10,maxRows:100,maxBytes:10000},rawPayload:null};
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,
    admissionBridge:async request=>{captured.push(request);return {status:200,body:{ok:true,operation:'start',chunkIndex:0,automaticRetry:false}};},
    runtimeQuery:async(text,values)=>{runtimeCalls.push([text,values]);
      return {rows:[{result:{criteria,sourceContext:context,sourceContextDigest:'c'.repeat(64)}}]};},
    issuerQuery:async(text,values)=>{issuerCalls.push([text,values]);return {rows:[{result:null}]};}});
  const client=createBuyerWriterLocalClient({socketPath,capability,authority});
  try{
    await gateway.listen();
    const body=Buffer.from('{"envelope":{"note":"exact bytes: é","padding":"  "}}');
    const rawHeaders=['X-Trace','first','Authorization','Bearer signed.token.value',
      'x-trace','second','Content-Type','application/json','Content-Length',String(body.length)];
    const result=await client.admittedApply({origin:'https://writer.invalid',method:'POST',
      path:'/rest/v1/rpc/apply',rawHeaders,body});
    assert.deepEqual(result,{status:200,body:{ok:true,operation:'start',chunkIndex:0,automaticRetry:false}});
    assert.equal(captured.length,1);assert.equal(captured[0].origin,'https://writer.invalid');
    assert.equal(captured[0].method,'POST');assert.equal(captured[0].path,'/rest/v1/rpc/apply');
    assert.deepEqual(captured[0].rawHeaders,rawHeaders);assert.equal(Buffer.compare(captured[0].body,body),0);

    const jobId=id(),dispatchId=id(),permitDigest='d'.repeat(64);
    assert.deepEqual(await client.readiness(),{status:'ready',protocolVersion:1,releaseShaMatch:true,
      workspaceMatch:true,authorityBindingLoaded:true,databaseConfigurationPresent:true,gatewayIdentityMatch:true});
    const contextResult=await client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.context,
      [permitDigest,workspace,jobId,dispatchId,1]);
    assert.equal(contextResult.rows[0].result.sourceContextDigest,'c'.repeat(64));
    const owner=id();
    assert.deepEqual(await client.issuerQuery(BUYER_WRITER_LOCAL_STATEMENTS.cancel,[jobId,owner,workspace]),{rows:[{result:null}]});

    const operation={jobId,version:1,dispatchId,generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
    await assert.rejects(client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.apply,
      [permitDigest,workspace,JSON.stringify(operation)]),/unavailable/);
    await assert.rejects(client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.receipt,
      [permitDigest,workspace,jobId,dispatchId,1,'start',0]),/unavailable/);
    assert.equal(runtimeCalls.length,1);assert.equal(issuerCalls.length,1);assert.equal(captured.length,1);
  }finally{await gateway.close();await client.close();fs.rmSync(root,{recursive:true,force:true});}
});
