import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const execute=promisify(execFile);
const worker=fileURLToPath(new URL('./artifact-worker.js',import.meta.url));
const sealedWorker=fileURLToPath(new URL('./sealed-artifact-worker.js',import.meta.url));

// The fixed verifier is part of the trusted operator installation, never loaded
// from a caller-selected artifact. The root launcher additionally contains this
// child in its memory-limited cgroup; V8's heap flag alone does not bound Buffers.
export async function inspectBuyerWriterArtifact(options){return inspectArtifact(options,false);}
export async function inspectSealedBuyerWriterArtifact(options){return inspectArtifact(options,true);}
async function inspectArtifact({artifactRoot,releaseSha,environment,run=execute},sealed){
  try{
    if(typeof artifactRoot!=='string'||artifactRoot.length>4096||!path.isAbsolute(artifactRoot)||path.resolve(artifactRoot)!==artifactRoot
      ||!/^[a-f0-9]{40}$/.test(releaseSha??'')||!['production','staging','disposable-staging'].includes(environment)||typeof run!=='function')throw new Error();
    const started=performance.now();
    const result=await run('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',['--max-old-space-size=128',sealed?sealedWorker:worker,artifactRoot,releaseSha,environment],{
      encoding:'utf8',timeout:10000,maxBuffer:4096,killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},
    });
    if(performance.now()-started>10500||typeof result?.stdout!=='string'||result.stdout.length>4096||result.stderr!=='')throw new Error();
    const value=JSON.parse(result.stdout);
    if(!value||Array.isArray(value)||Object.keys(value).length!==(sealed?6:3)||value.releaseSha!==releaseSha||value.environment!==environment
      ||!/^[a-f0-9]{64}$/.test(value.artifactDigest??''))throw new Error();
    if(sealed&&(value.status!=='SEALED_ARTIFACT_VERIFIED'||value.deployed!==false||value.productionAccepted!==false))throw new Error();
    return Object.freeze(value);
  }catch{throw new Error('Buyer writer artifact observation unavailable');}
}
