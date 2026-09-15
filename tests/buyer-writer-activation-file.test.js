import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/buyer-writer-publication.js';
import {publishBuyerWriterBinding} from '../packages/buyer-writer/activation-file.js';

test('publication verifies before and after atomic no-replace linking and leaves one protected inode',async()=>{
  const f=fixture(),seen=[];f.options.verify=async name=>{seen.push(name);return f.proof;};
  const result=await publishBuyerWriterBinding(f.options);
  assert.equal(result.path,f.options.filename);assert.match(result.sha256,/^[a-f0-9]{64}$/);
  assert.equal(seen.length,2);assert.notEqual(seen[0],seen[1]);assert.equal(seen[1],f.options.filename);
  assert.equal(f.files.get(f.options.filename).nlink,1);assert.equal(f.files.size,4);assert.equal(f.fds.size,0);
});
test('nonroot, unsafe ancestors, existing targets and false evidence cannot publish',async()=>{
  for(const mutate of [f=>{f.options.uid=994;},f=>{f.files.get('/etc').mode=0o777;},f=>{f.files.set(f.options.filename,f.file('existing'));},f=>{f.options.verify=async()=>true;}]){
    const f=fixture();mutate(f);const before=f.files.get(f.options.filename);
    await assert.rejects(publishBuyerWriterBinding(f.options),/^Error: Buyer writer binding publication rejected$/);
    assert.equal(f.files.get(f.options.filename),before);assert.equal(f.fds.size,0);assert.equal([...f.files.keys()].some(name=>name.endsWith('.tmp')),false);
  }
});
test('publication collision preserves the other inode and removes only this attempt temporary file',async()=>{
  const f=fixture(),other=f.file('replacement');f.io.linkSync=(_source,target)=>{f.files.set(target,other);throw Object.assign(new Error('PRIVATE'),{code:'EEXIST'});};
  await assert.rejects(publishBuyerWriterBinding(f.options),/publication rejected/);
  assert.equal(f.files.get(f.options.filename),other);assert.equal(f.files.size,4);assert.equal(f.fds.size,0);
});
test('postpublication failure removes this inode, but never removes a replacement',async()=>{
  for(const replace of [false,true]){
    const f=fixture(),other=f.file('replacement');let calls=0;
    f.options.verify=async name=>{if(++calls===2){if(replace)f.files.set(name,other);throw new Error('PRIVATE');}return f.proof;};
    await assert.rejects(publishBuyerWriterBinding(f.options),error=>error.message===(replace?'Buyer writer binding publication cleanup incomplete':'Buyer writer binding publication rejected'));
    assert.equal(f.files.get(f.options.filename),replace?other:undefined);assert.equal(f.fds.size,0);
  }
});
test('directory durability failure after linking cannot leave this binding accepted',async()=>{
  const f=fixture();f.io.fsyncSync=fd=>{if(f.fds.get(fd).directory)throw new Error('PRIVATE');};
  await assert.rejects(publishBuyerWriterBinding(f.options),/publication cleanup incomplete/);
  assert.equal(f.files.has(f.options.filename),false);assert.equal(f.fds.size,0);
});
test('a hung postpublication verifier is bounded and its binding is removed',async()=>{
  const f=fixture();let calls=0;f.options.verify=async()=>++calls===1?f.proof:new Promise(()=>{});
  await assert.rejects(publishBuyerWriterBinding(f.options),/publication rejected/);
  assert.equal(f.files.has(f.options.filename),false);assert.equal(f.fds.size,0);
});
