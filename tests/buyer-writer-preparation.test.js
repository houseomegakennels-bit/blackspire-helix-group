import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createBuyerWriterHttpServer} from '../packages/buyer-writer/http.js';
test('issuer-authenticated preparation is read-only and cannot enable writes without commitment',async()=>{
  const credential=randomBytes(32).toString('base64url'),issuerKey=randomBytes(32).toString('base64url');let prepared=false,queries=0;
  const server=createBuyerWriterHttpServer({credential,workspace:'isolated',query:async()=>{queries++;throw new Error();},
    isAvailable:async()=>false,isPrepared:async()=>prepared,issuer:{credential:issuerKey,query:async()=>{queries++;throw new Error();}}});
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}/api/internal/buyer-writer/v1`;
    assert.equal((await fetch(base+'/preparation')).status,401);
    assert.equal((await fetch(base+'/preparation',{headers:{'x-buyer-issuer-key':credential}})).status,401);
    assert.equal((await fetch(base+'/preparation',{headers:{'x-buyer-issuer-key':issuerKey}})).status,503);
    prepared=true;
    const ready=await fetch(base+'/preparation',{headers:{'x-buyer-issuer-key':issuerKey}});assert.equal(ready.status,200);assert.deepEqual(await ready.json(),{ok:true,prepared:true});
    assert.equal((await fetch(base+'/preparation',{method:'POST',headers:{'x-buyer-issuer-key':issuerKey}})).status,405);
    const denied=await fetch(base+'/jobs/00000000-0000-4000-8000-000000000001/operations',{method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':credential,'x-buyer-job-permit':randomBytes(32).toString('base64url')},body:'{}'});
    assert.equal(denied.status,503);assert.equal(queries,0);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
