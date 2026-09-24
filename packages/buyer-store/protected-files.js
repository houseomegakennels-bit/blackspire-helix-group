import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fail} from './local-protocol.js';
export function createBuyerStoreProtectedFiles({io=fs,aclTool=spawnSync}={}){
 const acl=fd=>{const r=aclTool('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{encoding:'utf8',timeout:1000,maxBuffer:4096,stdio:['ignore','pipe','pipe',fd]});if(r.status!==0||r.error||r.signal||r.stdout!==''||r.stderr!=='')fail();};
 const sync=dir=>{const fd=io.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{io.fsyncSync(fd);}finally{io.closeSync(fd);}};
 const directory=(target,{create=false,mode=0o700,gid=0}={})=>{
  if(!path.isAbsolute(target)||path.resolve(target)!==target)fail();let p='/';
  for(const part of target.split('/').filter(Boolean)){
   const next=path.join(p,part);try{io.lstatSync(next);}catch(e){if(e.code!=='ENOENT'||!create)throw e;io.mkdirSync(next,{mode:next===target?mode:0o700});if(next===target)io.chownSync(next,0,gid);}
   const s=io.lstatSync(next);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022))fail();
   if(next===target&&create&&(s.gid!==gid||(s.mode&0o7777)!==mode))fail();
   const fd=io.openSync(next,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{acl(fd);io.fsyncSync(fd);}finally{io.closeSync(fd);}sync(p);p=next;
  }
 };
 const read=(file,{gid=0,mode=0o600,optional=false}={})=>{directory(path.dirname(file));let fd;try{fd=io.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);const s=io.fstatSync(fd);if(!s.isFile()||s.uid!==0||s.gid!==gid||s.nlink!==1||(s.mode&0o7777)!==mode||s.size<1||s.size>2*1024*1024)fail();acl(fd);const bytes=io.readFileSync(fd),after=io.fstatSync(fd);if(bytes.length!==s.size||['dev','ino','uid','gid','mode','nlink','size','mtimeMs','ctimeMs'].some(k=>s[k]!==after[k]))fail();io.fsyncSync(fd);sync(path.dirname(file));return bytes;}catch(e){if(optional&&e.code==='ENOENT')return null;throw e;}finally{if(fd!==undefined)io.closeSync(fd);}};
 const publish=(file,bytes,{gid=0,mode=0o600}={})=>{
  if(!Buffer.isBuffer(bytes)||bytes.length<1||bytes.length>2*1024*1024)fail();directory(path.dirname(file));const options={gid,mode,optional:true},old=read(file,options);if(old){if(!old.equals(bytes))fail();return;}
  const temp=file+'.pending',retained=read(temp,options);if(retained){if(!retained.equals(bytes))fail();}else{let fd;try{fd=io.openSync(temp,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o600);io.fchownSync(fd,0,gid);io.fchmodSync(fd,mode);acl(fd);io.writeFileSync(fd,bytes);io.fsyncSync(fd);}finally{if(fd!==undefined)io.closeSync(fd);}sync(path.dirname(file));}
  if(read(file,options)!==null)fail();io.renameSync(temp,file);sync(path.dirname(file));if(!read(file,{gid,mode}).equals(bytes))fail();
 };
 const record=(file,value)=>publish(file,Buffer.from(JSON.stringify(value)+'\n'));
 const value=(file,optional=false)=>{const b=read(file,{optional});return b===null?null:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));};
 return {directory,read,publish,record,value};
}
