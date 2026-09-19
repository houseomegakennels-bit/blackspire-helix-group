import {createPublicKey,verify} from 'node:crypto';
const KEY_ID=/^[A-Za-z0-9_-]{1,64}$/;
const exact=(value,keys)=>value!==null&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const denied=()=>new Error('Operation permit keyring rejected');
function publicKey(value){
  if(typeof value!=='string'||value.length<1||value.length>1024||value.includes('PRIVATE KEY')
    ||!value.startsWith('-----BEGIN PUBLIC KEY-----'))throw denied();
  const key=createPublicKey(value);
  const canonical=key.export({type:'spki',format:'pem'});
  if(key.type!=='public'||key.asymmetricKeyType!=='ed25519'||canonical!==value)throw denied();
  return key;
}
function legacy(value,allowLegacyVersion1){
  if(!allowLegacyVersion1||!exact(value,['version','keys'])||value.version!==1
    ||!Array.isArray(value.keys)||value.keys.length!==1
    ||!exact(value.keys[0],['keyId','publicKeyPem']))throw denied();
  return {version:2,keys:[{...value.keys[0],lifecycle:'current',
    verifyNotBefore:0,verifyNotAfter:null}]};
}
export function validateOperationPermitVerificationConfiguration(value,{allowLegacyVersion1=false}={}){
  try{
    const candidate=value?.version===1?legacy(value,allowLegacyVersion1):value;
    if(!exact(candidate,['version','keys'])||candidate.version!==2||!Array.isArray(candidate.keys)
      ||candidate.keys.length<1||candidate.keys.length>8)throw denied();
    const ids=new Set(),materials=new Set();
    const keys=candidate.keys.map(entry=>{
      if(!exact(entry,['keyId','publicKeyPem','lifecycle','verifyNotBefore','verifyNotAfter'])
        ||typeof entry.keyId!=='string'||!KEY_ID.test(entry.keyId)||ids.has(entry.keyId)
        ||materials.has(entry.publicKeyPem)||!['current','overlap'].includes(entry.lifecycle)
        ||!Number.isSafeInteger(entry.verifyNotBefore)||entry.verifyNotBefore<0)throw denied();
      if(entry.lifecycle==='current'&&entry.verifyNotAfter!==null)throw denied();
      if(entry.lifecycle==='overlap'&&(!Number.isSafeInteger(entry.verifyNotAfter)
        ||entry.verifyNotAfter<=entry.verifyNotBefore
        ||entry.verifyNotAfter-entry.verifyNotBefore>3600))throw denied();
      ids.add(entry.keyId);materials.add(entry.publicKeyPem);publicKey(entry.publicKeyPem);
      return Object.freeze({...entry});
    });
    if(keys.filter(entry=>entry.lifecycle==='current').length!==1)throw denied();
    return Object.freeze({version:2,keys:Object.freeze(keys)});
  }catch{throw denied();}
}
export function createOperationPermitVerificationKeyring(configuration,options){
  const config=validateOperationPermitVerificationConfiguration(configuration,options);
  const keys=new Map(config.keys.map(entry=>[entry.keyId,
    {key:publicKey(entry.publicKeyPem),entry}]));
  return Object.freeze({
    configuration:config,
    verify({keyId,data,signature,at}={}){
      try{
        const selected=keys.get(keyId);
        if(typeof keyId!=='string'||!KEY_ID.test(keyId)||!selected
          ||!Number.isSafeInteger(at)||at<selected.entry.verifyNotBefore
          ||selected.entry.verifyNotAfter!==null&&at>=selected.entry.verifyNotAfter
          ||!(Buffer.isBuffer(data)||data instanceof Uint8Array)
          ||!(Buffer.isBuffer(signature)||signature instanceof Uint8Array)
          ||signature.byteLength!==64)return false;
        return verify(null,data,selected.key,signature);
      }catch{return false;}
    },
  });
}
