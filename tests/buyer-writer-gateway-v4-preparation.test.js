import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {validateBuyerWriterGatewayProvisioningConfiguration} from '../packages/buyer-writer/configuration.js';
import {
  buildBuyerWriterGatewayV4Preparation,publishBuyerWriterGatewayV4Preparation,prepareBuyerWriterGatewayV4,
} from '../packages/buyer-writer/gateway-v4-preparation.js';
import {
  artifactRoot,candidatePath,currentGatewayFile,deterministicDependencies,ids,inputFixture,keyId,keyPath,
  preparationRoot,sourceConfigurationFile,translatedFilesystem,
} from './helpers/buyer-writer-gateway-v4-preparation.js';

const generic=/Buyer writer gateway v4 preparation failed/;
const readJson=(io,name)=>JSON.parse(io.readFileSync(name,'utf8'));
const highInput=overrides=>({releaseSha:ids.releaseSha,operationId:ids.operationId,
  attemptId:ids.attemptId,sourceConfigurationFile,candidatePath,artifactRoot,...overrides});
const snapshotIdentity=(ino,gid=0)=>({uid:0,gid,mode:0o100600,nlink:1,size:100,
  dev:1,ino,mtimeMs:1,ctimeMs:1});
function highHarness(t,{drift,postpublish=false,replaceCandidate=false}={}){
  const f=translatedFilesystem(t),base=inputFixture();let sourceReads=0,currentReads=0,artifactReads=0,identityReads=0,foreignCandidate;
  const foreignSource=preparationRoot+'/foreign-candidate-race.json';
  if(replaceCandidate)f.io.writeFileSync(foreignSource,'foreign-candidate-state\n',{mode:0o600});
  const readSnapshot=(filename,{groupId})=>{
    if(filename===sourceConfigurationFile){
      assert.equal(groupId,0);sourceReads++;const value=structuredClone(base.sourceConfiguration);
      if(drift==='source'&&sourceReads===2)value.writerCredential='c'.repeat(43);
      return {value,identity:{...snapshotIdentity(10),...(drift==='source-identity'&&sourceReads===2?{mtimeMs:2}:{})}};
    }
    if(filename===currentGatewayFile){
      assert.equal(groupId,982);currentReads++;const value=structuredClone(base.currentGatewayConfiguration);
      if(drift==='current'&&currentReads===2)value.authority.attemptId='80000000-0000-4000-8000-000000000002';
      return {value,identity:snapshotIdentity(11,982)};
    }
    if(filename===candidatePath){
      const value=readJson(f.io,filename);
      if(replaceCandidate){f.io.unlinkSync(filename);f.io.linkSync(foreignSource,filename);
        f.io.unlinkSync(foreignSource);foreignCandidate=f.io.lstatSync(filename);value.authority.releaseSha='c'.repeat(40);}
      else if(postpublish)value.authority.releaseSha='c'.repeat(40);
      const stat=f.io.lstatSync(filename);return {value,identity:{uid:stat.uid,gid:stat.gid,
        mode:stat.mode,nlink:stat.nlink,size:stat.size,dev:stat.dev,ino:stat.ino,
        mtimeMs:stat.mtimeMs,ctimeMs:stat.ctimeMs}};
    }
    throw new Error('unexpected snapshot');
  };
  const inspectArtifact=async()=>{
    artifactReads++;const value=structuredClone(base.artifact);
    if(drift==='artifact'&&artifactReads===2)value.artifactDigest='c'.repeat(64);
    return value;
  };
  return {f,foreignCandidate:()=>foreignCandidate,deps:{...deterministicDependencies(),io:f.io,readSnapshot,inspectArtifact,
    resolveIdentity:async()=>{identityReads++;return {apiUid:drift==='identity'&&identityReads===2
      ||drift==='identity-postpublish'&&identityReads===3?995:994,
      credentialGroupId:984,writerGroupId:982};}}};
}

function candidateFaultIo(base,stage,{replaceKey=false}={}){
  const paths=new Map();let foreign;
  const foreignSource=preparationRoot+'/foreign-key-race.pem';
  if(replaceKey)base.writeFileSync(foreignSource,'foreign-preexisting-state\n',{mode:0o600});
  const candidateTemporary=name=>typeof name==='string'&&name.startsWith(preparationRoot+'/.zola-v4-');
  const replace=()=>{
    if(!replaceKey)return;
    base.unlinkSync(keyPath);base.linkSync(foreignSource,keyPath);base.unlinkSync(foreignSource);
    foreign=base.lstatSync(keyPath);
  };
  const io=new Proxy(base,{get(target,property){
    if(property==='openSync')return (name,...args)=>{const fd=target.openSync(name,...args);paths.set(fd,name);return fd;};
    if(property==='closeSync')return fd=>{try{return target.closeSync(fd);}finally{paths.delete(fd);}};
    if(property==='writeSync')return (fd,...args)=>{
      if(stage==='write'&&candidateTemporary(paths.get(fd))){replace();throw new Error('candidate write fault');}
      return target.writeSync(fd,...args);
    };
    if(property==='fsyncSync')return fd=>{
      if(stage==='fsync'&&candidateTemporary(paths.get(fd))){replace();throw new Error('candidate fsync fault');}
      return target.fsyncSync(fd);
    };
    if(property==='linkSync')return (from,to)=>{
      if(stage==='link'&&to===candidatePath){replace();throw new Error('candidate link fault');}
      return target.linkSync(from,to);
    };
    if(property==='readSync')return (fd,...args)=>{
      if(stage==='postverify'&&paths.get(fd)===candidatePath){replace();return 0;}
      return target.readSync(fd,...args);
    };
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  return {io,foreign:()=>foreign};
}

test('pure builder binds exact sealed release and returns no private or credential material',()=>{
  const input=inputFixture(),dependencies=deterministicDependencies();
  const plan=buildBuyerWriterGatewayV4Preparation(input,dependencies);
  assert.equal(plan.status,'GATEWAY_V4_PREPARATION_BUILT');
  assert.equal(plan.releaseSha,ids.releaseSha);assert.equal(plan.operationId,ids.operationId);
  assert.equal(plan.attemptId,ids.attemptId);assert.equal(plan.workspace,'blackspire-command');
  assert.equal(plan.candidatePath,candidatePath);assert.equal(plan.keyPath,keyPath);assert.equal(plan.keyId,keyId);
  const serialized=JSON.stringify(plan);
  for(const value of [input.sourceConfiguration.writerCredential,input.sourceConfiguration.issuerCredential,
    input.sourceConfiguration.runtime.password,input.sourceConfiguration.issuer.password,
    input.currentGatewayConfiguration.gatewayCapability,'PRIVATE KEY'])
    assert.equal(serialized.includes(value),false);
  assert.equal(Object.isFrozen(plan),true);
});

test('publisher creates an exact protected candidate and API-owned Ed25519 key without overwrite',t=>{
  const f=translatedFilesystem(t),input=inputFixture(),dependencies={...deterministicDependencies(),io:f.io};
  const plan=buildBuyerWriterGatewayV4Preparation(input,dependencies);
  const result=publishBuyerWriterGatewayV4Preparation(plan,dependencies);
  assert.deepEqual(Object.keys(result).sort(),['attemptId','candidateDigest','candidatePath','keyId','keyPath',
    'operationId','publicKeyDigest','releaseSha','status','workspace']);
  assert.equal(result.status,'GATEWAY_V4_PREPARED');assert.equal(result.releaseSha,ids.releaseSha);
  assert.equal(result.operationId,ids.operationId);assert.equal(result.attemptId,ids.attemptId);
  assert.equal(result.workspace,'blackspire-command');assert.equal(result.candidatePath,candidatePath);
  assert.equal(result.keyPath,keyPath);assert.equal(result.keyId,keyId);
  assert.match(result.candidateDigest,/^[a-f0-9]{64}$/);assert.match(result.publicKeyDigest,/^[a-f0-9]{64}$/);
  const candidateBytes=f.io.readFileSync(candidatePath),candidate=JSON.parse(candidateBytes),keyBytes=f.io.readFileSync(keyPath,'utf8');
  assert.equal(result.candidateDigest,createHash('sha256').update(candidateBytes).digest('hex'));
  assert.equal(f.io.lstatSync(candidatePath).mode&0o777,0o600);
  assert.equal(f.io.lstatSync(candidatePath).nlink,1);
  assert.equal(f.io.lstatSync(keyPath).mode&0o777,0o600);assert.equal(f.io.lstatSync(keyPath).nlink,1);
  assert.equal(f.io.lstatSync(keyPath).uid,994);
  assert.equal(candidate.version,4);assert.equal(candidate.authority.releaseSha,ids.releaseSha);
  assert.equal(candidate.authority.operationId,ids.operationId);assert.equal(candidate.authority.attemptId,ids.attemptId);
  assert.equal(candidate.gatewayCapability,input.currentGatewayConfiguration.gatewayCapability);
  assert.equal(candidate.writerCredential,input.sourceConfiguration.writerCredential);
  assert.equal(candidate.issuerCredential,input.sourceConfiguration.issuerCredential);
  assert.notEqual(candidate.admissionCredential,candidate.gatewayCapability);
  assert.equal(candidate.operationPermitSignerConfiguration.activePrivateKeyPath,keyPath);
  const permit=JSON.parse(candidate.operationPermitConfiguration);
  assert.equal(permit.releaseSha,ids.releaseSha);assert.equal(permit.operationId,ids.operationId);
  assert.equal(permit.attemptId,ids.attemptId);assert.equal(permit.keyId,keyId);
  const validated=validateBuyerWriterGatewayProvisioningConfiguration(candidate,{workspace:'blackspire-command'});
  const privateKey=createPrivateKey(keyBytes),publicPem=createPublicKey(privateKey).export({type:'spki',format:'pem'});
  assert.equal(privateKey.asymmetricKeyType,'ed25519');
  assert.equal(result.publicKeyDigest,createHash('sha256').update(publicPem).digest('hex'));
  assert.equal(validated.operationPermitVerificationConfiguration.keys[0].publicKeyPem,publicPem);
});

test('composition produces the same bounded result and does not disclose generated secrets',t=>{
  const f=translatedFilesystem(t),input=inputFixture(),dependencies={...deterministicDependencies(),io:f.io};
  const result=prepareBuyerWriterGatewayV4(input,dependencies);
  assert.equal(result.status,'GATEWAY_V4_PREPARED');
  assert.equal(JSON.stringify(result).includes('PRIVATE KEY'),false);
  assert.equal(f.io.existsSync(candidatePath),true);assert.equal(f.io.existsSync(keyPath),true);
});

test('existing candidate or key rejects without changing bytes or inode',t=>{
  for(const occupied of [candidatePath,keyPath]){
    const f=translatedFilesystem(t),bytes=Buffer.from('foreign-state\n');
    f.io.writeFileSync(occupied,bytes,{mode:0o600});const before=f.io.lstatSync(occupied);
    const dependencies={...deterministicDependencies(),io:f.io};
    const plan=buildBuyerWriterGatewayV4Preparation(inputFixture(),dependencies);
    assert.throws(()=>publishBuyerWriterGatewayV4Preparation(plan,dependencies),generic);
    const after=f.io.lstatSync(occupied);
    assert.equal(after.dev,before.dev);assert.equal(after.ino,before.ino);
    assert.deepEqual(f.io.readFileSync(occupied),bytes);
    assert.equal(f.io.existsSync(candidatePath)&&occupied!==candidatePath,false);
  }
});

test('malformed authority, artifact identity and escaped candidate path fail before publication',t=>{
  const artifact=inputFixture().artifact;
  const cases=[
    inputFixture({releaseSha:'c'.repeat(40)}),
    inputFixture({operationId:'not-a-uuid'}),
    inputFixture({workspace:'other'}),
    inputFixture({candidatePath:preparationRoot+'/../escaped.json'}),
    inputFixture({artifact:{...artifact,deployed:true}}),
    inputFixture({artifact:{...artifact,releaseSha:'c'.repeat(40)}}),
  ];
  for(const input of cases){
    const f=translatedFilesystem(t),dependencies={...deterministicDependencies(),io:f.io};
    assert.throws(()=>buildBuyerWriterGatewayV4Preparation(input,dependencies),generic);
    assert.equal(f.io.existsSync(candidatePath),false);assert.equal(f.io.existsSync(keyPath),false);
  }
});

test('source/current drift and credential collisions are rejected before publication',t=>{
  const mutations=[
    value=>{value.currentGatewayConfiguration.workspace='other';},
    value=>{value.currentGatewayConfiguration.creatorOid++;},
    value=>{value.currentGatewayConfiguration.runtime.password='x'.repeat(43);},
    value=>{value.currentGatewayConfiguration.gatewayCapability=value.sourceConfiguration.writerCredential;},
    value=>{value.sourceConfiguration.issuer.database='other';},
  ];
  for(const mutate of mutations){
    const input=inputFixture();input.sourceConfiguration=structuredClone(input.sourceConfiguration);
    input.currentGatewayConfiguration=structuredClone(input.currentGatewayConfiguration);mutate(input);
    const f=translatedFilesystem(t),dependencies={...deterministicDependencies(),io:f.io};
    assert.throws(()=>buildBuyerWriterGatewayV4Preparation(input,dependencies),generic);
    assert.equal(f.io.existsSync(candidatePath),false);assert.equal(f.io.existsSync(keyPath),false);
  }
});

test('publisher is capability-bound and a key-publication fault never creates a candidate',t=>{
  const f=translatedFilesystem(t),base={...deterministicDependencies(),io:f.io};
  assert.throws(()=>publishBuyerWriterGatewayV4Preparation({status:'GATEWAY_V4_PREPARATION_BUILT'},base),generic);
  const plan=buildBuyerWriterGatewayV4Preparation(inputFixture(),base);
  const io=new Proxy(f.io,{get(target,property){
    if(property==='linkSync')return (from,to)=>{if(to===keyPath)throw new Error('injected');return target.linkSync(from,to);};
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  assert.throws(()=>publishBuyerWriterGatewayV4Preparation(plan,{...base,io}),generic);
  assert.equal(f.io.existsSync(candidatePath),false);
});

test('an exact rerun is refused without replacing either published inode',t=>{
  const f=translatedFilesystem(t),dependencies={...deterministicDependencies(),io:f.io};
  const plan=buildBuyerWriterGatewayV4Preparation(inputFixture(),dependencies);
  publishBuyerWriterGatewayV4Preparation(plan,dependencies);
  const keyBefore=f.io.lstatSync(keyPath),candidateBefore=f.io.lstatSync(candidatePath);
  assert.throws(()=>publishBuyerWriterGatewayV4Preparation(plan,dependencies),generic);
  assert.equal(f.io.lstatSync(keyPath).ino,keyBefore.ino);
  assert.equal(f.io.lstatSync(candidatePath).ino,candidateBefore.ino);
});

test('short writes complete and uncertain link outcome removes only owned output',t=>{
  const short=translatedFilesystem(t),base={...deterministicDependencies(),io:short.io};
  const shortIo=new Proxy(short.io,{get(target,property){
    if(property==='writeSync')return (fd,bytes,offset,length,position)=>
      target.writeSync(fd,bytes,offset,Math.min(length,7),position);
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  const shortPlan=buildBuyerWriterGatewayV4Preparation(inputFixture(),base);
  assert.equal(publishBuyerWriterGatewayV4Preparation(shortPlan,{...base,io:shortIo}).status,'GATEWAY_V4_PREPARED');
  const uncertain=translatedFilesystem(t),uncertainBase={...deterministicDependencies(),io:uncertain.io};
  const uncertainPlan=buildBuyerWriterGatewayV4Preparation(inputFixture(),uncertainBase);
  const uncertainIo=new Proxy(uncertain.io,{get(target,property){
    if(property==='linkSync')return (from,to)=>{target.linkSync(from,to);throw new Error('unknown outcome');};
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  assert.throws(()=>publishBuyerWriterGatewayV4Preparation(uncertainPlan,{...uncertainBase,io:uncertainIo}),generic);
  assert.equal(uncertain.io.existsSync(candidatePath),false);
  assert.equal(uncertain.io.existsSync(keyPath),false);
});

test('candidate-stage write, fsync, link and postverify faults remove candidate and invocation key',t=>{
  for(const stage of ['write','fsync','link','postverify']){
    const f=translatedFilesystem(t),base={...deterministicDependencies(),io:f.io};
    const plan=buildBuyerWriterGatewayV4Preparation(inputFixture(),base),fault=candidateFaultIo(f.io,stage);
    assert.throws(()=>publishBuyerWriterGatewayV4Preparation(plan,{...base,io:fault.io}),generic);
    assert.equal(f.io.existsSync(candidatePath),false,stage+' candidate');
    assert.equal(f.io.existsSync(keyPath),false,stage+' key');
  }
});

test('candidate failure preserves a foreign key replacement with a different inode',t=>{
  const f=translatedFilesystem(t),base={...deterministicDependencies(),io:f.io};
  const plan=buildBuyerWriterGatewayV4Preparation(inputFixture(),base);
  const fault=candidateFaultIo(f.io,'write',{replaceKey:true});
  assert.throws(()=>publishBuyerWriterGatewayV4Preparation(plan,{...base,io:fault.io}),generic);
  assert.equal(f.io.existsSync(candidatePath),false);
  assert.equal(f.io.existsSync(keyPath),true);
  const after=f.io.lstatSync(keyPath),foreign=fault.foreign();
  assert.equal(after.dev,foreign.dev);assert.equal(after.ino,foreign.ino);
  assert.equal(f.io.readFileSync(keyPath,'utf8'),'foreign-preexisting-state\n');
});

test('path-only high-level preparation publishes and returns the exact sanitized nine-key result',async t=>{
  const h=highHarness(t),result=await prepareBuyerWriterGatewayV4(highInput(),h.deps);
  assert.deepEqual(Object.keys(result).sort(),['attemptId','candidateDigest','candidatePath','keyId','keyPath',
    'operationId','publicKeyDigest','releaseSha','status']);
  assert.equal(result.status,'BUYER_WRITER_GATEWAY_V4_PREPARED');
  assert.equal(result.releaseSha,ids.releaseSha);assert.equal(result.operationId,ids.operationId);
  assert.equal(result.attemptId,ids.attemptId);assert.equal(result.candidatePath,candidatePath);
  assert.equal(result.keyId,keyId);assert.equal(result.keyPath,keyPath);
  assert.match(result.candidateDigest,/^[a-f0-9]{64}$/);assert.match(result.publicKeyDigest,/^[a-f0-9]{64}$/);
  assert.equal(h.f.io.existsSync(candidatePath),true);assert.equal(h.f.io.existsSync(keyPath),true);
});

test('path-only preparation refuses source, current, artifact or identity recheck drift before bytes',async t=>{
  for(const drift of ['source','source-identity','current','artifact','identity']){
    const h=highHarness(t,{drift});
    await assert.rejects(prepareBuyerWriterGatewayV4(highInput(),h.deps),generic);
    assert.equal(h.f.io.existsSync(candidatePath),false,drift+' candidate');
    assert.equal(h.f.io.existsSync(keyPath),false,drift+' key');
  }
});

test('path-only preparation rejects wrong artifact root and misplaced source/candidate paths',async t=>{
  const cases=[
    highInput({artifactRoot:'/opt/blackspire-command/releases/'+'c'.repeat(40)}),
    highInput({sourceConfigurationFile:'/tmp/source-v1.json'}),
    highInput({sourceConfigurationFile:preparationRoot+'/nested/source-v1.json'}),
    highInput({candidatePath:'/tmp/candidate.json'}),
    highInput({candidatePath:preparationRoot+'/nested/candidate.json'}),
    highInput({candidatePath:sourceConfigurationFile}),
  ];
  for(const input of cases){
    const h=highHarness(t);await assert.rejects(prepareBuyerWriterGatewayV4(input,h.deps),generic);
    assert.equal(h.f.io.existsSync(candidatePath),false);assert.equal(h.f.io.existsSync(keyPath),false);
  }
});

test('path-only postpublish identity drift removes both invocation-owned outputs',async t=>{
  const h=highHarness(t,{drift:'identity-postpublish'});
  await assert.rejects(prepareBuyerWriterGatewayV4(highInput(),h.deps),generic);
  assert.equal(h.f.io.existsSync(candidatePath),false);
  assert.equal(h.f.io.existsSync(keyPath),false);
});

test('postverify candidate replacement preserves foreign inode, removes owned key and closes held descriptors',async t=>{
  const h=highHarness(t,{replaceCandidate:true}),open=new Set();
  const io=new Proxy(h.f.io,{get(target,property){
    if(property==='openSync')return (...args)=>{const fd=target.openSync(...args);open.add(fd);return fd;};
    if(property==='closeSync')return fd=>{try{return target.closeSync(fd);}finally{open.delete(fd);}};
    const value=target[property];return typeof value==='function'?value.bind(target):value;
  }});
  await assert.rejects(prepareBuyerWriterGatewayV4(highInput(),{...h.deps,io}),generic);
  assert.equal(h.f.io.existsSync(candidatePath),true);
  const after=h.f.io.lstatSync(candidatePath),foreign=h.foreignCandidate();
  assert.equal(after.dev,foreign.dev);assert.equal(after.ino,foreign.ino);
  assert.equal(h.f.io.readFileSync(candidatePath,'utf8'),'foreign-candidate-state\n');
  assert.equal(h.f.io.existsSync(keyPath),false);
  assert.equal(open.size,0,'every descriptor opened through the preparation IO is closed');
});

test('path-only postpublish validation failure removes both invocation-owned outputs',async t=>{
  const h=highHarness(t,{postpublish:true});
  await assert.rejects(prepareBuyerWriterGatewayV4(highInput(),h.deps),generic);
  assert.equal(h.f.io.existsSync(candidatePath),false,'invalid candidate is removed by exact inode');
  assert.equal(h.f.io.existsSync(keyPath),false,'paired invocation key is removed by exact inode');
});

test('spawned CLI rejects a bad invocation with exact sanitized output',()=>{
  const node='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';
  const script=fileURLToPath(new URL('../scripts/prepare-buyer-writer-gateway-v4.js',import.meta.url));
  const result=spawnSync(node,[script],{cwd:fileURLToPath(new URL('../',import.meta.url)),
    encoding:'utf8',env:{PATH:'/usr/bin:/bin',LC_ALL:'C',LANG:'C'},timeout:5000,maxBuffer:4096});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1);
  assert.equal(result.stdout,'');
  assert.equal(result.stderr,'Buyer writer gateway v4 preparation stopped; protected inputs and state were not disclosed\n');
});

test('public CLI is root-only, fixed-input and never accepts credential material from environment',()=>{
  const source=fs.readFileSync(new URL('../scripts/prepare-buyer-writer-gateway-v4.js',import.meta.url),'utf8');
  assert.match(source,/process\.getuid/);assert.match(source,/process\.versions\.node/);
  assert.doesNotMatch(source,/process\.env/);assert.doesNotMatch(source,/PRIVATE KEY/);
  assert.match(source,/prepareBuyerWriterGatewayV4\(\{\s*releaseSha,operationId,attemptId,sourceConfigurationFile,candidatePath,/);
  assert.match(source,/artifactRoot:path\.join\(releaseRoot,releaseSha\)/);
  assert.match(source,/const canonicalRepository='https:\/\/github\.com\/houseomegakennels-bit\/blackspire-helix-group\.git'/);
  assert.match(source,/\['ls-remote','--exit-code',canonicalRepository,/);
  assert.doesNotMatch(source,/\['ls-remote','--exit-code','origin'/);
  assert.match(source,/status!=='BUYER_WRITER_GATEWAY_V4_PREPARED'/);
  for(const key of ['keyId','candidatePath','keyPath','candidateDigest','publicKeyDigest'])assert.match(source,new RegExp(key));
  assert.match(source,/gateway v4 preparation stopped/i);
});
