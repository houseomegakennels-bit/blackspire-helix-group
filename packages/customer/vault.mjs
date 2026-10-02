import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {readPrivate,atomicPrivate,privateDirectory,fail} from './private-files.mjs';
const supported=p=>['openai','anthropic'].includes(p);
function key(root,create){const f=path.join(root,'secrets/master.key');privateDirectory(path.dirname(f));if(create&&!fs.existsSync(f)){const fd=fs.openSync(f,'wx',0o600);try{fs.writeFileSync(fd,randomBytes(32));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}const k=readPrivate(f,32);if(k.length!==32)fail('VAULT_KEY_INVALID');return k;}
function aad(id,provider){return Buffer.from(JSON.stringify({version:1,installationId:id,provider}));}
export function putCredential(root,id,provider,apiKey){
 if(!supported(provider)||typeof apiKey!=='string'||apiKey.length<8||apiKey.length>4096||/\s/.test(apiKey))fail('CREDENTIAL_INVALID');
 const k=key(root,true),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',k,iv);cipher.setAAD(aad(id,provider));
 const data=Buffer.concat([cipher.update(apiKey,'utf8'),cipher.final()]);
 const record={version:1,installationId:id,provider,iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')};
 atomicPrivate(path.join(root,'secrets',provider+'.encrypted.json'),JSON.stringify(record)+'\n');k.fill(0);
}
export function getCredential(root,id,provider){
 try{if(!supported(provider))fail('PROVIDER_INVALID');const record=JSON.parse(readPrivate(path.join(root,'secrets',provider+'.encrypted.json')));
 if(record.version!==1||record.installationId!==id||record.provider!==provider)fail('CREDENTIAL_BINDING');
 const k=key(root,false);try{const decipher=createDecipheriv('aes-256-gcm',k,Buffer.from(record.iv,'base64'));decipher.setAAD(aad(id,provider));decipher.setAuthTag(Buffer.from(record.tag,'base64'));
 const secret=Buffer.concat([decipher.update(Buffer.from(record.data,'base64')),decipher.final()]).toString('utf8');
 if(secret.length<8||secret.length>4096||/\s/.test(secret))fail('CREDENTIAL_INVALID');
 return {apiKey:secret,keyId:createHash('sha256').update(record.data).digest('hex')};}finally{k.fill(0);}
 }catch{fail('CUSTOMER_CREDENTIAL_UNAVAILABLE');}
}
