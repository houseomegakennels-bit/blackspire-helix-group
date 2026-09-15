import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { stripTypeScriptTypes } from 'node:module';
function fixture({status=200,body=Buffer.from('{"ok":true}'),encoding,throws=false,hangs=false,late=false}={}) {
  let destroyed=false,requestDestroyed=false,deadline,options,now=0;
  const source=fs.readFileSync(new URL('../frontend/src/lib/buyer-writer-transport.ts',import.meta.url),'utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
  const post=vm.runInNewContext(`${stripTypeScriptTypes(source)}\npostBuyerWriterJson`,{
    Buffer,TextDecoder,URL,performance:{now:()=>now},
    setTimeout:fn=>{deadline=fn;return 1;},clearTimeout:()=>{},
    https:{Agent:class{destroy(){destroyed=true;}},request:(_url,config,callback)=>{
      options=config;if(throws)throw new Error('SENSITIVE CONNECT DETAIL');
      const request=new EventEmitter();request.destroy=()=>{requestDestroyed=true;};
      request.end=()=>queueMicrotask(()=>{
        if(hangs)return;
        const response=new EventEmitter();response.statusCode=status;response.headers={'content-encoding':encoding};response.destroy=()=>{};
        callback(response);if(late)now=2000;response.emit('data',body);response.emit('end');
      });return request;
    }},
  });
  return{run:()=>post(new URL('https://writer.test/issuance'),'x-buyer-issuer-key','a'.repeat(43),{test:true},1000),timeout:()=>deadline(),state:()=>({destroyed,requestDestroyed,options})};
}
test('internal writer transport verifies TLS and closes its private agent after bounded JSON success',async()=>{
  const f=fixture();assert.equal((await f.run()).ok,true);assert.equal(f.state().destroyed,true);
  assert.equal(f.state().options.rejectUnauthorized,true);assert.equal(f.state().options.method,'POST');
});
test('HTTP redirects, errors, encoded, oversized and malformed responses cannot report success',async()=>{
  for(const options of [{status:302},{status:500},{encoding:'gzip'},{body:Buffer.alloc(8193)},{body:Buffer.from([255])},{body:Buffer.from('[]')}]) {
    const f=fixture(options);await assert.rejects(f.run,error=>error.message==='Buyer writer transport unavailable.');assert.equal(f.state().destroyed,true);
  }
});
test('synchronous connection failure is sanitized and releases resources',async()=>{
  const f=fixture({throws:true});await assert.rejects(f.run,error=>error.message==='Buyer writer transport unavailable.');assert.equal(f.state().destroyed,true);
});
test('whole request deadline aborts stalled transport without retrying',async()=>{
  const f=fixture({hangs:true}),result=f.run();f.timeout();await assert.rejects(result,/transport unavailable/);
  assert.equal(f.state().destroyed,true);assert.equal(f.state().requestDestroyed,true);
});

test('late response cannot beat an elapsed monotonic deadline when timer delivery is delayed',async()=>{
  const f=fixture({late:true});await assert.rejects(f.run,/transport unavailable/);assert.equal(f.state().destroyed,true);
});
