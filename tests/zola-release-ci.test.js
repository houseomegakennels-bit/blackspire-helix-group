import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyReleaseCi,REQUIRED_RELEASE_CI_STEPS} from '../packages/zola-release/commander-host.js';
function fixture(){
 const releaseSha='a'.repeat(40),mainSha='b'.repeat(40),repository='houseomegakennels-bit/blackspire-helix-group',now=Date.now();
 const pr={number:125,state:'open',merged:false,draft:false,head:{sha:releaseSha,ref:'release/zola-production-live',repo:{full_name:repository}},base:{sha:mainSha,ref:'main',repo:{full_name:repository}}};
 const main={ref:'refs/heads/main',object:{type:'commit',sha:mainSha}};
 const ci={id:123,run_attempt:1,path:'.github/workflows/blackspire-ci.yml',head_sha:releaseSha,head_branch:'release/zola-production-live',repository:{full_name:repository},head_repository:{full_name:repository},event:'pull_request',status:'completed',conclusion:'success',pull_requests:[{number:125,head:{sha:releaseSha},base:{sha:mainSha}}],created_at:new Date(now-60000).toISOString(),updated_at:new Date(now).toISOString()};
 const list={total_count:1,workflow_runs:[ci]},jobs={total_count:1,jobs:[{name:'Install, migrate, test, build, lint, typecheck, scan, audit',head_sha:releaseSha,run_id:123,run_attempt:1,status:'completed',conclusion:'success',steps:REQUIRED_RELEASE_CI_STEPS.map(name=>({name,status:'completed',conclusion:'success'}))}]};
 const counts={};
 const value=route=>route==='pulls/125'?pr:route==='git/ref/heads/main'?main:route.includes('/runs?')?list:route.endsWith('/jobs?per_page=100')?jobs:route.startsWith('actions/runs/')?list.workflow_runs.find(row=>route===`actions/runs/${row.id}`)??assert.fail('unexpected run'):assert.fail('unexpected API route');
 const f={releaseSha,mainSha,now,pr,main,ci,list,jobs,counts,before:()=>{}};
 f.run=(_exe,args)=>{const route=args[1].replace(`repos/${repository}/`,'');counts[route]=(counts[route]??0)+1;f.before(route,counts[route]);return JSON.stringify(value(route));};
 f.verify=()=>verifyReleaseCi(releaseSha,{run:f.run,now});return f;
}
test('exact current-main run, attempt and complete mandatory work passes repeated observations',()=>{
 const f=fixture();assert.deepEqual(f.verify(),{releaseSha:f.releaseSha,mainSha:f.mainSha,runId:123,runAttempt:1,status:'success'});
 assert.equal(f.counts['pulls/125'],2);assert.equal(f.counts['actions/runs/123'],2);
});
test('successful CI with stale PR base metadata refuses against actual main ref',()=>{
 const f=fixture();f.main.object.sha='c'.repeat(40);assert.throws(f.verify);
});
test('aggregate success cannot hide omitted, skipped, failed or duplicate mandatory work or jobs',()=>{
 for(const mutate of [
  f=>f.jobs.jobs[0].steps.pop(),f=>f.jobs.jobs[0].steps[0].conclusion='skipped',f=>f.jobs.jobs[0].steps[0].conclusion='failure',
  f=>f.jobs.jobs[0].steps.push(f.jobs.jobs[0].steps[0]),f=>f.jobs.total_count=2,f=>f.jobs.jobs=[],
  f=>f.jobs.jobs[0].run_attempt=2,f=>f.jobs.jobs[0].head_sha='c'.repeat(40),f=>f.jobs.jobs[0].run_id=124,
 ]){const f=fixture();mutate(f);assert.throws(f.verify);}
});
test('fork source, wrong event or PR, stale/future timestamp and malformed attempt refuse',()=>{
 for(const mutate of [
  f=>f.ci.head_repository.full_name='other/fork',f=>f.ci.repository.full_name='other/fork',f=>f.ci.event='push',
  f=>f.ci.pull_requests[0].number=126,f=>f.ci.pull_requests[0].base.sha='c'.repeat(40),f=>f.ci.run_attempt=0,
  f=>f.ci.updated_at=new Date(f.now-25*60*60*1000).toISOString(),f=>f.ci.updated_at=new Date(f.now+1000).toISOString(),
 ]){const f=fixture();mutate(f);assert.throws(f.verify);}
});
test('newest run ordering is explicit; truncated or duplicate run lists refuse',()=>{
 const older=fixture();older.list.workflow_runs.push({...older.ci,id:122,created_at:new Date(older.now-120000).toISOString(),conclusion:'failure'});older.list.total_count=2;assert.equal(older.verify().runId,123);
 const f=fixture();f.list.workflow_runs.push({...f.ci,id:124,created_at:new Date(f.now-1000).toISOString(),status:'in_progress',conclusion:null});f.list.total_count=2;assert.throws(f.verify);
 const truncated=fixture();truncated.list.total_count=101;assert.throws(truncated.verify);
 const duplicate=fixture();duplicate.list.workflow_runs.push(duplicate.ci);duplicate.list.total_count=2;assert.throws(duplicate.verify);
});
test('main/head movement, rerun and newer pending run during verification refuse',()=>{
 for(const change of ['main','head','rerun','new-run']){
  const f=fixture();f.before=(route,count)=>{
   if(route==='pulls/125'&&count===2){
    if(change==='main'){f.main.object.sha='c'.repeat(40);f.pr.base.sha=f.main.object.sha;}
    if(change==='head')f.pr.head.sha='c'.repeat(40);
    if(change==='rerun')f.ci.run_attempt=2;
    if(change==='new-run'){f.list.workflow_runs.push({...f.ci,id:124,created_at:new Date(f.now-1000).toISOString(),status:'queued',conclusion:null});f.list.total_count=2;}
   }
  };assert.throws(f.verify);
 }
});
