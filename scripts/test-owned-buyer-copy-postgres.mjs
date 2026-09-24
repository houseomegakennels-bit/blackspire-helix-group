import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.versions.node,'22.23.1');
const image=process.env.BUYER_WRITER_TEST_IMAGE;assert.match(image??'',/^postgres@sha256:[a-f0-9]{64}$/);
const owner=randomBytes(16).toString('hex'),prefix=`zola-owned-copy-${owner}`,names=[`${prefix}-source`,`${prefix}-target`],ids=[];
let network=null;const run=args=>spawnSync('docker',args,{encoding:'utf8',timeout:30000,maxBuffer:65536});
const requireSuccess=result=>{assert.equal(result.status,0,'disposable Docker operation failed');return result.stdout.trim();};
try{
 network=requireSuccess(run(['network','create','--internal','--label',`blackspire.test-owner=${owner}`,prefix]));assert.match(network,/^[a-f0-9]{64}$/);
 const observed=JSON.parse(requireSuccess(run(['network','inspect',network])))[0];assert.equal(observed.Internal,true);assert.equal(observed.Labels['blackspire.test-owner'],owner);
 const ports=[];
 for(const name of names){
  const id=requireSuccess(run(['create','--name',name,'--label',`blackspire.test-owner=${owner}`,'--network',network,
   '--read-only','--memory','512m','--cpus','1','--pids-limit','128','--tmpfs','/var/lib/postgresql/data:rw,size=192m','--tmpfs','/var/run/postgresql:rw,size=8m','--tmpfs','/tmp:rw,size=16m',
   '-e','POSTGRES_USER=postgres','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=postgres',image]));ids.push(id);assert.match(id,/^[a-f0-9]{64}$/);requireSuccess(run(['start',id]));
  const state=JSON.parse(requireSuccess(run(['inspect',id])))[0];assert.equal(state.Config.Labels['blackspire.test-owner'],owner);assert.equal(state.Mounts.some(m=>m.Type==='bind'||m.Type==='volume'),false);
  assert.equal(state.HostConfig.PortBindings===null||Object.keys(state.HostConfig.PortBindings).length===0,true);const peers=Object.values(state.NetworkSettings.Networks);assert.equal(peers.length,1);assert.equal(peers[0].NetworkID,network);assert.match(peers[0].IPAddress,/^172\.[0-9]+\.[0-9]+\.[0-9]+$/);ports.push(peers[0].IPAddress);
  let ready=false;for(let n=0;n<40;n++){if(run(['exec',id,'pg_isready','-h','127.0.0.1','-U','postgres','-d','postgres']).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,250));}assert.ok(ready,'disposable PostgreSQL readiness timed out');
 }
 const proof=spawnSync(process.execPath,['--max-old-space-size=256',new URL('./test-owned-buyer-copy-session.mjs',import.meta.url).pathname],{
  input:JSON.stringify({source:ports[0],target:ports[1]}),encoding:'utf8',timeout:90000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',ZOLA_DISPOSABLE_EXECUTOR:'1'},killSignal:'SIGKILL'});
 assert.equal(proof.status,0,proof.stderr?.slice(0,1500));console.log(proof.stdout.trim());
}finally{
 // Recover an uncertain creation by unpredictable ownership label; never remove
 // a name-only resource. Every cleanup target must retain our exact label.
 for(const name of names){const found=run(['inspect',name]);if(found.status!==0){assert.match(found.stderr??'',/no such (object|container)/i);continue;}const value=JSON.parse(found.stdout)[0];assert.equal(value.Config.Labels['blackspire.test-owner'],owner);requireSuccess(run(['rm','-f',value.Id]));}
 if(network){const value=JSON.parse(requireSuccess(run(['network','inspect',network])))[0];assert.equal(value.Labels['blackspire.test-owner'],owner);requireSuccess(run(['network','rm',network]));}
}
