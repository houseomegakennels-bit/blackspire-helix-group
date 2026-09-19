import {constants as fsConstants,closeSync,fstatSync,openSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,createPrivateKey,createPublicKey,sign} from 'node:crypto';
import {validateOperationPermitVerificationConfiguration} from './operation-permit-keyring.js';
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const KEY_ID=/^[A-Za-z0-9_-]{1,64}$/;
const BINDING=['releaseSha','operationId','attemptId','workspace'];
const CONFIG=['issuer','audience','subject','keyId','origin',...BINDING];
const OPERATIONS=Object.freeze({issue:'issuer',cancel:'issuer',reconcile:'issuer',apply:'runtime',receipt:'runtime',recover:'recovery'});
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const denied=()=>new Error('Operation permit signer rejected');
const canonicalPath=value=>typeof value==='string'&&value.length<=4096&&path.isAbsolute(value)
  &&path.resolve(value)===value&&value!=='/';
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
export function validateOperationPermitSigningConfiguration(value,activeKeyId){
  if(!exact(value,CONFIG)||CONFIG.some(key=>typeof value[key]!=='string'||value[key].length<1||value[key].length>200)
    ||value.keyId!==activeKeyId||!KEY_ID.test(value.keyId)||!UUID.test(value.subject)
    ||!/^[a-f0-9]{40}$/.test(value.releaseSha)||!UUID.test(value.operationId)||!UUID.test(value.attemptId)
    ||!/^[A-Za-z0-9._:-]{1,128}$/.test(value.workspace))throw denied();
  const origin=new URL(value.origin);
  if(origin.protocol!=='https:'||origin.origin!==value.origin||origin.username||origin.password
    ||origin.pathname!=='/'||origin.search||origin.hash)throw denied();
}
function activePrivateKey(file,expectedUid,expectedPublicKeyPem){
  let fd;
  try{
    fd=openSync(file,fsConstants.O_RDONLY|fsConstants.O_NOFOLLOW);
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.uid!==expectedUid||(stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size<1||stat.size>4096)throw denied();
    const pem=readFileSync(fd,{encoding:'utf8'});
    const key=createPrivateKey(pem);
    if(key.type!=='private'||key.asymmetricKeyType!=='ed25519'
      ||key.export({type:'pkcs8',format:'pem'})!==pem
      ||createPublicKey(key).export({type:'spki',format:'pem'})!==expectedPublicKeyPem)throw denied();
    return key;
  }catch{throw denied();}
  finally{if(fd!==undefined)try{closeSync(fd);}catch{}}
}
export function validateOperationPermitSignerConfiguration(value,{expectedUid}={}){
  try{
    if(!Number.isInteger(expectedUid)||expectedUid<0||!exact(value,
      ['version','activeKeyId','activePrivateKeyPath','verification'])
      ||value.version!==1||typeof value.activeKeyId!=='string'||!KEY_ID.test(value.activeKeyId)
      ||!canonicalPath(value.activePrivateKeyPath))throw denied();
    const verification=validateOperationPermitVerificationConfiguration(value.verification);
    const active=verification.keys.filter(entry=>entry.keyId===value.activeKeyId);
    if(active.length!==1||active[0].lifecycle!=='current')throw denied();
    activePrivateKey(value.activePrivateKeyPath,expectedUid,active[0].publicKeyPem);
    return Object.freeze({version:1,activeKeyId:value.activeKeyId,
      activePrivateKeyPath:value.activePrivateKeyPath,verification});
  }catch{throw denied();}
}
export function createOperationPermitSigner(configuration,{expectedUid}={}){
  const config=validateOperationPermitSignerConfiguration(configuration,{expectedUid});
  const active=config.verification.keys.find(entry=>entry.keyId===config.activeKeyId);
  const privateKey=activePrivateKey(config.activePrivateKeyPath,expectedUid,active.publicKeyPem);
  const signer={
    profile:'ISOLATED_OPERATION_PERMIT_SIGNER',
    activeKeyId:config.activeKeyId,
    verificationConfiguration:config.verification,
    sign(input){
      try{
        if(!exact(input,['configuration','operation','requestId','jti','issuedAt','expiresAt','parameters'])
          ||typeof input.operation!=='string'||!Object.hasOwn(OPERATIONS,input.operation)
          ||!UUID.test(input.requestId)||!UUID.test(input.jti)||!Number.isSafeInteger(input.issuedAt)
          ||!Number.isSafeInteger(input.expiresAt)||input.issuedAt<active.verifyNotBefore
          ||input.expiresAt<=input.issuedAt||input.expiresAt-input.issuedAt>60)throw denied();
        validateOperationPermitSigningConfiguration(input.configuration,config.activeKeyId);
        if(input.parameters===null||typeof input.parameters!=='object'||Array.isArray(input.parameters))throw denied();
        const envelope={version:1,requestId:input.requestId,operation:input.operation,parameters:input.parameters,
          ...Object.fromEntries(BINDING.map(key=>[key,input.configuration[key]]))};
        const body=JSON.stringify({envelope});
        if(Buffer.byteLength(body)>65536)throw denied();
        const recovery=input.operation==='recover'?{
          originalIssuer:input.parameters.p_original_issuer,
          originalJti:input.parameters.p_original_jti,
          originalRequestId:input.parameters.p_original_request,
          originalBodyDigest:input.parameters.p_original_digest,
          routeOperation:input.parameters.p_route_operation,
        }:{};
        if(input.operation==='recover'&&(typeof recovery.originalIssuer!=='string'||recovery.originalIssuer.length<1
          ||recovery.originalIssuer.length>200||!UUID.test(recovery.originalJti)||!UUID.test(recovery.originalRequestId)
          ||!/^[a-f0-9]{64}$/.test(recovery.originalBodyDigest)
          ||!['apply','issue','cancel','reconcile','receipt'].includes(recovery.routeOperation)))throw denied();
        const header=encode({alg:'Ed25519',typ:'zola-operation+jwt',kid:config.activeKeyId});
        const claims=encode({iss:input.configuration.issuer,aud:input.configuration.audience,
          sub:input.configuration.subject,jti:input.jti,iat:input.issuedAt,nbf:input.issuedAt,
          exp:input.expiresAt,kind:OPERATIONS[input.operation],operation:input.operation,
          requestId:input.requestId,bodyDigest:createHash('sha256').update(body).digest('hex'),
          ...Object.fromEntries(BINDING.map(key=>[key,input.configuration[key]])),...recovery});
        const signingInput=header+'.'+claims;
        const signature=sign(null,Buffer.from(signingInput),privateKey).toString('base64url');
        return Object.freeze({origin:input.configuration.origin,method:'POST',
          path:'/rest/v1/rpc/'+input.operation,profile:'buyer_writer_rpc',body,
          token:signingInput+'.'+signature});
      }catch{throw denied();}
    },
  };
  Object.defineProperty(signer,Symbol.for('nodejs.util.inspect.custom'),{
    value:()=>`OperationPermitSigner(activeKeyId=${config.activeKeyId})`,enumerable:false,
  });
  return Object.freeze(signer);
}
