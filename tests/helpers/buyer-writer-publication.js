import fs from 'node:fs';
export function fixture(){
  const files=new Map(),fds=new Map();let inode=1,nextFd=3;
  const absent=()=>Object.assign(new Error('PRIVATE'),{code:'ENOENT'});
  const stat=node=>({...node,isDirectory:()=>Boolean(node.directory),isFile:()=>!node.directory,isSymbolicLink:()=>false});
  const get=name=>{if(!files.has(name))throw absent();return files.get(name);};
  const file=(content='')=>({dev:1,ino:inode++,uid:0,gid:984,mode:0o640,nlink:1,content:Buffer.from(content)});
  for(const name of ['/','/etc','/etc/blackspire'])files.set(name,{directory:true,uid:0,mode:0o755});
  const io={
    lstatSync:name=>stat(get(name)),
    openSync:(name,flags)=>{
      if(flags&fs.constants.O_CREAT){if(files.has(name))throw Object.assign(new Error('PRIVATE'),{code:'EEXIST'});files.set(name,file());}
      const fd=nextFd++;fds.set(fd,get(name));return fd;
    },
    fstatSync:fd=>stat(fds.get(fd)),fchownSync:(fd,uid,gid)=>Object.assign(fds.get(fd),{uid,gid}),fchmodSync:(fd,mode)=>{fds.get(fd).mode=mode;},
    writeFileSync:(fd,bytes)=>{fds.get(fd).content=Buffer.from(bytes);},fsyncSync:()=>{},closeSync:fd=>{fds.delete(fd);},
    linkSync:(source,target)=>{if(files.has(target))throw Object.assign(new Error('PRIVATE'),{code:'EEXIST'});const node=get(source);node.nlink++;files.set(target,node);},
    unlinkSync:name=>{const node=get(name);files.delete(name);node.nlink--;},
  };
  const value={version:1,workspace:'isolated',releaseSha:'a'.repeat(40),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
  const proof={approved:true,credentialsSeparated:true,workspace:value.workspace,releaseSha:value.releaseSha,apiGeneration:value.apiGeneration,workerGeneration:value.workerGeneration};
  const options={filename:'/etc/blackspire/binding.json',credentialGroupId:984,value,uid:0,io,verify:async()=>({...proof}),readSnapshot:name=>{
    const node=get(name);if(node.nlink!==1||node.uid!==0||node.gid!==984||node.mode!==0o640)throw new Error('PRIVATE');
    return{value:JSON.parse(node.content.toString()),identity:stat(node)};
  }};
  return{files,fds,file,io,options,proof};
}
