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
export function validateOperationPermitVerificationConfiguration(value){
  try{
    if(!exact(value,['version','keys'])||value.version!==1||!Array.isArray(value.keys)
      ||value.keys.length<1||value.keys.length>8)throw denied();
    const ids=new Set();
    const keys=value.keys.map(entry=>{
      if(!exact(entry,['keyId','publicKeyPem'])||typeof entry.keyId!=='string'
        ||!KEY_ID.test(entry.keyId)||ids.has(entry.keyId))throw denied();
      ids.add(entry.keyId);
      publicKey(entry.publicKeyPem);
      return Object.freeze({...entry});
    });
    return Object.freeze({version:1,keys:Object.freeze(keys)});
  }catch{throw denied();}
}
export function createOperationPermitVerificationKeyring(configuration){
  const config=validateOperationPermitVerificationConfiguration(configuration);
  const keys=new Map(config.keys.map(entry=>[entry.keyId,publicKey(entry.publicKeyPem)]));
  return Object.freeze({
    configuration:config,
    verify({keyId,data,signature}={}){
      try{
        if(typeof keyId!=='string'||!KEY_ID.test(keyId)||!keys.has(keyId)
          ||!(Buffer.isBuffer(data)||data instanceof Uint8Array)
          ||!(Buffer.isBuffer(signature)||signature instanceof Uint8Array)
          ||signature.byteLength!==64)return false;
        return verify(null,data,keys.get(keyId),signature);
      }catch{return false;}
    },
  });
}
