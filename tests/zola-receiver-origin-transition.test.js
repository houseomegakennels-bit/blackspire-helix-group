import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createReceiverOriginTransition,observeReceiverDeployment,validateReceiverOriginPlan} from '../packages/zola-release/receiver-origin-transition.js';
const candidate='a'.repeat(40),main='b'.repeat(40),preview='https://exact-candidate.vercel.app',production='https://blackspirehelix.com';
function fixture(t){
 const root=fs.mkdtempSync('/run/zola-receiver-origin-');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const paths={environment:path.join(root,'receiver-origin.env'),dropin:path.join(root,'worker.service.d/45-zola-receiver-origin.conf')};
 const metadata={schema:1,releaseSha:candidate,frontendOrigin:preview,deploymentId:'dpl_preview'},checks=[];let stopped=true;
 const options={paths,groupId:0,readMetadata:()=>structuredClone(metadata),verifyDeployment:async p=>{checks.push(p);},resolveProduction:async newMainSha=>({status:'VERCEL_PRODUCTION_EXACT',newMainSha,deploymentId:'dpl_production'}),assertStopped:()=>{assert.equal(stopped,true);}};
 return{root,paths,metadata,checks,options,host:createReceiverOriginTransition(options),start:()=>{stopped=false;}};
}
test('fixed receiver transition verifies exact Vercel project, deployment, source and alias twice before accepting',{timeout:5000},async()=>{
 const value={id:'dpl_preview',projectId:'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou',readyState:'READY',target:null,url:'exact-candidate.vercel.app',gitSource:{sha:candidate},meta:{githubCommitRef:'release/zola-production-live',githubCommitSha:candidate}};
 const input={releaseSha:candidate,mode:'preview',origin:preview,deploymentId:'dpl_preview'};let calls=[];
 const options={token:()=> 'fixture'.repeat(5),fetchImpl:async(url,options)=>{calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return new Response(JSON.stringify(value));}};
 assert.deepEqual(await observeReceiverDeployment(input,options),input);assert.equal(calls.length,2);assert.ok(calls.every(url=>url.startsWith('https://api.vercel.com/v13/deployments/')&&url.endsWith('?teamId=team_CaRyRaulJaFnCLSfTdyRYNIW')));
 for(const change of [{projectId:'foreign'},{target:'production'},{readyState:'BUILDING'},{id:'dpl_foreign'},{url:'foreign.vercel.app'},{gitSource:{sha:main}}]){
  await assert.rejects(observeReceiverDeployment(input,{...options,fetchImpl:async()=>new Response(JSON.stringify({...value,...change}))}));
 }
 let count=0;await assert.rejects(observeReceiverDeployment(input,{...options,fetchImpl:async()=>new Response(JSON.stringify(++count===1?value:{...value,id:'dpl_reassigned'}))}));
});
test('real stopped publication sets all four worker origins and restores prior candidate or absent state without touching credentials',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t);const credentials=path.join(f.root,'command.env');fs.writeFileSync(credentials,'UNCHANGED_PRIVATE_PROFILE=fixture\n',{mode:0o600});const original=fs.readFileSync(credentials);
 const candidatePlan=await f.host.prepare({releaseSha:candidate,mode:'preview'});assert.equal(candidatePlan.previousOrigin,null);assert.equal(fs.existsSync(f.paths.environment),false);
 await f.host.publish(candidatePlan);assert.equal(f.host.observe(candidatePlan),true);const bytes=fs.readFileSync(f.paths.environment,'utf8');for(const name of ['SELLER','BUYER','DEAL','NEXUS'])assert.ok(bytes.includes(`BLACKSPIRE_${name}_CAPABILITY_URL=${preview}\n`));assert.equal(bytes.split('\n').length,5);assert.equal(fs.statSync(f.paths.environment).mode&0o777,0o640);
 assert.equal(fs.readFileSync(f.paths.dropin,'utf8'),`[Service]\nEnvironmentFile=${f.paths.environment}\n`);
 const productionPlan=await f.host.prepare({releaseSha:main,mode:'production',candidateSha:candidate});assert.equal(productionPlan.origin,production);assert.equal(productionPlan.previousOrigin,preview);
 await f.host.publish(productionPlan);assert.equal(f.host.observe(productionPlan),true);assert.equal(await f.host.restore(productionPlan),true);assert.equal(f.host.observe(candidatePlan),true);
 assert.equal(await f.host.restore(candidatePlan),true);assert.equal(fs.existsSync(f.paths.environment),false);assert.equal(fs.existsSync(f.paths.dropin),false);assert.equal(fs.readFileSync(credentials).equals(original),true);
});
test('changed proof, partial publication, unexpected bytes and running services fail closed with bounded rollback',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t),p=await f.host.prepare({releaseSha:candidate,mode:'preview'});
 await assert.rejects(f.host.prepare({releaseSha:main,mode:'preview'}));
 const io={...fs,renameSync(source,target){if(target===f.paths.dropin)throw new Error('lost publication');fs.renameSync(source,target);}};
 const interrupted=createReceiverOriginTransition({...f.options,io});await assert.rejects(interrupted.publish(p));assert.equal(interrupted.observe(p),false);assert.equal(await f.host.restore(p),true);
 await f.host.publish(p);fs.writeFileSync(f.paths.environment,'UNKNOWN=refuse\n');assert.equal(f.host.observe(p),false);await assert.rejects(f.host.restore(p));
 const g=fixture(t),q=await g.host.prepare({releaseSha:candidate,mode:'preview'});g.start();await assert.rejects(g.host.publish(q));assert.equal(fs.existsSync(g.paths.environment),false);
 for(const change of [{extra:true},{origin:'http://127.0.0.1'},{mode:'production'},{previousDropin:true}])assert.throws(()=>validateReceiverOriginPlan({...p,...change}));
});
test('protected destination symlinks and unexpected preexisting dropins refuse',{skip:process.getuid()!==0},async t=>{
 const f=fixture(t);fs.symlinkSync('/dev/null',f.paths.environment);await assert.rejects(f.host.prepare({releaseSha:candidate,mode:'preview'}));
 const g=fixture(t);fs.mkdirSync(path.dirname(g.paths.dropin));fs.writeFileSync(g.paths.dropin,'[Service]\nEnvironment=UNEXPECTED=yes\n');await assert.rejects(g.host.prepare({releaseSha:candidate,mode:'preview'}));
});
