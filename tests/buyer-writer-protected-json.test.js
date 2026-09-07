import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {readRootOwnedJson} from '../packages/buyer-writer/protected-json.js';
function fixture({file={},directory={},contents='{"version":1}',changed=false,failure,aclResult}={}){
  const bytes=Buffer.from(contents);let position=0,closed=0,stats=0;
  const stat={uid:0,gid:42,mode:0o100640,nlink:1,size:bytes.length,dev:1,ino:2,mtimeMs:1,ctimeMs:1,isFile:()=>true,...file};
  const io={
    lstatSync:()=>({uid:0,mode:0o40755,isDirectory:()=>true,isSymbolicLink:()=>false,...directory}),
    openSync:(_path,flags)=>{assert.ok(flags&fs.constants.O_NOFOLLOW);assert.ok(flags&fs.constants.O_NONBLOCK);if(failure==='open')throw new Error('PRIVATE_SECRET');return 7;},
    fstatSync:()=>({...stat,...(++stats>1&&changed?{mtimeMs:2}:{})}),
    readSync:(_fd,buffer,offset,length)=>{if(failure==='read')throw new Error('PRIVATE_SECRET');const n=Math.min(length,bytes.length-position);bytes.copy(buffer,offset,position,position+n);position+=n;return n;},
    closeSync:()=>{closed++;if(failure==='close')throw new Error('PRIVATE_SECRET');},
  };
  return {read:filename=>readRootOwnedJson(filename??'/etc/blackspire/writer.json',{io,groupId:42,maxBytes:256,aclTool:(command,args,options)=>{assert.equal(command,'/usr/bin/getfacl');assert.equal(args.at(-1),'/proc/self/fd/3');assert.equal(options.stdio[3],7);assert.equal(options.timeout,250);assert.equal(options.maxBuffer,4096);return aclResult??{status:0,stdout:'',stderr:''};}}),closed:()=>closed,bytesRead:()=>position};
}
test('protected JSON accepts only a bounded stable root-owned API-readable file',()=>{
  const f=fixture();assert.deepEqual(f.read(),{version:1});assert.equal(f.closed(),1);
});
test('unsafe ancestors, ownership, links, modes, size and concurrent changes reject',()=>{
  assert.throws(()=>readRootOwnedJson('/etc/blackspire/writer.json'),/unavailable/);
  for(const options of [
    {directory:{uid:42}},{directory:{mode:0o40777}},{directory:{isSymbolicLink:()=>true}},{directory:{isDirectory:()=>false}},
    {file:{uid:42}},{file:{gid:43}},{file:{mode:0o100644}},{file:{mode:0o100660}},{file:{nlink:2}},
    {file:{isFile:()=>false}},{file:{size:257}},{contents:' '.repeat(257)},{changed:true},
  ])assert.throws(()=>fixture(options).read(),/^Error: Buyer writer protected configuration unavailable$/);
  for(const filename of ['relative','/etc/../etc/writer.json','/etc//writer.json','/'])assert.throws(()=>fixture().read(filename),/unavailable/);
});
test('malformed content and I/O errors expose no credential-bearing cause',()=>{
  for(const aclResult of [{status:0,stdout:'user:993:r--',stderr:''},{status:1,stdout:'',stderr:'PRIVATE'},{status:null,error:new Error('PRIVATE')},{status:0,stdout:'',stderr:'warning'}]){const f=fixture({aclResult});assert.throws(()=>f.read(),/unavailable/);assert.equal(f.closed(),1);assert.equal(f.bytesRead(),0);}
  for(const failure of ['open','read','close'])assert.throws(()=>fixture({failure}).read(),error=>error.message==='Buyer writer protected configuration unavailable'&&!error.cause);
  for(const contents of [Buffer.from([255]),'PRIVATE_SECRET','null','[]','"PRIVATE_SECRET"','{"secret":"PRIVATE_SECRET"']){
    const f=fixture({contents});assert.throws(()=>f.read(),error=>error.message==='Buyer writer protected configuration unavailable'&&!error.cause);assert.equal(f.closed(),1);
  }
});
