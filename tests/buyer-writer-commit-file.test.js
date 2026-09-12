import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './helpers/buyer-writer-publication.js';
import {publishBuyerWriterBinding} from '../packages/buyer-writer/activation-file.js';
import {commitBuyerWriterBinding} from '../packages/buyer-writer/commit-file.js';
async function prepared(){
  const f=fixture(),binding=await publishBuyerWriterBinding(f.options);
  const options={filename:binding.path,credentialGroupId:984,expectedBinding:binding,io:f.io,readSnapshot:f.options.readSnapshot,uid:0};
  return{...f,binding,commitOptions:options,marker:binding.path+'.commit.json'};
}
test('commit publishes a protected one-link marker bound to the exact prepared inode and digest',async()=>{
  const f=await prepared(),result=await commitBuyerWriterBinding(f.commitOptions);
  assert.equal(result.path,f.marker);assert.equal(f.files.get(f.marker).nlink,1);assert.equal(f.fds.size,0);
  assert.equal(JSON.parse(f.files.get(f.marker).content).bindingInode,f.binding.identity.ino);
});
test('existing commit, replaced preparation and changed preparation content are refused',async()=>{
  for(const mutate of [f=>f.files.set(f.marker,f.file('existing')),f=>f.files.set(f.binding.path,f.file(JSON.stringify(f.options.value))),
    f=>{f.files.get(f.binding.path).content=Buffer.from(JSON.stringify({...f.options.value,workspace:'other'})+'\n');},
  ]){const f=await prepared();mutate(f);const existing=f.files.get(f.marker);await assert.rejects(commitBuyerWriterBinding(f.commitOptions),/Buyer writer commit rejected/);assert.equal(f.files.get(f.marker),existing);}
});
test('uncertain link or unlink outcomes never clean a temporary link into accidental commitment',async()=>{
  for(const stage of ['link','unlink','unlink-completed']){
    const f=await prepared();const link=f.io.linkSync,unlink=f.io.unlinkSync;
    if(stage==='link')f.io.linkSync=(a,b)=>{link(a,b);throw new Error('PRIVATE');};
    else f.io.unlinkSync=name=>{if(stage==='unlink-completed')unlink(name);throw new Error('PRIVATE');};
    await assert.rejects(commitBuyerWriterBinding(f.commitOptions),error=>error.message==='Buyer writer activation outcome unknown'&&!error.cause);
    assert.equal(f.files.get(f.marker).nlink,stage==='unlink-completed'?1:2,'uncertain outcome must preserve the actual commit state');
    f.io.unlinkSync=unlink;
  }
});
test('directory sync failure after commitment preserves the accepted marker for reconciliation',async()=>{
  const f=await prepared();f.io.fsyncSync=fd=>{if(f.fds.get(fd).directory)throw new Error('PRIVATE');};
  await assert.rejects(commitBuyerWriterBinding(f.commitOptions),/Buyer writer activation outcome unknown/);
  assert.equal(f.files.get(f.marker).nlink,1);assert.equal(f.fds.size,0);
});

test('final synchronous configuration fence rejects drift or asynchronous approval before any commit link',async()=>{
  for(const beforeCommit of [()=>{throw new Error('PRIVATE');},()=>Promise.resolve()]){
    const f=await prepared();await assert.rejects(commitBuyerWriterBinding({...f.commitOptions,beforeCommit}),/Buyer writer commit rejected/);
    assert.equal(f.files.has(f.marker),false);
  }
});
