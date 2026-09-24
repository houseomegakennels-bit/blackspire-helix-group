import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyBuyerWriterActivationContainer} from '../packages/buyer-writer/activation-container.js';
function fixture(){
  const unit='zola-writer-activation-'+'a'.repeat(32)+'.service',group='/system.slice/'+unit;
  const values={'/proc/self/cgroup':`0::${group}\n`,[`/sys/fs/cgroup${group}/memory.max`]:'536870912\n',[`/sys/fs/cgroup${group}/memory.swap.max`]:'0\n',[`/sys/fs/cgroup${group}/pids.max`]:'64\n'};
  const properties={Type:'exec',User:'root',MainPID:'111',ActiveState:'active',SubState:'running',RuntimeMaxUSec:'1min',KillMode:'control-group',Restart:'no'};
  const options={uid:0,euid:0,pid:111,read:name=>values[name],run:async()=>({stdout:Object.entries(properties).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',stderr:''})};
  return{unit,group,values,properties,options};
}
test('activation must run in its own root unit with bounded memory, processes and lifetime',async()=>{
  const f=fixture();assert.deepEqual(await verifyBuyerWriterActivationContainer(f.options),{unit:f.unit,controlGroup:f.group});
});
test('uncontained, reused, unlimited or nonroot activation contexts are rejected',async()=>{
  for(const mutate of [f=>{f.options.uid=994;},f=>{f.values['/proc/self/cgroup']='0::/\n';},f=>{f.values[`/sys/fs/cgroup${f.group}/memory.max`]='max\n';},
    f=>{f.values[`/sys/fs/cgroup${f.group}/memory.swap.max`]='1\n';},f=>{f.values[`/sys/fs/cgroup${f.group}/pids.max`]='256\n';},
    f=>{f.properties.RuntimeMaxUSec='infinity';},f=>{f.properties.MainPID='222';},f=>{f.properties.Restart='always';},f=>{f.properties.KillMode='process';},
    f=>{f.options.run=async()=>{throw new Error('PRIVATE');};},
  ]){const f=fixture();mutate(f);await assert.rejects(verifyBuyerWriterActivationContainer(f.options),error=>error.message==='Buyer writer activation containment rejected'&&!error.cause);}
});
