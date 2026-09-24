import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerWriterRuntimeInspector,parseBuyerWriterProcess} from '../packages/buyer-writer/runtime-inspection.js';
const stat=(pid,start='123')=>`${pid} (name with ) parentheses) S 110 ${Array(17).fill('0').join(' ')} ${start} 0`;
const status='Uid:\t994\t994\t994\t994\nGid:\t986\t986\t986\t986\nGroups:\t984 986\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\nCapAmb:\t0000000000000000\nCapInh:\t0000000000000000\nNoNewPrivs:\t1\n';
const unit=(kind,pid)=>`Id=blackspire-command${kind==='worker'?'-worker':''}.service\nUser=blackspire-${kind}\nActiveState=active\nSubState=running\nMainPID=${pid}\nInvocationID=${(kind==='api'?'a':'b').repeat(32)}\nType=simple\nNotifyAccess=none\nPIDFile=\nControlGroup=/system.slice/blackspire-command${kind==='worker'?'-worker':''}.service\n`;
test('process parser preserves all kernel identity values and rejects malformed or reused PIDs',()=>{
  const value=parseBuyerWriterProcess(111,stat(111),status,stat(111));
  assert.equal(value.startTime,'123');assert.equal(value.fsuid,994);assert.deepEqual(value.groups,[984,986]);assert.equal(value.noNewPrivileges,true);
  for(const args of [[111,stat(111),status,stat(111,'124')],[111,stat(112),status,stat(112)],[111,stat(111),status+'Uid:\t0 0 0 0\n',stat(111)],[111,stat(111),status.replace('994\t994\t994\t994','bad'),stat(111)]]){
    assert.throws(()=>parseBuyerWriterProcess(...args),/Buyer writer runtime observation unavailable/);
  }
});
test('API observer reads only its own process and bounds fixed systemd inspection',async()=>{
  const calls=[];
  const inspect=createBuyerWriterRuntimeInspector({apiPid:111,run:async(file,args,options)=>{
    assert.equal(file,'/usr/bin/systemctl');assert.equal(options.timeout,600);assert.equal(options.maxBuffer,8192);
    assert.deepEqual(options.env,{PATH:'/usr/bin:/bin',LC_ALL:'C'});return{stdout:unit('api',110)+'\n'+unit('worker',222),stderr:''};
  },readProcess:pid=>{calls.push(pid);return {...parseBuyerWriterProcess(pid,stat(pid),status,stat(pid)),controlGroup:'/system.slice/blackspire-command.service'};}});
  const result=await inspect();assert.deepEqual(calls,[111,110]);assert.equal(result.api.uid,994);
  assert.equal(result.worker.pid,222);assert.equal(Object.hasOwn(result.worker,'uid'),false,'worker credentials must not be invented from systemd');
});
test('unknown, duplicate, reassigned and malformed systemd identities fail closed without process reads',async()=>{
  for(const change of [s=>s.replace('MainPID=110','MainPID=111'),s=>s+'\n'+unit('api',110),s=>s.replace('Type=simple','Type=notify'),s=>s.replace('NotifyAccess=none','NotifyAccess=all'),s=>s.replace('PIDFile=','PIDFile=/run/worker.pid'),s=>s.replace('User=blackspire-worker','User=root'),s=>s.replace('MainPID=222','MainPID=0'),s=>s.replace('ActiveState=active','ActiveState=inactive'),s=>s.replace('SubState=running','SubState=failed')]){
    const inspect=createBuyerWriterRuntimeInspector({apiPid:111,run:async()=>({stdout:change(unit('api',110)+'\n'+unit('worker',222)),stderr:''}),readProcess:()=>assert.fail('process read before service validation')});
    await assert.rejects(inspect(),/Buyer writer runtime observation unavailable/);
  }
});
test('tool errors are sanitized and never expose captured output',async()=>{
  for(const run of [async()=>{throw new Error('PRIVATE');},async()=>({stdout:unit('api',110)+'\n'+unit('worker',222),stderr:'PRIVATE'})]){
    await assert.rejects(createBuyerWriterRuntimeInspector({apiPid:111,run})(),error=>error.message==='Buyer writer runtime observation unavailable'&&!error.cause);
  }
});

test('API application must be the supervisor child in its exact service cgroup',async()=>{
  for(const change of [value=>({...value,parentPid:999}),value=>({...value,controlGroup:'/system.slice/unrelated.service'})]){
    const inspect=createBuyerWriterRuntimeInspector({apiPid:111,run:async()=>({stdout:unit('api',110)+'\n'+unit('worker',222),stderr:''}),readProcess:pid=>change({...parseBuyerWriterProcess(pid,stat(pid),status,stat(pid)),controlGroup:'/system.slice/blackspire-command.service'})});
    await assert.rejects(inspect(),/Buyer writer runtime observation unavailable/);
  }
});
