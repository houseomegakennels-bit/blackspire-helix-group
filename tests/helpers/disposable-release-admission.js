// Explicit test-loader composition, never imported by a runtime entrypoint.
// Preserve the real guard and kernel leases while replacing only host-owned
// authority observation with a disposable synthetic release installation.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {registerHooks} from 'node:module';

export function installDisposableReleaseAdmission() {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-release-admission-'));
  fs.writeFileSync(path.join(root,'admission.lock'),'ZOLA_RELEASE_ADMISSION_LOCK_V1\n',{mode:0o640});
  fs.chmodSync(path.join(root,'admission.lock'),0o640);
  const binding={role:'api',releaseSha:'a'.repeat(40),runId:'12345678-1234-4234-8234-123456789abc',generation:'b'.repeat(32),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32)};
  fs.writeFileSync(path.join(root,'state.json'),JSON.stringify({version:1,mode:'open',releaseSha:binding.releaseSha,runId:binding.runId,apiGeneration:binding.apiGeneration,workerGeneration:binding.workerGeneration}),{mode:0o640});
  const target=new URL('../../packages/shared/release-admission.js',import.meta.url).href;
  let compositions=0;
  const hook=registerHooks({load(url,context,nextLoad){
    const loaded=nextLoad(url,context);
    if(url!==target)return loaded;
    const original='const guard=createReleaseAdmissionGuard();',source=String(loaded.source);
    if(source.split(original).length!==2||compositions++)throw new Error('Synthetic admission composition changed');
    const replacement=`const guard=createReleaseAdmissionGuard({context:()=>(${JSON.stringify(binding)}),acquire:()=>acquireReleaseAdmissionLock({root:${JSON.stringify(root)},owner:process.getuid(),groupId:process.getgid(),checkDirectory:()=>{}}),readState:()=>JSON.parse(fs.readFileSync(${JSON.stringify(path.join(root,'state.json'))},'utf8'))});`;
    return {...loaded,source:source.replace(original,replacement)};
  }});
  const close=()=>{hook.deregister();fs.rmSync(root,{recursive:true,force:true});if(compositions!==1)throw new Error('Synthetic admission fixture was not installed');};
  close.setHeld=held=>{const file=path.join(root,'state.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));state.mode=held?'held':'open';fs.writeFileSync(file,JSON.stringify(state));};
  return close;
}
