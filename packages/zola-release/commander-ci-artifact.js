import {createHash} from 'node:crypto';
const reject=()=>{throw new Error('CI build artifact rejected');};
// Read only three bounded records from the authenticated immutable ZIP. Never
// extract paths or execute its code. Python is fixed code, not artifact input.
const inspectZip=`import sys,io,zipfile,json,resource
resource.setrlimit(resource.RLIMIT_AS,(268435456,268435456))
b=sys.stdin.buffer.read(16777217)
assert len(b)<=16777216
with zipfile.ZipFile(io.BytesIO(b)) as z:
 names=z.namelist()
 assert len(names)==len(set(names)) and len(names)<=10000
 result={}
 for key,name in [('metadata','build-metadata.json'),('evidence','release-package/RELEASE_EVIDENCE.json'),('commit','release-package/COMMIT_SHA')]:
  info=z.getinfo(name)
  assert info.file_size<=65536 and not info.is_dir()
  value=z.read(info).decode('utf-8')
  result[key]=value.strip() if key=='commit' else json.loads(value)
 print(json.dumps(result))
`;
export function verifyReleaseCiArtifact({ci,releaseSha,mainSha,api,run,options}){
 const result=api(`actions/runs/${ci.id}/artifacts?per_page=100`);
 if(!Array.isArray(result.artifacts)||result.total_count!==result.artifacts.length)reject();
 const matches=result.artifacts.filter(a=>a.name===`blackspire-build-metadata-${ci.id}-${ci.run_attempt}`);
 if(matches.length!==1)reject();
 const artifact=matches[0];
 if(!Number.isSafeInteger(artifact.id)||artifact.id<1||artifact.expired!==false
  ||!Number.isSafeInteger(artifact.size_in_bytes)||artifact.size_in_bytes<1||artifact.size_in_bytes>16*1024*1024
  ||!/^sha256:[a-f0-9]{64}$/.test(artifact.digest??'')||artifact.workflow_run?.id!==ci.id
  ||artifact.workflow_run?.head_sha!==releaseSha||artifact.workflow_run?.head_branch!=='release/zola-production-live')reject();
 const zip=run('/usr/bin/gh',['api',`repos/houseomegakennels-bit/blackspire-helix-group/actions/artifacts/${artifact.id}/zip`],
  {...options,encoding:undefined,maxBuffer:16*1024*1024,timeout:30000});
 if(!Buffer.isBuffer(zip)||zip.length!==artifact.size_in_bytes||'sha256:'+createHash('sha256').update(zip).digest('hex')!==artifact.digest)reject();
 const {metadata:m,evidence:e,commit}=JSON.parse(run('/usr/bin/python3',['-I','-c',inspectZip],
  {...options,input:zip,stdio:['pipe','pipe','pipe'],maxBuffer:192*1024,timeout:5000}));
 if(m.repository!=='houseomegakennels-bit/blackspire-helix-group'||m.repository!==e.repository
  ||m.environment!=='disposable-staging'||m.environment!==e.expectedEnvironment
  ||!(/^[a-f0-9]{40}$/).test(m.commit??'')||m.commit!==commit||m.commit!==e.commitSha
  ||!(/^[a-f0-9]{40}$/).test(m.tree??'')||!(/^[a-f0-9]{64}$/).test(m.artifactDigest??'')||m.artifactDigest!==e.artifact?.digest
  ||m.node!=='v22.23.1'||m.node!==e.runtime?.nodeVersion||m.runId!==String(ci.id)||m.runAttempt!==String(ci.run_attempt)
  ||e.ci?.runId!==String(ci.id)||e.buildId!==`${ci.id}.${ci.run_attempt}`)reject();
 const tested=api(`git/commits/${m.commit}`);
 if(tested.sha!==m.commit||tested.tree?.sha!==m.tree||!Array.isArray(tested.parents)||tested.parents.length!==2
  ||tested.parents[0].sha!==mainSha||tested.parents[1].sha!==releaseSha)reject();
 return{ciMergeSha:m.commit,ciTreeSha:m.tree,artifactId:artifact.id,artifactZipDigest:artifact.digest,ciArtifactDigest:m.artifactDigest};
}
