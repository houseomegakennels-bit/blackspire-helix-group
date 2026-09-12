import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerWriterBindingObserver} from '../packages/buyer-writer/binding.js';
import {createBuyerWriterCommitRecord} from '../packages/buyer-writer/commit-record.js';
function fixture(){
  const binding={version:1,workspace:'isolated',releaseSha:'a'.repeat(40),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32),createdAt:'2026-01-01T00:00:00.000Z'};
  const process=(unit,user,uid,pid,invocationId,groups)=>({unit,user,uid,euid:uid,suid:uid,fsuid:uid,pid,invocationId,state:'active',subState:'running',gid:986,egid:986,sgid:986,fsgid:986,groups,capEffective:'0',capPermitted:'0',capAmbient:'0',capInheritable:'0',noNewPrivileges:true,startTime:'123',type:'simple',notifyAccess:'none',pidFile:'',parentPid:1,controlGroup:`/system.slice/${unit}`});
  const runtime={api:process('blackspire-command.service','blackspire-api',994,111,binding.apiGeneration,[984,986]),worker:process('blackspire-command-worker.service','blackspire-worker',993,222,binding.workerGeneration,[983,986])};
  runtime.api.supervisor={...runtime.api,pid:110};runtime.api.parentPid=110;
  binding.workerAttestation=structuredClone(runtime.worker);
  const processKeys=['uid','euid','suid','fsuid','gid','egid','sgid','fsgid','groups','capEffective','capPermitted','capAmbient','capInheritable','noNewPrivileges','startTime','parentPid','pid','controlGroup'];
  binding.workerAttestation.child={...Object.fromEntries(processKeys.map(key=>[key,runtime.worker[key]])),pid:223,parentPid:222};
  const serviceKeys=['unit','user','state','subState','pid','invocationId','type','notifyAccess','pidFile','controlGroup'];
  const inspectRuntime=async()=>({api:structuredClone(runtime.api),worker:Object.fromEntries(serviceKeys.map(key=>[key,runtime.worker[key]]))});
  const snapshot={value:binding,identity:{dev:1,ino:2,mtimeMs:1}};
  const commit={value:{...createBuyerWriterCommitRecord(snapshot)},identity:{dev:1,ino:3,mtimeMs:1}};
  const options={filename:'/etc/blackspire/binding.json',credentialGroupId:984,workspace:'isolated',releaseSha:binding.releaseSha,apiGeneration:binding.apiGeneration,apiUid:994,apiPid:111,workerUid:993,readSnapshot:name=>structuredClone(name.endsWith('.commit.json')?commit:snapshot),inspectRuntime};
  return{binding,runtime,snapshot,commit,options,inspectRuntime};
}
test('binding accepts only a stable approved release and both current isolated process identities',async()=>{
  const f=fixture();assert.deepEqual(await createBuyerWriterBindingObserver(f.options)(),{approved:true,credentialsSeparated:true,workspace:'isolated',releaseSha:f.binding.releaseSha,apiGeneration:f.binding.apiGeneration,workerGeneration:f.binding.workerGeneration});
});
test('wrong binding scope, malformed metadata and protected-file failures deny before runtime inspection',async()=>{
  for(const mutate of [f=>{f.binding.workspace='other';},f=>{f.binding.apiGeneration='d'.repeat(32);},f=>{f.binding.extra=true;},f=>{f.binding.createdAt='bad';},f=>{f.options.readSnapshot=()=>{throw new Error('PRIVATE');};}]){
    const f=fixture();mutate(f);f.options.inspectRuntime=()=>assert.fail('must not inspect');assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  }
});
test('wrong systemd or effective process authority cannot pass a matching heartbeat generation',async()=>{
  for(const mutate of [
    f=>{f.binding.workerAttestation.groups.push(984);},f=>{f.binding.workerAttestation.egid=984;},f=>{f.binding.workerAttestation.euid=0;},
    f=>{f.binding.workerAttestation.capEffective='1';},f=>{f.binding.workerAttestation.noNewPrivileges=false;},f=>{f.runtime.api.pid=112;},
    f=>{f.runtime.worker.state='inactive';},f=>{f.runtime.worker.invocationId='d'.repeat(32);},f=>{f.runtime.api.user='root';},
  ]){const f=fixture();mutate(f);assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);}
});
test('PID reuse and binding replacement during inspection deny the result',async()=>{
  for(const mutate of [f=>{f.binding.workerAttestation.startTime='124';},f=>{f.snapshot.identity.ino=3;},f=>{f.binding.workerGeneration='d'.repeat(32);}]){
    const f=fixture();let calls=0;f.options.inspectRuntime=async()=>{if(++calls===2)mutate(f);return f.inspectRuntime();};
    assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  }
});
test('only overlapping runtime inspections coalesce; completed positive results are never cached',async()=>{
  const f=fixture();let release,calls=0;const gate=new Promise(resolve=>{release=resolve;});
  f.options.inspectRuntime=async()=>{calls++;await gate;return f.inspectRuntime();};
  const observe=createBuyerWriterBindingObserver(f.options),a=observe(),b=observe();release();
  assert.equal((await a).approved,true);assert.equal((await b).approved,true);assert.equal(calls,2);
  await observe();assert.equal(calls,4);
});

test('live service metadata cannot replace the root-attested worker or permit MainPID reassignment',async()=>{
  for(const mutate of [f=>{f.runtime.worker.pid=223;},f=>{f.runtime.worker.notifyAccess='all';},f=>{f.binding.workerAttestation.type='notify';},f=>{delete f.binding.workerAttestation;},f=>{f.binding.workerAttestation.extra=true;}]){
    const f=fixture();mutate(f);assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  }
});

test('both supervisor and child confinement are required',async()=>{
  for(const mutate of [f=>{f.runtime.api.supervisor.capInheritable='1';},f=>{f.runtime.api.parentPid=999;},f=>{f.runtime.api.supervisor.controlGroup='/wrong';},f=>{f.binding.workerAttestation.child.groups.push(984);},f=>{f.binding.workerAttestation.child.parentPid=999;}]){
    const f=fixture();mutate(f);assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  }
});
test('a provisional binding cannot admit writes; only explicit preparation inspection may omit commitment',async()=>{
  const f=fixture();f.options.readSnapshot=name=>{if(name.endsWith('.commit.json'))throw new Error('missing');return structuredClone(f.snapshot);};
  assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  assert.equal((await createBuyerWriterBindingObserver({...f.options,requireCommit:false})()).approved,true);
});
test('a mismatched commit or marker replacement during observation invalidates approval',async()=>{
  const f=fixture();f.commit.value.bindingInode=999;assert.equal(await createBuyerWriterBindingObserver(f.options)(),null);
  const other=fixture();let calls=0;other.options.inspectRuntime=async()=>{if(++calls===2)other.commit.identity.ino=4;return other.inspectRuntime();};
  assert.equal(await createBuyerWriterBindingObserver(other.options)(),null);
});
