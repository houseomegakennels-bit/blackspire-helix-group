import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
function readBounded(name){
  let fd;
  try{
    fd=fs.openSync(name,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const bytes=Buffer.alloc(4097);let used=0;
    while(used<bytes.length){const count=fs.readSync(fd,bytes,used,bytes.length-used,null);if(!count)break;used+=count;}
    if(used>4096)throw new Error();return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,used));
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

// Refuse direct shell execution: the operator command must first enter a unique
// root systemd unit with a hard lifetime and kernel memory/process limits. This
// guard runs before reading any protected writer configuration.
export async function verifyBuyerWriterActivationContainer({uid=process.getuid(),euid=process.geteuid(),pid=process.pid,read=readBounded,run=execute}={}){
  try{
    const started=performance.now();
    if(uid!==0||euid!==0||!Number.isInteger(pid)||pid<1||typeof read!=='function'||typeof run!=='function')throw new Error();
    const membership=read('/proc/self/cgroup');
    const match=typeof membership==='string'&&/^0::(\/system\.slice\/(zola-writer-activation-[a-f0-9]{32}\.service))\n$/.exec(membership);
    if(!match)throw new Error();const [,controlGroup,unit]=match;
    const number=name=>{
      const value=read(`/sys/fs/cgroup${controlGroup}/${name}`);
      if(typeof value!=='string'||!/^\d{1,12}\n?$/.test(value)||!Number.isSafeInteger(Number(value)))throw new Error();return Number(value);
    };
    const memory=number('memory.max'),tasks=number('pids.max');
    if(memory<134217728||memory>536870912||number('memory.swap.max')!==0||tasks<4||tasks>64)throw new Error();
    const properties=['Type','User','MainPID','ActiveState','SubState','RuntimeMaxUSec','KillMode','Restart'];
    const result=await run('/usr/bin/systemctl',['show','--no-pager',`--property=${properties.join(',')}`,'--',unit],{
      encoding:'utf8',timeout:600,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},
    });
    if(typeof result?.stdout!=='string'||result.stdout.length>4096||result.stderr!=='')throw new Error();
    const values={};
    for(const line of result.stdout.trim().split('\n')){
      const split=line.indexOf('='),key=line.slice(0,split);
      if(split<0||!properties.includes(key)||Object.hasOwn(values,key))throw new Error();values[key]=line.slice(split+1);
    }
    if(Object.keys(values).length!==properties.length||values.Type!=='exec'||values.User!=='root'||values.MainPID!==String(pid)
      ||values.ActiveState!=='active'||values.SubState!=='running'||!['1min','60s'].includes(values.RuntimeMaxUSec)
      ||values.KillMode!=='control-group'||values.Restart!=='no'||performance.now()-started>1000
      ||read('/proc/self/cgroup')!==membership||number('memory.max')!==memory||number('pids.max')!==tasks||number('memory.swap.max')!==0)throw new Error();
    return Object.freeze({unit,controlGroup});
  }catch{throw new Error('Buyer writer activation containment rejected');}
}
