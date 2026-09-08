import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {verifyReleaseCi,REQUIRED_RELEASE_CI_STEPS} from '../packages/zola-release/commander-host.js';
function fixture(){
 const releaseSha='a'.repeat(40),mainSha='b'.repeat(40),repository='houseomegakennels-bit/blackspire-helix-group',now=Date.now();
 const pr={number:125,state:'open',merged:false,draft:false,head:{sha:releaseSha,ref:'release/zola-production-live',repo:{full_name:repository}},base:{sha:mainSha,ref:'main',repo:{full_name:repository}}};
 const main={ref:'refs/heads/main',object:{type:'commit',sha:mainSha}};
 const ci={id:123,run_attempt:1,path:'.github/workflows/blackspire-ci.yml',head_sha:releaseSha,head_branch:'release/zola-production-live',repository:{full_name:repository},head_repository:{full_name:repository},event:'pull_request',status:'completed',conclusion:'success',pull_requests:[{number:125,head:{sha:releaseSha},base:{sha:mainSha}}],created_at:new Date(now-60000).toISOString(),updated_at:new Date(now).toISOString()};
 const list={total_count:1,workflow_runs:[ci]},jobs={total_count:1,jobs:[{name:'Install, migrate, test, build, lint, typecheck, scan, audit',head_sha:releaseSha,run_id:123,run_attempt:1,status:'completed',conclusion:'success',steps:REQUIRED_RELEASE_CI_STEPS.map(name=>({name,status:'completed',conclusion:'success'}))}]};
 const zip=Buffer.from('fixture-zip'),zipDigest='sha256:'+createHash('sha256').update(zip).digest('hex');
 const metadata={repository,environment:'disposable-staging',commit:'d'.repeat(40),tree:'e'.repeat(40),artifactDigest:'f'.repeat(64),node:'v22.23.1',runId:'123',runAttempt:'1'};
 const artifact={id:456,name:'blackspire-build-metadata-123-1',expired:false,size_in_bytes:zip.length,digest:zipDigest,workflow_run:{id:123,head_sha:releaseSha,head_branch:'release/zola-production-live'}};
 const archive={metadata,evidence:{repository,expectedEnvironment:metadata.environment,commitSha:metadata.commit,artifact:{digest:metadata.artifactDigest},runtime:{nodeVersion:metadata.node},ci:{runId:'123'},buildId:'123.1'},commit:metadata.commit};
 const tested={sha:metadata.commit,tree:{sha:metadata.tree},parents:[{sha:mainSha},{sha:releaseSha}]};
 const counts={};
 const value=route=>route.includes('/artifacts?')?{total_count:1,artifacts:[artifact]}:route.startsWith('git/commits/')?tested:route==='pulls/125'?pr:route==='git/ref/heads/main'?main:route.includes('/runs?')?list:route.endsWith('/jobs?per_page=100')?jobs:route.startsWith('actions/runs/')?list.workflow_runs.find(row=>route===`actions/runs/${row.id}`)??assert.fail('unexpected run'):assert.fail('unexpected API route');
 const f={releaseSha,mainSha,now,pr,main,ci,list,jobs,counts,artifact,archive,tested,zip,before:()=>{}};
 f.run=(_exe,args,options)=>{if(_exe==='/usr/bin/python3'){assert.deepEqual(options.stdio,['pipe','pipe','pipe']);assert.deepEqual(options.input,f.zip);return JSON.stringify(archive);}if(args[1].endsWith('/zip'))return f.zip;const route=args[1].replace(`repos/${repository}/`,'');counts[route]=(counts[route]??0)+1;f.before(route,counts[route]);return JSON.stringify(value(route));};
 f.verify=()=>verifyReleaseCi(releaseSha,{run:f.run,now});return f;
}
test('exact current-main run, attempt and complete mandatory work passes repeated observations',()=>{
 const f=fixture();assert.deepEqual(f.verify(),{releaseSha:f.releaseSha,mainSha:f.mainSha,runId:123,runAttempt:1,ciMergeSha:'d'.repeat(40),ciTreeSha:'e'.repeat(40),artifactId:456,artifactZipDigest:f.artifact.digest,ciArtifactDigest:'f'.repeat(64),status:'success'});
 assert.equal(f.counts['pulls/125'],2);assert.equal(f.counts['actions/runs/123'],2);
});
test('stale PR and run base metadata is accepted only when actual CI artifact has current main parent',()=>{
 const f=fixture();f.pr.base.sha='c'.repeat(40);f.ci.pull_requests[0].base.sha='c'.repeat(40);assert.equal(f.verify().mainSha,f.mainSha);
 f.tested.parents[0].sha='c'.repeat(40);assert.throws(f.verify);
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
  f=>f.ci.pull_requests[0].number=126,f=>f.tested.parents[0].sha='c'.repeat(40),f=>f.ci.run_attempt=0,
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

test('CI artifact bytes, provenance, history parents and metadata pairing fail closed',()=>{
 for(const mutate of [
  f=>f.zip=Buffer.from('tamperedzip'),f=>f.artifact.expired=true,f=>f.artifact.workflow_run.id=124,
  f=>f.archive.metadata.runId='124',f=>f.archive.metadata.runAttempt='2',f=>f.archive.commit='c'.repeat(40),
  f=>f.archive.evidence.artifact.digest='0'.repeat(64),f=>f.tested.parents.reverse(),f=>f.tested.parents.pop(),
  f=>f.tested.tree.sha='0'.repeat(40),f=>f.archive.metadata.node='v24.0.0',
 ]){const f=fixture();mutate(f);assert.throws(f.verify);}
});

test('actual bounded ZIP reader accepts paired records and refuses duplicate archive paths',()=>{
 for(const duplicate of [false,true]){
  const f=fixture();
  f.zip=execFileSync('/usr/bin/python3',['-I','-c',`import sys,json,io,zipfile,warnings
warnings.simplefilter('ignore')
a=json.load(sys.stdin);b=io.BytesIO()
with zipfile.ZipFile(b,'w') as z:
 for k,n in [('metadata','build-metadata.json'),('evidence','release-package/RELEASE_EVIDENCE.json'),('commit','release-package/COMMIT_SHA')]:
  z.writestr(n,a[k] if k=='commit' else json.dumps(a[k]))
 if ${duplicate?'True':'False'}:z.writestr('build-metadata.json','{}')
sys.stdout.buffer.write(b.getvalue())`],{input:JSON.stringify(f.archive),maxBuffer:262144});
  f.artifact.size_in_bytes=f.zip.length;f.artifact.digest='sha256:'+createHash('sha256').update(f.zip).digest('hex');
  const fake=f.run;f.run=(exe,args,options)=>exe==='/usr/bin/python3'?execFileSync(exe,args,options):fake(exe,args,options);
  const verify=()=>verifyReleaseCi(f.releaseSha,{run:f.run,now:f.now});
  if(duplicate)assert.throws(verify);else assert.equal(verify().artifactId,456);
 }
});
