// Isolated local socket regression; synthetic values only, no database connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID,randomBytes} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {createBuyerWriterLocalGateway,BUYER_WRITER_LOCAL_STATEMENTS} from '../packages/buyer-writer/local-gateway-server.js';
import {createBuyerWriterLocalClient} from '../packages/buyer-writer/local-gateway-client.js';

test('gateway returns a delayed result after the client ends its request',async()=>{
  const root=fs.mkdtempSync('/tmp/zola-delayed-gateway-');fs.chmodSync(root,0o700);
  const socketPath=root+'/writer.sock',capability=randomBytes(32).toString('base64url');
  const authority={releaseSha:'a'.repeat(40),workspace:'fixture',operationId:randomUUID(),attemptId:randomUUID(),gatewayIdentity:'blackspire-writer'};
  let calls=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,timeoutMs:1000,runtimeQuery:async()=>{
    calls++;await sleep(80);return{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};
  },issuerQuery:async()=>assert.fail('unexpected issuer request')});
  const client=createBuyerWriterLocalClient({socketPath,capability,authority,timeoutMs:1000});
  try{
    await gateway.listen();const body={jobId:randomUUID(),version:1,dispatchId:randomUUID(),generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
    const result=await client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.apply,['b'.repeat(64),'fixture',JSON.stringify(body)]);
    assert.equal(result.rows[0].result.ok,true);assert.equal(calls,1);
  }finally{await gateway.close();await client.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('delayed backend errors stay sanitized and do not report success',async()=>{
  const root=fs.mkdtempSync('/tmp/zola-delayed-error-');fs.chmodSync(root,0o700);
  const socketPath=root+'/writer.sock',capability=randomBytes(32).toString('base64url');
  const authority={releaseSha:'a'.repeat(40),workspace:'fixture',operationId:randomUUID(),attemptId:randomUUID(),gatewayIdentity:'blackspire-writer'};
  let calls=0;
  const gateway=createBuyerWriterLocalGateway({socketPath,capability,authority,gatewayIdentityVerified:true,timeoutMs:1000,runtimeQuery:async()=>{
    calls++;await sleep(80);throw new Error('FIXTURE_PRIVATE_DIAGNOSTIC_NOT_FOR_CLIENT');
  },issuerQuery:async()=>assert.fail('unexpected issuer request')});
  const client=createBuyerWriterLocalClient({socketPath,capability,authority,timeoutMs:1000});
  try{
    await gateway.listen();const body={jobId:randomUUID(),version:1,dispatchId:randomUUID(),generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
    await assert.rejects(client.runtimeQuery(BUYER_WRITER_LOCAL_STATEMENTS.apply,['b'.repeat(64),'fixture',JSON.stringify(body)]),error=>error.message==='Buyer writer local gateway unavailable');
    assert.equal(calls,1);
  }finally{await gateway.close();await client.close();fs.rmSync(root,{recursive:true,force:true});}
});
