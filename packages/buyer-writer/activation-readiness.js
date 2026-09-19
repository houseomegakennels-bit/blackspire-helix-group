import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
const failure=()=>new Error('Buyer writer activation prerequisites rejected');

async function ownsListener({host,port,apiPid}){
  try {
    const result=await execute('/usr/bin/ss',['-H','-ltnp',`sport = :${port}`],{
      encoding:'utf8',timeout:500,maxBuffer:8192,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},
    });
    if(result.stderr!==''||result.stdout.length>8192)return false;
    const lines=result.stdout.trim().split('\n');if(lines.length!==1)return false;
    const columns=lines[0].trim().split(/\s+/),address=host==='::1'?`[::1]:${port}`:`${host}:${port}`;
    const owners=[...lines[0].matchAll(/\bpid=([1-9][0-9]*),fd=[0-9]+/g)].map(match=>Number(match[1]));
    return columns[0]==='LISTEN'&&columns[3]===address&&owners.length===1&&owners[0]===apiPid;
  }catch{return false;}
}

function readStatus(host,port,pathname,issuerCredential){
  return new Promise((resolve,reject)=>{
    let settled=false,timer;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);request.destroy();if(error)reject(failure());else resolve(value);};
    const request=http.request({hostname:host,port,path:pathname,method:'GET',agent:false,maxHeaderSize:8192,headers:{connection:'close',...(issuerCredential?{'x-buyer-issuer-key':issuerCredential}:{})}},response=>{
      if(![200,503].includes(response.statusCode)||response.headers['content-encoding']
        ||!/^application\/json(?:;\s*charset=utf-8)?$/i.test(response.headers['content-type']??'')){finish(true);return;}
      const chunks=[];let bytes=0;
      response.on('data',chunk=>{if(settled)return;bytes+=chunk.length;if(bytes>32768)finish(true);else chunks.push(chunk);});
      response.once('aborted',()=>finish(true));response.once('error',()=>finish(true));
      response.once('end',()=>{
        if(settled)return;
        try {
          const body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks,bytes)));
          if(!body||typeof body!=='object'||Array.isArray(body))throw failure();finish(false,{status:response.statusCode,body});
        }catch{finish(true);}
      });
    });
    request.once('error',()=>finish(true));timer=setTimeout(()=>finish(true),2500);request.end();
  });
}

// Read-only loopback prerequisite check. Before publication all base checks must
// pass and only writer approval is false; after publication full readiness must
// pass. Kernel socket ownership is checked on both sides of HTTP observation.
export async function checkBuyerWriterActivationReadiness({host,port,apiPid,releaseSha,environment,workerGeneration,requireWriterReady,requirePreparation=false,preparationCredential,inspectListener=ownsListener}) {
  try {
    const started=performance.now();
    if(!['127.0.0.1','::1'].includes(host)||!Number.isInteger(port)||port<1||port>65535||!Number.isInteger(apiPid)||apiPid<1||apiPid>4294967294
      ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!/^[a-f0-9]{32}$/.test(workerGeneration??'')||typeof requireWriterReady!=='boolean'
      ||typeof requirePreparation!=='boolean'||(requirePreparation&&(requireWriterReady||typeof preparationCredential!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(preparationCredential)))
      ||!['production','staging','disposable-staging'].includes(environment)||typeof inspectListener!=='function')throw failure();
    if(await inspectListener({host,port,apiPid})!==true)throw failure();
    const [healthResponse,readyResponse,preparationResponse]=await Promise.all([readStatus(host,port,'/health'),readStatus(host,port,'/ready'),
      requirePreparation?readStatus(host,port,'/api/internal/buyer-writer/v1/preparation',preparationCredential):undefined]);
    if(requirePreparation&&(preparationResponse.status!==200||preparationResponse.body.ok!==true||preparationResponse.body.prepared!==true
      ||Object.keys(preparationResponse.body).length!==2))throw failure();
    const health=healthResponse.body,ready=readyResponse.body;
    if(healthResponse.status!==200||health.ok!==true||health.database!=='available'||health.emergencyStop!==false
      ||readyResponse.status!==(requireWriterReady?200:503)||ready.ok!==requireWriterReady)throw failure();
    for(const value of [health,ready]){
      if(value.service!=='blackspire-command-api'||value.lifecycle!=='ready'||value.deploymentIdentity?.state!=='VERIFIED'
        ||value.deploymentIdentity.build?.value!==releaseSha||value.deploymentIdentity.environment?.value!==environment
        ||value.dependencies?.buyerWriter?.enabled!==true||value.dependencies.buyerWriter.ok!==true)throw failure();
      const worker=value.dependencies.worker;
      if(worker?.required!==true||worker.ok!==true||!['idle','working'].includes(worker.state)||worker.generationId!==workerGeneration
        ||!Number.isFinite(worker.heartbeatAgeMs)||worker.heartbeatAgeMs<0||worker.heartbeatAgeMs>30000)throw failure();
    }
    const keys=['lifecycle','database','productionConfig','worker','scheduler','deploymentIdentity','buyerWriter'];
    if(Object.hasOwn(ready.checks??{},'releaseAdmission'))keys.push('releaseAdmission');
    if(!ready.checks||Object.keys(ready.checks).length!==keys.length||Object.keys(ready.checks).some(key=>!keys.includes(key))
      ||keys.some(key=>ready.checks[key]!==(key==='buyerWriter'?requireWriterReady:true)))throw failure();
    if(await inspectListener({host,port,apiPid})!==true||performance.now()-started>3600)throw failure();
    return Object.freeze({verified:true,workerGeneration});
  }catch{throw failure();}
}
