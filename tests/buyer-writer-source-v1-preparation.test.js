import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {
  buildBuyerWriterSourceV1,prepareBuyerWriterSourceV1,
} from '../packages/buyer-writer/source-v1-preparation.js';

const releaseSha='a'.repeat(40);
const operationId='00000000-0000-4000-8000-000000000001';
const attemptId='00000000-0000-4000-8000-000000000002';
const now=Date.UTC(2026,8,19,12);
const secret=byte=>Buffer.alloc(32,byte).toString('base64url');
const canonical=v=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`
  :v&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    :JSON.stringify(v);
const hash=v=>createHash('sha256').update(v).digest('hex');
const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
const runtime={host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',
  password:secret(3),ca};
const issuer={...runtime,password:secret(4)};
const credentialSource={version:3,workspace:'blackspire-command',
  bindingFile:'/etc/blackspire/buyer-writer-binding.json',
  writerCredential:secret(1),issuerCredential:secret(2),gatewayCapability:secret(5),
  creatorOid:16388,authority:{releaseSha:'9'.repeat(40),
    operationId:'90000000-0000-4000-8000-000000000001',
    attemptId:'90000000-0000-4000-8000-000000000002',
    workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'},runtime,issuer};
const artifact={releaseSha,environment:'production',artifactDigest:'b'.repeat(64),
  status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false};
function evidence(overrides={}){
  return {version:1,kind:'buyer-writer-authenticated-catalog-evidence',releaseSha,
    environment:'production',workspace:'blackspire-command',
    artifactDigest:artifact.artifactDigest,
    credentialSourceDigest:hash(Buffer.from(canonical(credentialSource))),
    capturedAt:new Date(now-1000).toISOString(),
    target:{host:runtime.host,port:5432,database:'postgres',serverMajor:17},
    authentication:{sessionUser:'postgres',currentUser:'postgres',creatorRole:'postgres',
      sessionUserOid:16388,currentUserOid:16388,creatorOid:16388,authenticated:true},
    ...overrides};
}
test('strict authenticated exact-head evidence derives only the source-v1 credential subset',()=>{
  const result=buildBuyerWriterSourceV1({releaseSha,artifact,credentialSource,
    catalogEvidence:evidence(),now:()=>now});
  assert.deepEqual(Object.keys(result.configuration),[
    'version','workspace','bindingFile','writerCredential','issuerCredential','creatorOid','runtime','issuer']);
  assert.equal(result.configuration.version,1);
  assert.equal(result.configuration.creatorOid,16388);
  assert.equal(Object.hasOwn(result.configuration,'gatewayCapability'),false);
  assert.equal(Object.hasOwn(result.configuration,'authority'),false);
  assert.match(result.configurationDigest,/^[a-f0-9]{64}$/);
  assert.match(result.credentialSourceDigest,/^[a-f0-9]{64}$/);
  assert.match(result.catalogEvidenceDigest,/^[a-f0-9]{64}$/);
});
test('missing, stale, wrong-head, unbound or unauthenticated catalog evidence fails closed',()=>{
  const cases=[
    undefined,
    evidence({releaseSha:'c'.repeat(40)}),
    evidence({artifactDigest:'d'.repeat(64)}),
    evidence({credentialSourceDigest:'e'.repeat(64)}),
    evidence({capturedAt:new Date(now-300001).toISOString()}),
    evidence({authentication:{...evidence().authentication,authenticated:false}}),
    evidence({authentication:{...evidence().authentication,creatorOid:16389}}),
    evidence({target:{...evidence().target,serverMajor:16}}),
  ];
  for(const catalogEvidence of cases)assert.throws(()=>buildBuyerWriterSourceV1({
    releaseSha,artifact,credentialSource,catalogEvidence,now:()=>now}),
  /^Error: Buyer writer source v1 preparation failed$/);
});
test('creator identity must agree across the retained credential source and authenticated catalog',()=>{
  const drift=structuredClone(credentialSource);drift.creatorOid=16389;
  const catalog=evidence({credentialSourceDigest:hash(Buffer.from(canonical(drift)))});
  assert.throws(()=>buildBuyerWriterSourceV1({releaseSha,artifact,
    credentialSource:drift,catalogEvidence:catalog,now:()=>now}),
  /source v1 preparation failed/);
});
test('legacy source schema and credential uniqueness are exact and fail closed',()=>{
  for(const mutate of [
    value=>{value.extra=true;},
    value=>{value.version=4;},
    value=>{value.runtime.host='other.example';},
    value=>{value.gatewayCapability=value.writerCredential;},
    value=>{delete value.creatorOid;},
  ]){
    const value=structuredClone(credentialSource);mutate(value);
    const catalog=evidence({credentialSourceDigest:hash(Buffer.from(canonical(value)))});
    assert.throws(()=>buildBuyerWriterSourceV1({releaseSha,artifact,
      credentialSource:value,catalogEvidence:catalog,now:()=>now}),
    /source v1 preparation failed/);
  }
});
test('attempt-stable publication is idempotent across a fresh preparation instance',
 {skip:process.getuid?.()!==0?'root ownership is unavailable in the contained non-root suite':false},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-v1-recovery-'));
  const translate=name=>root+name;
  fs.mkdirSync(translate('/var/lib/blackspire-operator/preparation'),{recursive:true,mode:0o700});
  const io={
    lstatSync:name=>fs.lstatSync(translate(name)),openSync:(name,...args)=>fs.openSync(translate(name),...args),
    fstatSync:fd=>fs.fstatSync(fd),fsyncSync:fd=>fs.fsyncSync(fd),closeSync:fd=>fs.closeSync(fd),
    readSync:(...args)=>fs.readSync(...args),writeSync:(...args)=>fs.writeSync(...args),
    fchownSync:(...args)=>fs.fchownSync(...args),fchmodSync:(...args)=>fs.fchmodSync(...args),
    linkSync:(from,to)=>fs.linkSync(translate(from),translate(to)),
    unlinkSync:name=>fs.unlinkSync(translate(name)),
  };
  const destinationFile='/var/lib/blackspire-operator/preparation/source-v1.json';
  const input={releaseSha,operationId,attemptId,
    credentialSourceFile:'/var/lib/blackspire-operator/preparation/credentials.json',
    managementConfigFile:'/etc/blackspire-buyer-writer-gateway/management.json',
    destinationFile,artifactRoot:'/opt/blackspire-command/releases/'+releaseSha};
  const identity=name=>({name});
  const readSnapshot=name=>name===destinationFile
    ?{value:JSON.parse(fs.readFileSync(translate(name))),identity:identity(name)}
    :name.endsWith('management.json')
      ?{value:{host:runtime.host,password:secret(9),ca},identity:identity(name)}
      :{value:credentialSource,identity:identity(name)};
  const options={io,aclTool:()=>({status:0,error:undefined,signal:null,stdout:'',stderr:''}),
    readSnapshot,inspectArtifact:async()=>artifact,connect:async()=>assert.fail(),
    collectCatalog:async()=>evidence(),now:()=>now};
  try{
    const first=await prepareBuyerWriterSourceV1(input,options);
    const ino=fs.statSync(translate(destinationFile)).ino;
    const staged=path.join(path.dirname(destinationFile),`.source-v1-${attemptId.replaceAll('-','')}.tmp`);
    fs.linkSync(translate(destinationFile),translate(staged));
    assert.equal(fs.statSync(translate(destinationFile)).nlink,2);
    const second=await prepareBuyerWriterSourceV1(input,options);
    assert.equal(first.configurationDigest,second.configurationDigest);
    assert.equal(fs.statSync(translate(destinationFile)).ino,ino);
    assert.equal(fs.statSync(translate(destinationFile)).nlink,1);
    assert.equal(fs.existsSync(translate(staged)),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('preparation refuses failed authenticated collection before publication',async()=>{
  let reads=0,artifactReads=0,collections=0;
  await assert.rejects(prepareBuyerWriterSourceV1({releaseSha,operationId,attemptId,
    credentialSourceFile:'/var/lib/blackspire-operator/preparation/credentials.json',
    managementConfigFile:'/etc/blackspire-buyer-writer-gateway/management.json',
    destinationFile:'/var/lib/blackspire-operator/preparation/source-v1.json',
    artifactRoot:'/opt/blackspire-command/releases/'+releaseSha},{
    readSnapshot:name=>{reads++;return name.endsWith('management.json')
      ?{value:{host:runtime.host,password:secret(9),ca},identity:{two:2}}
      :{value:credentialSource,identity:{one:1}};},
    inspectArtifact:async()=>{artifactReads++;return artifact;},
    collectCatalog:async()=>{collections++;throw new Error('database unavailable');},
    connect:async()=>assert.fail(),
  }),/^Error: Buyer writer source v1 preparation failed$/);
  assert.equal(reads,2);assert.equal(artifactReads,1);assert.equal(collections,1);
});
test('public CLI pins exact release source and emits only generic failure text',()=>{
  const source=fs.readFileSync(new URL('../scripts/prepare-buyer-writer-source-v1.js',import.meta.url),'utf8');
  assert.match(source,/release\/zola-production-live/);
  assert.match(source,/ls-remote/);
  assert.match(source,/status','--porcelain','--untracked-files=all/);
  assert.match(source,/process\.getuid\?\.\(\)!==0/);
  assert.match(source,/protected inputs and state were not disclosed/);
  assert.doesNotMatch(source,/process\.env/);
});

test('owned source derives the fresh creator only from matching descriptor and v2 catalog',async()=>{
 const {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest}=await import('../packages/buyer-writer/owned-postgres.js');
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:hash(ca)};
 const tags={backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile),host:profile.host,port:profile.port};
 const source={...credentialSource,creatorOid:profile.creatorOid,runtime:{...runtime,...tags},issuer:{...issuer,...tags}};
 const catalog=evidence({version:2,credentialSourceDigest:hash(Buffer.from(canonical(source))),target:{host:profile.host,port:profile.port,database:'postgres',serverMajor:17,backendProfile:tags.backendProfile,profileDigest:tags.profileDigest,systemIdentifier:profile.systemIdentifier},authentication:{...evidence().authentication,sessionUserOid:profile.creatorOid,currentUserOid:profile.creatorOid,creatorOid:profile.creatorOid}});
 const input={releaseSha,artifact,credentialSource:source,catalogEvidence:catalog,ownedProfile:profile,now:()=>now};
 const result=buildBuyerWriterSourceV1(input);assert.equal(result.configuration.runtime.profileDigest,tags.profileDigest);assert.equal(result.configuration.creatorOid,profile.creatorOid);
 for(const patch of [{ownedProfile:undefined},{catalogEvidence:{...catalog,version:1}},{catalogEvidence:{...catalog,target:{...catalog.target,systemIdentifier:'987'}}},{credentialSource:{...source,creatorOid:16388}}])assert.throws(()=>buildBuyerWriterSourceV1({...input,...patch}),/preparation failed/);
});

test('fresh owned credential publication recovers exact retained random material after interrupted link',async()=>{
 const {prepareOwnedBuyerWriterCredentialSource}=await import('../packages/buyer-writer/source-v1-preparation.js');
 const {OWNED_POSTGRES_TARGET,ownedPostgresProfileDigest}=await import('../packages/buyer-writer/owned-postgres.js');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'owned-source-')),translate=name=>root+name;
 fs.mkdirSync(translate('/var/lib/blackspire-operator/preparation'),{recursive:true,mode:0o700});
 const profile={version:1,...OWNED_POSTGRES_TARGET,creatorOid:16401,systemIdentifier:'123456789',caSha256:hash(ca)};
 const input={releaseSha,operationId,attemptId,credentialSourceFile:'/var/lib/blackspire-operator/preparation/owned-gateway-provisioning.json',managementConfigFile:'/etc/blackspire/owned-postgres/management.json',destinationFile:'/var/lib/blackspire-operator/preparation/owned-source-v1.json',artifactRoot:'/opt/blackspire-command/releases/'+releaseSha};
 let lost=true,generated=0,stopped=0;
 const io={lstatSync:name=>fs.lstatSync(translate(name)),openSync:(name,...args)=>fs.openSync(translate(name),...args),fstatSync:fd=>fs.fstatSync(fd),fsyncSync:fd=>fs.fsyncSync(fd),closeSync:fd=>fs.closeSync(fd),readSync:(...args)=>fs.readSync(...args),writeSync:(...args)=>fs.writeSync(...args),fchownSync:(...args)=>fs.fchownSync(...args),fchmodSync:(...args)=>fs.fchmodSync(...args),linkSync:(from,to)=>{if(lost){lost=false;throw new Error('lost before link');}fs.linkSync(translate(from),translate(to));},unlinkSync:name=>fs.unlinkSync(translate(name))};
 const management={backendProfile:'owned-postgres-v1',profileDigest:ownedPostgresProfileDigest(profile),host:profile.host,password:secret(9),ca};
 const readSnapshot=name=>({value:name===input.managementConfigFile?management:JSON.parse(fs.readFileSync(translate(name))),identity:{uid:0,gid:0,mode:0o600}});
 const options={io,readSnapshot,readProfile:()=>profile,inspectArtifact:async()=>artifact,assertStopped:()=>{stopped++;},random:count=>Buffer.alloc(count,10+generated++),aclTool:()=>({status:0,error:undefined,signal:null,stdout:'',stderr:''})};
 try{
  await assert.rejects(()=>prepareOwnedBuyerWriterCredentialSource(input,options),/preparation failed/);assert.equal(generated,5);
  const result=await prepareOwnedBuyerWriterCredentialSource(input,options);assert.equal(result.status,'OWNED_CREDENTIAL_SOURCE_PREPARED');assert.equal(generated,5);
  const before=fs.readFileSync(translate(input.credentialSourceFile));await prepareOwnedBuyerWriterCredentialSource(input,options);assert.deepEqual(fs.readFileSync(translate(input.credentialSourceFile)),before);assert.equal(generated,5);
  const saved=JSON.parse(before);assert.equal(saved.creatorOid,profile.creatorOid);assert.equal(saved.runtime.profileDigest,management.profileDigest);assert.equal(new Set([saved.writerCredential,saved.issuerCredential,saved.gatewayCapability,saved.runtime.password,saved.issuer.password,management.password]).size,6);assert.ok(stopped>=7);
  await assert.rejects(()=>prepareOwnedBuyerWriterCredentialSource({...input,attemptId:'00000000-0000-4000-8000-000000000003'},options),/preparation failed/);
  await assert.rejects(()=>prepareOwnedBuyerWriterCredentialSource(input,{...options,assertStopped:()=>{throw new Error('running');}}),/running/);assert.deepEqual(fs.readFileSync(translate(input.credentialSourceFile)),before);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
