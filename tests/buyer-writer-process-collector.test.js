import test from 'node:test';
import assert from 'node:assert/strict';
import {captureBuyerWriterServiceProcesses} from '../packages/buyer-writer/process-collector.js';
function fixture(){
  const parent={uid:993,euid:993,suid:993,fsuid:993,gid:986,egid:986,sgid:986,fsgid:986,groups:[983,986],capEffective:'0',capPermitted:'0',capAmbient:'0',capInheritable:'0',noNewPrivileges:true,startTime:'123',parentPid:1,controlGroup:'/system.slice/isolated-worker.service'};
  const child={...parent,startTime:'124',parentPid:222};
  const options={mainPid:222,role:'worker',artifactRoot:'/opt/blackspire/releases/'+'a'.repeat(40),controlGroup:parent.controlGroup,uid:0,
    readProcess:pid=>structuredClone(pid===222?parent:child),readChildren:()=>Buffer.from('223 '),
    captureExecutable:({pid,role,kind})=>{assert.equal(role,'worker');assert.equal(kind,pid===222?'supervisor':'child');return{scriptSha256:'d'.repeat(64),nodeDevice:1,nodeInode:2};},
  };
  return{parent,child,options};
}
test('root collector captures the exact supervised child and stable kernel/executable observations',()=>{
  const f=fixture(),result=captureBuyerWriterServiceProcesses(f.options);
  assert.equal(result.supervisor.pid,222);assert.equal(result.child.pid,223);assert.equal(result.child.parentPid,222);
  assert.equal(result.executableEvidence.child.scriptSha256,'d'.repeat(64));
});
test('missing or multiple children, wrong cgroups and lost parent relationships are rejected',()=>{
  for(const mutate of [f=>{f.options.readChildren=()=>Buffer.from('');},f=>{f.options.readChildren=()=>Buffer.from('223 224');},
    f=>{f.options.readChildren=()=>Buffer.from('222');},f=>{f.child.parentPid=999;},f=>{f.child.controlGroup='/other';},f=>{f.options.uid=994;},
  ]){const f=fixture();mutate(f);assert.throws(()=>captureBuyerWriterServiceProcesses(f.options),/Buyer writer process collection rejected/);}
});
test('PID reuse, child replacement and executable changes during collection fail closed',()=>{
  for(const mutate of [
    f=>{let reads=0;f.options.readChildren=()=>Buffer.from(++reads===1?'223':'224');},
    f=>{let reads=0;f.options.readProcess=pid=>({...structuredClone(pid===222?f.parent:f.child),...(++reads>2?{startTime:'999'}:{})});},
    f=>{let reads=0;f.options.captureExecutable=()=>({scriptSha256:(++reads>2?'e':'d').repeat(64),nodeDevice:1,nodeInode:2});},
    f=>{f.options.captureExecutable=()=>{throw new Error('PRIVATE');};},
  ]){const f=fixture();mutate(f);assert.throws(()=>captureBuyerWriterServiceProcesses(f.options),error=>error.message==='Buyer writer process collection rejected'&&!error.cause);}
});
