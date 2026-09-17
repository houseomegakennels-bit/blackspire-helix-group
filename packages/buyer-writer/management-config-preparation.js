import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,X509Certificate} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from './protected-json.js';
import {validateBuyerWriterGatewayServiceConfiguration} from './gateway-entry.js';

export const BUYER_WRITER_MANAGEMENT_CONFIG='/etc/blackspire-buyer-writer-gateway/management.json';
export const BUYER_WRITER_MANAGEMENT_HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const fail=()=>{throw new Error('Buyer writer management configuration preparation failed');};

function safeAncestors(filename,io){
  let current='/';
  for(const component of ['',...filename.split('/').slice(1,-1)]){
    if(component)current=path.join(current,component);const stat=io.lstatSync(current);
    if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||(stat.mode&0o022)!==0)fail();
  }
}

function absent(filename,io){
  try{io.lstatSync(filename);fail();}catch(error){if(error?.code!=='ENOENT')throw error;}
}

function sameIdentity(left,right){
  return ['uid','gid','mode','nlink','dev','ino'].every(key=>left[key]===right[key]);
}

function syncDirectory(directory,io){
  const fd=io.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}

function writeExclusiveRootFile(filename,bytes,{io=fs,nonce=randomBytes(16).toString('hex')}={}){
  let fd,identity,temp;
  try{
    safeAncestors(filename,io);absent(filename,io);
    if(!/^[a-f0-9]{32}$/.test(nonce))fail();
    temp=path.join(path.dirname(filename),`.management.json.new-${nonce}`);absent(temp,io);
    fd=io.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
    io.fchownSync(fd,0,0);io.fchmodSync(fd,0o600);identity=io.fstatSync(fd);
    if(!identity.isFile()||identity.uid!==0||identity.gid!==0||identity.nlink!==1||(identity.mode&0o7777)!==0o600)fail();
    let offset=0;while(offset<bytes.length){const count=io.writeSync(fd,bytes,offset,bytes.length-offset);if(!count)fail();offset+=count;}
    io.fsyncSync(fd);const after=io.fstatSync(fd);if(!sameIdentity(identity,after)||after.size!==bytes.length)fail();
    io.closeSync(fd);fd=undefined;
    io.linkSync(temp,filename);io.unlinkSync(temp);temp=undefined;
    const installed=io.lstatSync(filename);
    if(!installed.isFile()||installed.isSymbolicLink()||installed.uid!==0||installed.gid!==0||installed.nlink!==1
      ||(installed.mode&0o7777)!==0o600||installed.dev!==identity.dev||installed.ino!==identity.ino||installed.size!==bytes.length)fail();
    syncDirectory(path.dirname(filename),io);
  }catch{
    if(fd!==undefined)try{io.closeSync(fd);}catch{}
    if(temp)try{const stat=io.lstatSync(temp);if(identity&&stat.dev===identity.dev&&stat.ino===identity.ino)io.unlinkSync(temp);}catch{}
    try{const stat=io.lstatSync(filename);if(identity&&stat.dev===identity.dev&&stat.ino===identity.ino)io.unlinkSync(filename);}catch{}
    fail();
  }
}

export function prepareBuyerWriterManagementConfig({password,writerGroupId,
  managementConfigPath=BUYER_WRITER_MANAGEMENT_CONFIG,gatewayConfigPath='/etc/blackspire-buyer-writer-gateway/gateway.json',
  readSnapshot=readRootOwnedJsonSnapshot,io=fs,nonce,getuid=process.getuid}={}){
  let bytes;
  try{
    if(getuid?.()!==0||managementConfigPath!==BUYER_WRITER_MANAGEMENT_CONFIG||gatewayConfigPath!=='/etc/blackspire-buyer-writer-gateway/gateway.json'
      ||!Number.isInteger(writerGroupId)||writerGroupId<1||typeof password!=='string'||password.length<1||password.length>1024
      ||password.includes('\0')||password.includes('\n')||password.includes('\r'))fail();
    const snapshot=readSnapshot(gatewayConfigPath,{groupId:writerGroupId,maxBytes:65536});
    const gateway=validateBuyerWriterGatewayServiceConfiguration(snapshot.value);
    const admission=gateway.admission?.connection;
    if(snapshot.identity.uid!==0||snapshot.identity.gid!==writerGroupId||(snapshot.identity.mode&0o7777)!==0o640
      ||gateway.version!==3||gateway.mode!=='research-admission'
      ||gateway.runtime?.host!==BUYER_WRITER_MANAGEMENT_HOST||gateway.issuer?.host!==BUYER_WRITER_MANAGEMENT_HOST
      ||gateway.runtime?.port!==5432||gateway.issuer?.port!==5432||gateway.runtime?.database!=='postgres'||gateway.issuer?.database!=='postgres'
      ||gateway.runtime?.ca!==gateway.issuer?.ca||typeof gateway.runtime.ca!=='string'||gateway.runtime.ca.length>16384
      ||admission?.host!==gateway.runtime.host||admission?.port!==gateway.runtime.port||admission?.database!==gateway.runtime.database
      ||admission?.user!=='buyer_writer_admission_login'||admission?.ca!==gateway.runtime.ca
      ||password===gateway.runtime.password||password===gateway.issuer.password||password===admission?.password
      ||new Set([gateway.runtime.password,gateway.issuer.password,admission?.password,gateway.gatewayCapability]).size!==4)fail();
    const certificate=new X509Certificate(gateway.runtime.ca),now=Date.now();
    if(certificate.ca!==true||!Number.isFinite(Date.parse(certificate.validFrom))||!Number.isFinite(Date.parse(certificate.validTo))
      ||Date.parse(certificate.validFrom)>now||Date.parse(certificate.validTo)<=now)fail();
    bytes=Buffer.from(`${JSON.stringify({host:BUYER_WRITER_MANAGEMENT_HOST,password,ca:gateway.runtime.ca})}\n`,'utf8');
    writeExclusiveRootFile(managementConfigPath,bytes,{io,...(nonce?{nonce}:{})});
    const installed=readSnapshot(managementConfigPath,{groupId:0,maxBytes:65536});
    if(installed.identity.uid!==0||installed.identity.gid!==0||(installed.identity.mode&0o7777)!==0o600
      ||JSON.stringify(installed.value)!==JSON.stringify({host:BUYER_WRITER_MANAGEMENT_HOST,password,ca:gateway.runtime.ca}))fail();
    return Object.freeze({status:'MANAGEMENT_CONFIG_PREPARED',path:managementConfigPath,host:BUYER_WRITER_MANAGEMENT_HOST});
  }catch{fail();}finally{bytes?.fill(0);}
}
