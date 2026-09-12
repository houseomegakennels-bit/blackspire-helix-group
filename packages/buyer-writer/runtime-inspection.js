import fs from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const positive=value=>Number.isInteger(value)&&value>0&&value<=4294967294;
const number=value=>/^(0|[1-9][0-9]{0,9})$/.test(value)&&Number(value)<=4294967294?Number(value):NaN;
const failure=()=>new Error('Buyer writer runtime observation unavailable');

// The command name can contain spaces and closing parentheses. Field 22 follows
// the final closing parenthesis, not the first one or a whitespace split of comm.
export function parseBuyerWriterProcess(pid,before,status,after) {
  try {
    if(!positive(pid)||[before,status,after].some(value=>typeof value!=='string'||value.length>16384))throw failure();
    const start=stat=>{
      if(!stat.startsWith(`${pid} (`))throw failure();
      const close=stat.lastIndexOf(')'),fields=stat.slice(close+2).trim().split(/\s+/);
      if(close<0||stat[close+1]!==' '||!/^\S$/.test(fields[0])||!/^[1-9][0-9]{0,19}$/.test(fields[19]??''))throw failure();
      return {startTime:fields[19],parentPid:number(fields[1])};
    };
    const first=start(before),last=start(after);
    if(!positive(first.parentPid)||first.startTime!==last.startTime||first.parentPid!==last.parentPid)throw failure();
    const {startTime,parentPid}=first;
    const expected=['Uid','Gid','Groups','CapEff','CapPrm','CapAmb','CapInh','NoNewPrivs'],found={};
    for(const line of status.split('\n')){
      const split=line.indexOf(':');if(split<0)continue;
      const key=line.slice(0,split);if(!expected.includes(key))continue;
      if(Object.hasOwn(found,key))throw failure();found[key]=line.slice(split+1).trim();
    }
    if(Object.keys(found).length!==expected.length)throw failure();
    const ids=key=>{
      const values=found[key].split(/\s+/).map(number);
      if(values.length!==4||values.some(value=>!Number.isInteger(value)))throw failure();return values;
    };
    const [uid,euid,suid,fsuid]=ids('Uid'),[gid,egid,sgid,fsgid]=ids('Gid');
    const groups=found.Groups===''?[]:found.Groups.split(/\s+/).map(number);
    if(groups.length>64||groups.some(value=>!Number.isInteger(value))||!['0','1'].includes(found.NoNewPrivs)
      ||['CapEff','CapPrm','CapAmb','CapInh'].some(key=>! /^[a-fA-F0-9]{1,16}$/.test(found[key])))throw failure();
    return {uid,euid,suid,fsuid,gid,egid,sgid,fsgid,groups,startTime,parentPid,capEffective:found.CapEff,capPermitted:found.CapPrm,capAmbient:found.CapAmb,capInheritable:found.CapInh,noNewPrivileges:found.NoNewPrivs==='1'};
  }catch{throw failure();}
}

function readProcFile(pid,name) {
  let fd;
  try {
    fd=fs.openSync(`/proc/${pid}/${name}`,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const buffer=Buffer.alloc(16385);let used=0;
    while(used<buffer.length){const count=fs.readSync(fd,buffer,used,buffer.length-used,null);if(!count)break;used+=count;}
    if(used>16384)throw failure();
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,used));
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

export function readBuyerWriterProcess(pid) {
  try {
    if(!positive(pid))throw failure();
    const before=readProcFile(pid,'stat'),status=readProcFile(pid,'status'),cgroup=readProcFile(pid,'cgroup');
    const result=parseBuyerWriterProcess(pid,before,status,readProcFile(pid,'stat'));
    if(!/^0::\/[A-Za-z0-9_./:@\\-]{1,1024}\n$/.test(cgroup))throw failure();
    return {...result,controlGroup:cgroup.slice(3,-1)};
  }catch{throw failure();}
}

// API ProtectProc=invisible intentionally hides the worker. Return only live
// worker service metadata: its credential restrictions must come from a separate
// root-protected activation attestation, never a guess from unit configuration.
export function createBuyerWriterRuntimeInspector({apiPid=process.pid,apiUnit='blackspire-command.service',workerUnit='blackspire-command-worker.service',run=execute,readProcess=readBuyerWriterProcess}={}) {
  if(!positive(apiPid)||[apiUnit,workerUnit].some(value=>typeof value!=='string'||!/^[A-Za-z0-9_.@:-]{1,128}\.service$/.test(value))
    ||apiUnit===workerUnit||typeof run!=='function'||typeof readProcess!=='function')throw failure();
  const properties=['Id','User','ActiveState','SubState','MainPID','InvocationID','Type','NotifyAccess','PIDFile','ControlGroup'];
  return async()=>{
    try {
      const started=performance.now();
      const result=await run('/usr/bin/systemctl',['show','--no-pager',`--property=${properties.join(',')}`,'--',apiUnit,workerUnit],{
        encoding:'utf8',timeout:600,maxBuffer:8192,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},
      });
      if(performance.now()-started>800||typeof result?.stdout!=='string'||result.stdout.length>8192||result.stderr!=='')throw failure();
      const blocks=result.stdout.trim().split(/\n\n+/);if(blocks.length!==2)throw failure();
      const output={};
      for(const block of blocks){
        const values={};
        for(const line of block.split('\n')){
          const split=line.indexOf('='),key=line.slice(0,split);
          if(split<0||!properties.includes(key)||Object.hasOwn(values,key))throw failure();values[key]=line.slice(split+1);
        }
        const kind=values.Id===apiUnit?'api':values.Id===workerUnit?'worker':null;
        if(!kind||output[kind]||Object.keys(values).length!==properties.length||values.User!==`blackspire-${kind}`
          ||values.ControlGroup!==`/system.slice/${values.Id}`
          ||values.ActiveState!=='active'||values.SubState!=='running'||!positive(number(values.MainPID))
          ||!/^[a-f0-9]{32}$/.test(values.InvocationID)||values.Type!=='simple'||values.NotifyAccess!=='none'||values.PIDFile!=='')throw failure();
        output[kind]={unit:values.Id,user:values.User,state:values.ActiveState,subState:values.SubState,pid:number(values.MainPID),invocationId:values.InvocationID,type:values.Type,notifyAccess:values.NotifyAccess,pidFile:values.PIDFile,controlGroup:values.ControlGroup};
      }
      if(output.api.pid===apiPid||output.worker.pid===apiPid||output.api.pid===output.worker.pid)throw failure();
      const application=readProcess(apiPid),supervisor=readProcess(output.api.pid);
      if(application.parentPid!==output.api.pid||application.controlGroup!==output.api.controlGroup||supervisor.controlGroup!==output.api.controlGroup)throw failure();
      output.api={...output.api,...application,pid:apiPid,supervisor:{...supervisor,pid:output.api.pid}};
      if(performance.now()-started>800)throw failure();
      return output;
    }catch{throw failure();}
  };
}
