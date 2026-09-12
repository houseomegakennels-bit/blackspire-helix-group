import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {createBuyerWriterRequestHandler} from '../packages/buyer-writer/http.js';
const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-api-mount-'));
process.env.BLACKSPIRE_DB_PATH=path.join(temporary,'command.sqlite');
process.env.BLACKSPIRE_DATA_DIR=temporary;
process.env.NODE_ENV='test';
process.env.COMMAND_ADMIN_TOKEN='isolated-writer-api-token';
process.env.SESSION_SECRET='isolated-writer-api-session-secret-not-production';
const {prepareDisposableDatabase}=await import('./helpers/prepare-disposable-database.js');
prepareDisposableDatabase(process.env.BLACKSPIRE_DB_PATH);
const {start,healthSnapshot,readinessSnapshot,beginGracefulShutdown}=await import('../apps/api/server.js');
const {setFlag}=await import('../packages/task-engine/tasks.js');
const {getDb,closeDb}=await import('../packages/task-engine/db.js');
const credential=randomBytes(32).toString('base64url'),permit=randomBytes(32).toString('base64url');
const route='/api/internal/buyer-writer/v1/jobs/00000000-0000-4000-8000-000000000001/operations';
const body={version:1,dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,operation:'start',chunkIndex:0,chunkCount:1,payload:{}};
let server;
const servers=new Set();
function trackedStart(...args){const instance=start(...args);servers.add(instance);return instance;}
test.after(async()=>{for(const instance of servers){instance.closeAllConnections();await new Promise(resolve=>instance.close(resolve));}closeDb();fs.rmSync(temporary,{recursive:true,force:true});});
test('canonical API reserves disabled writer routes without granting session authority',async()=>{
  server=trackedStart(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  assert.equal((await fetch(`http://127.0.0.1:${server.address().port}${route}`,{method:'POST'})).status,404);
  await beginGracefulShutdown(server);server=null;
});
test('scoped configuration cannot start before dedicated runtime initialization',()=>{
  process.env.BUYER_WRITER_MODE='scoped';
  assert.throws(()=>trackedStart(0,'127.0.0.1'),/Buyer writer runtime unavailable/);
});
test('canonical API mounts scoped auth, truthful pool health and bounded shutdown',async()=>{
  let healthy=true,available=false,calls=0,closed=false;
  const handler=createBuyerWriterRequestHandler({credential,workspace:'isolated',isAvailable:()=>healthy,
    query:async()=>{calls++;return{rows:[{result:{ok:true,operation:'start',chunkIndex:0}}]};}});
  const writer={...handler,isHealthy:()=>healthy,checkAvailability:async()=>available,close:async()=>{
    assert.equal(getDb().prepare('select 1 as value').get().value,1,'authority DB closed before writer');closed=true;
  }};
  server=trackedStart(0,'127.0.0.1',{buyerWriter:writer});await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const send=(key=credential)=>fetch(base+route,{method:'POST',headers:{'content-type':'application/json','x-buyer-writer-key':key,'x-buyer-job-permit':permit},body:JSON.stringify(body)});
  assert.equal(server.maxConnections,256);
  assert.equal((await send('invalid')).status,401);assert.equal(calls,0);
  assert.equal((await send()).status,200);assert.equal(calls,1);
  assert.equal((await fetch(base+'/api/tasks')).status,401);
  assert.equal(healthSnapshot().dependencies.buyerWriter.ok,true);
  assert.equal(readinessSnapshot().checks.buyerWriter,false,'no fresh observation must fail closed');
  assert.equal(Object.hasOwn(readinessSnapshot({includeBuyerWriter:false}).checks,'buyerWriter'),false);
  assert.equal(Object.hasOwn(healthSnapshot({includeBuyerWriter:false}).dependencies,'buyerWriter'),false);
  assert.equal((await (await fetch(base+'/ready')).json()).checks.buyerWriter,false);
  available=true;
  assert.equal((await (await fetch(base+'/ready')).json()).checks.buyerWriter,true);
  writer.checkAvailability=async()=>{setFlag('emergency_stop','active');return true;};
  const stoppedReady=await fetch(base+'/ready');assert.equal(stoppedReady.status,503);
  assert.equal((await stoppedReady.json()).checks.buyerWriter,false);
  setFlag('emergency_stop','inactive');
  writer.checkAvailability=async()=>{throw new Error('PRIVATE');};
  const denied=await fetch(base+'/ready');assert.equal(denied.status,503);
  assert.equal((await denied.json()).checks.buyerWriter,false);
  healthy=false;assert.equal(healthSnapshot().ok,false);assert.equal(readinessSnapshot().ok,false);
  assert.equal((await send()).status,503);
  healthy=true;await beginGracefulShutdown(server);server=null;
  assert.equal(closed,true);assert.equal(writer.isDrained(),true);
});

test('unsupported mode and synchronous startup failure cannot retain initialized pools',async()=>{
  process.env.BUYER_WRITER_MODE='typo';
  assert.throws(()=>trackedStart(0,'127.0.0.1'),/Buyer writer runtime unavailable/);
  process.env.BUYER_WRITER_MODE='scoped';
  let stopped=false,closed=0;
  const writer={handleRequest(){},handleClientError(){},stopAdmission(){stopped=true;},isDrained:()=>true,isHealthy:()=>true,checkAvailability:async()=>true,close:async()=>{closed++;}};
  assert.throws(()=>trackedStart(-1,'127.0.0.1',{buyerWriter:writer}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(stopped,true);assert.equal(closed,1);
});
test('direct listener closure and repeated graceful shutdown close the writer exactly once',async()=>{
  let stopped=false,closed=0;
  const writer={handleRequest(){},handleClientError(){},stopAdmission(){stopped=true;},isDrained:()=>true,isHealthy:()=>true,checkAvailability:async()=>true,close:async()=>{closed++;}};
  server=trackedStart(0,'127.0.0.1',{buyerWriter:writer});await new Promise(resolve=>server.once('listening',resolve));
  await new Promise(resolve=>server.close(resolve));
  await Promise.all([beginGracefulShutdown(server),beginGracefulShutdown(server)]);server=null;
  assert.equal(stopped,true);assert.equal(closed,1);
});
