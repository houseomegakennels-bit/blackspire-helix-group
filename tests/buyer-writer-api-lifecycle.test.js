import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerWriterApiLifecycle} from '../packages/buyer-writer/api-lifecycle.js';
test('termination during initialization never opens a late listener or closes authority before pools',async()=>{
  let ready;const pending=new Promise(resolve=>{ready=resolve;}),events=[],writer={};
  const life=createBuyerWriterApiLifecycle({initialize:()=>pending,listen:()=>assert.fail('late listener'),closeWriter:async value=>{assert.equal(value,writer);events.push('writer');},drainServer:()=>assert.fail('no listener'),closeAuthority:()=>events.push('authority')});
  const start=life.start();await new Promise(resolve=>setImmediate(resolve));
  const stop=life.stop();assert.equal(life.stop(),stop);assert.deepEqual(events,[]);
  ready(writer);await Promise.all([start,stop]);assert.deepEqual(events,['writer','authority']);
});
test('synchronous listen failure still closes its initialized writer before authority',async()=>{
  const events=[],writer={};
  const life=createBuyerWriterApiLifecycle({initialize:async()=>writer,listen:()=>{throw new Error('listen failure');},closeWriter:async value=>{assert.equal(value,writer);events.push('writer');},drainServer:()=>assert.fail('no listener'),closeAuthority:()=>events.push('authority')});
  await assert.rejects(life.start(),/listen failure/);await life.stop();assert.deepEqual(events,['writer','authority']);
});
test('normal startup drains its actual listener once, including concurrent shutdown',async()=>{
  const events=[],server={};
  const life=createBuyerWriterApiLifecycle({initialize:async()=>null,listen:()=>server,closeWriter:()=>assert.fail('server owns writer'),drainServer:async value=>{assert.equal(value,server);events.push('drain');},closeAuthority:()=>events.push('authority')});
  assert.equal(await life.start(),server);await Promise.all([life.stop(),life.stop()]);assert.deepEqual(events,['drain','authority']);
});
test('shutdown before startup prevents initialization and authority closes even if writer cleanup fails',async()=>{
  let closed=0;
  const life=createBuyerWriterApiLifecycle({initialize:()=>assert.fail('initialization after stop'),listen:()=>assert.fail('listen'),closeWriter:async()=>{throw new Error('cleanup');},drainServer:()=>assert.fail('drain'),closeAuthority:()=>{closed++;}});
  await assert.rejects(life.stop(),/cleanup/);await life.start();assert.equal(closed,1);
});
