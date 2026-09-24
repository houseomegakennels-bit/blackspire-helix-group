import fs from 'node:fs';
import {readBuyerWriterProcess} from './runtime-inspection.js';
import {captureBuyerWriterExecutable} from './executable.js';
const id=value=>Number.isInteger(value)&&value>0&&value<=4294967294;

function readChildList(pid){
  let fd;
  try {
    fd=fs.openSync(`/proc/${pid}/task/${pid}/children`,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    const buffer=Buffer.alloc(1025);let used=0;
    while(used<buffer.length){const count=fs.readSync(fd,buffer,used,buffer.length-used,null);if(!count)break;used+=count;}
    if(used>1024)throw new Error();return buffer.subarray(0,used);
  }finally{if(fd!==undefined)fs.closeSync(fd);}
}

// Root collects the worker process information hidden from the API by
// ProtectProc. Binding validation separately enforces the safe credential
// profile and current systemd invocation; this collector does not grant approval.
export function captureBuyerWriterServiceProcesses({mainPid,role,artifactRoot,controlGroup,uid=process.getuid(),
  readProcess=readBuyerWriterProcess,readChildren=readChildList,captureExecutable=captureBuyerWriterExecutable}) {
  try {
    const started=performance.now();
    if(uid!==0||!id(mainPid)||!['api','worker'].includes(role)||typeof controlGroup!=='string'
      ||!/^\/system\.slice\/[A-Za-z0-9_.@:-]{1,128}\.service$/.test(controlGroup)
      ||[readProcess,readChildren,captureExecutable].some(value=>typeof value!=='function'))throw new Error();
    const childId=()=>{
      const bytes=readChildren(mainPid);if(!Buffer.isBuffer(bytes)||bytes.length>1024)throw new Error();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes).trim();
      if(!/^[1-9][0-9]{0,9}$/.test(text)||!id(Number(text))||Number(text)===mainPid)throw new Error();return Number(text);
    };
    const childPid=childId(),supervisor={...readProcess(mainPid),pid:mainPid},child={...readProcess(childPid),pid:childPid};
    if(child.parentPid!==mainPid||[supervisor,child].some(value=>value.controlGroup!==controlGroup))throw new Error();
    const executable=()=>({
      supervisor:captureExecutable({pid:mainPid,role,kind:'supervisor',artifactRoot}),
      child:captureExecutable({pid:childPid,role,kind:'child',artifactRoot}),
    });
    const executableEvidence=executable();
    if(childId()!==childPid||JSON.stringify(supervisor)!==JSON.stringify({...readProcess(mainPid),pid:mainPid})
      ||JSON.stringify(child)!==JSON.stringify({...readProcess(childPid),pid:childPid})
      ||JSON.stringify(executableEvidence)!==JSON.stringify(executable())||performance.now()-started>4000)throw new Error();
    return{supervisor,child,executableEvidence};
  }catch{throw new Error('Buyer writer process collection rejected');}
}
