import {createHash} from 'node:crypto';
export function ownedN8nAttempt5SupervisorArguments({operatorRoot,root}){
 if(typeof operatorRoot!=='string'||!/^\/mnt\/blackspire-builds\/development-cache\/0\/workspaces\/[A-Za-z0-9_-]+$/.test(operatorRoot)||root!=='/var/lib/blackspire-operator/preparation/owned-n8n-cloud-proof/a8e05ef40e44b6695df5b30356af0e411fe36f1a-c8b00904-7017-434a-918e-8aaadbae82fd-attempt5')throw Error('Cloud supervisor refused');
 return ['--unit=zola-n8n-cloud-proof-attempt5.service','--property=Type=exec','--property=User=root','--property=Group=root','--property=UMask=0077','--property=RuntimeMaxSec=17min','--property=TimeoutStopSec=40s','--property=Restart=no','--property=KillMode=control-group','--property=RemainAfterExit=yes','--property=NoNewPrivileges=yes','--property=StandardOutput=append:'+root+'/server.stdout.log','--property=StandardError=append:'+root+'/server.stderr.log','--setenv=PATH=/usr/bin:/bin','--setenv=HOME=/nonexistent','--','/opt/nodejs/node-v22.23.1-linux-x64/bin/node',operatorRoot+'/scripts/zola-n8n-cloud-proof-attempt5.js','--serve'];
}

export function validateOwnedN8nAttempt5Supervisor({plan,operatorRoot,root,intent,result,properties,process:observed,phase}){
 const fail=()=>{throw Error('Cloud supervisor identity refused');};
 if(!['launch','ready','complete'].includes(phase)||plan?.attempt!==5||typeof properties!=='object')fail();
 const args=ownedN8nAttempt5SupervisorArguments({operatorRoot,root});
 const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex'),same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
 const expected={version:1,planDigest:digest(plan),unit:'zola-n8n-cloud-proof-attempt5.service',argumentsDigest:digest(args)};
 if(!same(intent,expected))fail();
 for(const [k,v]of Object.entries({Type:'exec',User:'root',Group:'root',UMask:'0077',RuntimeMaxUSec:'17min',TimeoutStopUSec:'40s',Restart:'no',KillMode:'control-group',RemainAfterExit:'yes',NoNewPrivileges:'yes',ActiveState:'active'}))if(properties[k]!==v)fail();
 const command=['/opt/nodejs/node-v22.23.1-linux-x64/bin/node',operatorRoot+'/scripts/zola-n8n-cloud-proof-attempt5.js','--serve'];
 const prefix='{ path='+command[0]+' ; argv[]='+command.join(' ')+' ; ignore_errors=no ; ';
 if(typeof properties.ExecStart!=='string'||!properties.ExecStart.startsWith(prefix)||!/^start_time=[^;{}]* ; stop_time=[^;{}]* ; pid=[0-9]+ ; code=[^;{}]* ; status=[^;{}]* }$/.test(properties.ExecStart.slice(prefix.length))||!/^[a-f0-9]{32}$/.test(properties.InvocationID??''))fail();
 let identity;
 if(phase==='complete'){
  if(properties.SubState!=='exited'||properties.MainPID!=='0'||properties.Result!=='success'||properties.ExecMainStatus!=='0')fail();
  identity=result?.supervisor;if(!identity||identity.invocationId!==properties.InvocationID||!Number.isSafeInteger(identity.pid)||identity.pid<2||!(/^[0-9]+$/).test(identity.startTime??''))fail();
 }else{
  const pid=Number(properties.MainPID);if(properties.SubState!=='running'||!Number.isSafeInteger(pid)||pid<2||!observed||observed.pid!==pid||observed.uid!==0||!same(observed.command,command)||!(/^[0-9]+$/).test(observed.startTime??''))fail();identity={invocationId:properties.InvocationID,pid,startTime:observed.startTime};
 }
 if(phase!=='launch'&&!same(result,{version:1,planDigest:digest(plan),unit:expected.unit,started:true,supervisor:identity}))fail();
 return identity;
}

// The detached child can win scheduling before systemd-run returns to its parent.
// It may wait only for the exact receipt; it never starts or restarts a service.
export async function awaitOwnedN8nAttempt5SupervisorAcknowledgment({observe,readResult,validateReady,pid=process.pid,now=()=>performance.now(),pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)),timeoutMs=10000}){
 if(!Number.isSafeInteger(pid)||pid<2||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw Error('Cloud launch rendezvous refused');
 const start=now();let initial;
 for(;;){
  const identity=observe();if(identity.pid!==pid||initial&&JSON.stringify(identity)!==JSON.stringify(initial))throw Error('Cloud launch identity changed');initial??=identity;
  if(now()-start>=timeoutMs)throw Error('Cloud launch acknowledgment unknown');
  if(readResult()!==null){const ready=validateReady();if(JSON.stringify(ready)!==JSON.stringify(initial)||now()-start>=timeoutMs)throw Error('Cloud launch acknowledgment refused');return ready;}
  await pause(Math.min(100,timeoutMs-(now()-start)));
 }
}
