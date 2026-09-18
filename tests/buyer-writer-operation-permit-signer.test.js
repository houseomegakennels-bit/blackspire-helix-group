import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {inspect} from 'node:util';
import {createOperationPermitVerifier} from '../packages/buyer-writer/operation-permit.js';
import {createOperationPermitVerificationKeyring,validateOperationPermitVerificationConfiguration}
  from '../packages/buyer-writer/operation-permit-keyring.js';
import {createOperationPermitSigner,validateOperationPermitSignerConfiguration}
  from '../packages/buyer-writer/operation-permit-signer.js';
const dir=mkdtempSync(path.join(tmpdir(),'zola-permit-signer-'));
test.after(()=>rmSync(dir,{recursive:true,force:true}));
const uid=process.getuid();
const ids={
 subject:'00000000-0000-4000-8000-000000000001',
 operationId:'00000000-0000-4000-8000-000000000002',
 attemptId:'00000000-0000-4000-8000-000000000003',
 requestId:'00000000-0000-4000-8000-000000000004',
 jti:'00000000-0000-4000-8000-000000000005',
 jobId:'00000000-0000-4000-8000-000000000006',
 dispatchId:'00000000-0000-4000-8000-000000000007',
};
function keyFixture(name){
 const pair=generateKeyPairSync('ed25519');
 const privateKeyPem=pair.privateKey.export({type:'pkcs8',format:'pem'});
 const publicKeyPem=pair.publicKey.export({type:'spki',format:'pem'});
 const privateKeyPath=path.join(dir,name+'.pem');
 writeFileSync(privateKeyPath,privateKeyPem,{mode:0o600});
 chmodSync(privateKeyPath,0o600);
 return {privateKeyPem,publicKeyPem,privateKeyPath};
}
const oldKey=keyFixture('old'),newKey=keyFixture('new');
const keyEpoch=1_999_999_900;
const verification={version:2,keys:[
 {keyId:'old-2026-08',publicKeyPem:oldKey.publicKeyPem,lifecycle:'overlap',
  verifyNotBefore:keyEpoch,verifyNotAfter:2_000_000_120},
 {keyId:'active-2026-09',publicKeyPem:newKey.publicKeyPem,lifecycle:'current',
  verifyNotBefore:keyEpoch,verifyNotAfter:null},
]};
const protectedConfiguration={version:1,activeKeyId:'active-2026-09',
 activePrivateKeyPath:newKey.privateKeyPath,verification};
const permitConfiguration={issuer:'https://issuer.example',audience:'zola-buyer-writer',
 subject:ids.subject,keyId:'active-2026-09',origin:'https://writer.example',
 releaseSha:'a'.repeat(40),operationId:ids.operationId,attemptId:ids.attemptId,workspace:'isolated'};
const parameters={p_digest:'b'.repeat(64),p_workspace:'isolated',q:{
 jobId:ids.jobId,version:1,dispatchId:ids.dispatchId,generation:1,
 operation:'start',chunkIndex:0,chunkCount:1,payload:{}}};
const input={configuration:permitConfiguration,operation:'apply',requestId:ids.requestId,
 jti:ids.jti,issuedAt:2_000_000_000,expiresAt:2_000_000_030,parameters};
function signatureParts(token){
 const [header,claims,rawSignature]=token.split('.');
 return {header,claims,signature:Buffer.from(rawSignature,'base64url'),
  keyId:JSON.parse(Buffer.from(header,'base64url')).kid,
  data:Buffer.from(header+'.'+claims)};
}
test('protected signer emits canonical permits accepted by the existing verifier',async()=>{
 const signer=createOperationPermitSigner(protectedConfiguration,{expectedUid:uid});
 const request=signer.sign(input);
 const calls=[];
 const verifier=createOperationPermitVerifier({mode:'isolated-prototype',
  configuration:JSON.stringify(permitConfiguration),verificationConfiguration:verification,
  now:()=>2_000_000_001,validateParameters:()=>true,
  consume:record=>{calls.push(record);return true;}});
 const authorized=await verifier.authorize(request);
 assert.equal(authorized.operation,'apply');
 assert.equal(authorized.jti,ids.jti);
 assert.deepEqual(authorized.parameters,parameters);
 assert.equal(calls.length,1);
 assert.equal(request.body,JSON.stringify(JSON.parse(request.body)));
});

test('Ed25519 signing is deterministic and does not expose private material',()=>{
 const signer=createOperationPermitSigner(protectedConfiguration,{expectedUid:uid});
 const first=signer.sign(input),second=signer.sign(input);
 assert.equal(first.token,second.token);
 const serialized=JSON.stringify(signer);
 assert.equal(serialized.includes('PRIVATE KEY'),false);
 assert.equal(serialized.includes(newKey.privateKeyPath),false);
 assert.equal(JSON.stringify(signer.verificationConfiguration).includes('PRIVATE KEY'),false);
 assert.equal(JSON.stringify(signer.verificationConfiguration).includes('privateKeyPath'),false);
 assert.equal(inspect(signer),"OperationPermitSigner(activeKeyId=active-2026-09)");
});

test('rotation changes the signing key while retaining bounded old-key verification overlap',()=>{
 const oldVerification={version:2,keys:[{keyId:'old-2026-08',publicKeyPem:oldKey.publicKeyPem,
  lifecycle:'current',verifyNotBefore:keyEpoch,verifyNotAfter:null}]};
 const oldProtected={version:1,activeKeyId:'old-2026-08',
  activePrivateKeyPath:oldKey.privateKeyPath,verification:oldVerification};
 const oldPermit={...permitConfiguration,keyId:'old-2026-08'};
 const oldRequest=createOperationPermitSigner(oldProtected,{expectedUid:uid})
  .sign({...input,configuration:oldPermit});
 const newRequest=createOperationPermitSigner(protectedConfiguration,{expectedUid:uid}).sign(input);
 const keyring=createOperationPermitVerificationKeyring(verification);
 assert.equal(keyring.verify({...signatureParts(oldRequest.token),at:2_000_000_001}),true);
 assert.equal(keyring.verify({...signatureParts(newRequest.token),at:2_000_000_001}),true);
 assert.equal(keyring.verify({...signatureParts(oldRequest.token),at:2_000_000_120}),false);
 assert.equal(keyring.verify({...signatureParts(newRequest.token),keyId:'unknown',at:2_000_000_001}),false);
 assert.equal(keyring.verify(signatureParts(newRequest.token)),false);
 const retired=createOperationPermitVerificationKeyring({version:2,keys:[{
  keyId:'active-2026-09',publicKeyPem:newKey.publicKeyPem,lifecycle:'current',
  verifyNotBefore:keyEpoch,verifyNotAfter:null}]});
 assert.equal(retired.verify({...signatureParts(oldRequest.token),at:2_000_000_001}),false);
 assert.equal(retired.verify({...signatureParts(newRequest.token),at:2_000_000_001}),true);
});
test('verifier selects exact kid and enforces overlap activation and retirement',async()=>{
 const boundedVerification={version:2,keys:[
  {...verification.keys[0],verifyNotBefore:2_000_000_110,verifyNotAfter:2_000_000_120},
  verification.keys[1],
 ]};
 const oldPermit={...permitConfiguration,keyId:'old-2026-08'};
 const oldProtected={version:1,activeKeyId:'old-2026-08',
  activePrivateKeyPath:oldKey.privateKeyPath,verification:{
   version:2,keys:[{...boundedVerification.keys[0],lifecycle:'current',verifyNotAfter:null}],
  }};
 const request=createOperationPermitSigner(oldProtected,{expectedUid:uid}).sign({
  ...input,configuration:oldPermit,issuedAt:2_000_000_110,expiresAt:2_000_000_160,
 });
 const makeVerifier=time=>createOperationPermitVerifier({mode:'isolated-prototype',
  configuration:JSON.stringify(permitConfiguration),verificationConfiguration:boundedVerification,
  now:()=>time,validateParameters:()=>true,consume:()=>true});
 assert.equal((await makeVerifier(2_000_000_119).authorize(request)).operation,'apply');
 await assert.rejects(makeVerifier(2_000_000_109).authorize(request),/permit rejected/);
 await assert.rejects(makeVerifier(2_000_000_120).authorize(request),/permit rejected/);
 const [rawHeader,claims,signature]=request.token.split('.');
 const wrongKid=encodedToken({...JSON.parse(Buffer.from(rawHeader,'base64url')),kid:'active-2026-09'},claims,signature);
 await assert.rejects(makeVerifier(2_000_000_119).authorize({...request,token:wrongKid}),/permit rejected/);
});

function encodedToken(header,claims,signature){
 return Buffer.from(JSON.stringify(header)).toString('base64url')+'.'+claims+'.'+signature;
}

test('private key custody rejects permissive mode, symlinks, wrong owner and public mismatch',()=>{
 const loose=keyFixture('loose');chmodSync(loose.privateKeyPath,0o640);
 const link=path.join(dir,'linked.pem');symlinkSync(newKey.privateKeyPath,link);
 const cases=[
  {...protectedConfiguration,activePrivateKeyPath:loose.privateKeyPath},
  {...protectedConfiguration,activePrivateKeyPath:link},
  {...protectedConfiguration,verification:{version:2,keys:[{
   keyId:'active-2026-09',publicKeyPem:oldKey.publicKeyPem,lifecycle:'current',
   verifyNotBefore:keyEpoch,verifyNotAfter:null}]}},
 ];
 for(const value of cases)assert.throws(
  ()=>createOperationPermitSigner(value,{expectedUid:uid}),/signer rejected/);
 assert.throws(()=>validateOperationPermitSignerConfiguration(protectedConfiguration,
  {expectedUid:uid+1}),/signer rejected/);
});

test('keyring and signer configurations reject ambiguity and private keys fail closed',()=>{
 const privatePem=newKey.privateKeyPem,current=verification.keys[1],overlap=verification.keys[0];
 const tooMany=Array.from({length:9},(_,index)=>({keyId:'key-'+index,
  publicKeyPem:generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'}),
  lifecycle:index===0?'current':'overlap',verifyNotBefore:keyEpoch,
  verifyNotAfter:index===0?null:keyEpoch+10}));
 const badVerification=[
  {version:2,keys:tooMany},
  {version:1,keys:[]},
  {version:2,keys:[]},
  {version:2,keys:[current,{...overlap,keyId:current.keyId}]},
  {version:2,keys:[current,{...overlap,publicKeyPem:current.publicKeyPem}]},
  {version:2,keys:[{...current,keyId:'bad key'}]},
  {version:2,keys:[{...current,lifecycle:'unknown'}]},
  {version:2,keys:[current,{...overlap,lifecycle:'current',verifyNotAfter:null}]},
  {version:2,keys:[{...current,lifecycle:'overlap',verifyNotAfter:keyEpoch+10}]},
  {version:2,keys:[{...current,verifyNotAfter:keyEpoch+10}]},
  {version:2,keys:[current,{...overlap,verifyNotAfter:keyEpoch+3601}]},
  {version:2,keys:[{...current,keyId:'private',publicKeyPem:privatePem}]},
  {...verification,extra:true},
 ];
 for(const value of badVerification)assert.throws(
  ()=>validateOperationPermitVerificationConfiguration(value),/keyring rejected/);
 for(const value of [
  {...protectedConfiguration,activeKeyId:'missing'},
  {...protectedConfiguration,activeKeyId:'old-2026-08',
   activePrivateKeyPath:oldKey.privateKeyPath},
  {...protectedConfiguration,extra:true},
  {...protectedConfiguration,activePrivateKeyPath:'relative.pem'},
 ])assert.throws(()=>createOperationPermitSigner(value,{expectedUid:uid}),/signer rejected/);
 assert.throws(()=>createOperationPermitSigner(protectedConfiguration),/signer rejected/);
});

test('legacy single-key configuration requires explicit compatibility and normalizes closed',()=>{
 const legacy={version:1,keys:[{keyId:'legacy',publicKeyPem:oldKey.publicKeyPem}]};
 assert.throws(()=>validateOperationPermitVerificationConfiguration(legacy),/keyring rejected/);
 const normalized=validateOperationPermitVerificationConfiguration(
  legacy,{allowLegacyVersion1:true});
 assert.equal(normalized.version,2);
 assert.deepEqual(normalized.keys.map(({keyId,lifecycle,verifyNotBefore,verifyNotAfter})=>
  ({keyId,lifecycle,verifyNotBefore,verifyNotAfter})),[
  {keyId:'legacy',lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]);
 assert.throws(()=>validateOperationPermitVerificationConfiguration({version:1,
  keys:[legacy.keys[0],{keyId:'other',publicKeyPem:newKey.publicKeyPem}]},
  {allowLegacyVersion1:true}),/keyring rejected/);
});

test('signing rejects wrong active kid, noncanonical authority and invalid lifetime generically',()=>{
 const signer=createOperationPermitSigner(protectedConfiguration,{expectedUid:uid});
 const cases=[
  {...input,configuration:{...permitConfiguration,keyId:'old-2026-08'}},
  {...input,configuration:{...permitConfiguration,origin:'http://writer.example'}},
  {...input,expiresAt:input.issuedAt+61},
  {...input,extra:true},
 ];
 for(const value of cases)assert.throws(()=>signer.sign(value),/^Error: Operation permit signer rejected$/);
});

test('signer mints verifier-compatible recovery permits and rejects read-only context',async()=>{
 const signer=createOperationPermitSigner(protectedConfiguration,{expectedUid:uid});
 const recovery={p_workspace:'isolated',p_owner:ids.subject,
  p_original_issuer:'https://issuer.example',p_original_jti:ids.jti,
  p_original_request:ids.requestId,p_original_digest:'d'.repeat(64),
  p_route_operation:'apply'};
 const request=signer.sign({...input,operation:'recover',parameters:recovery});
 const verifier=createOperationPermitVerifier({mode:'isolated-prototype',
  configuration:JSON.stringify(permitConfiguration),verificationConfiguration:verification,
  now:()=>2_000_000_001,validateParameters:(operation,value)=>
    operation==='recover'&&value.p_original_digest===recovery.p_original_digest,
  consume:()=>true});
 const authorized=await verifier.authorize(request);
 assert.equal(authorized.operation,'recover');
 assert.equal(authorized.kind,'recovery');
 assert.deepEqual(authorized.parameters,recovery);
 assert.throws(()=>signer.sign({...input,operation:'context'}),/signer rejected/);
});
