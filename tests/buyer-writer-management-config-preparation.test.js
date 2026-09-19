import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,X509Certificate} from 'node:crypto';
import {
  BUYER_WRITER_MANAGEMENT_CONFIG,BUYER_WRITER_MANAGEMENT_HOST,prepareBuyerWriterManagementConfig,
} from '../packages/buyer-writer/management-config-preparation.js';

const ca=fs.readFileSync(new URL('./fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
assert.ok(new X509Certificate(ca));
const runtimePassword=Buffer.alloc(32,1).toString('base64url');
const issuerPassword=Buffer.alloc(32,2).toString('base64url');
const admissionPassword=Buffer.alloc(32,3).toString('base64url');
const managementPassword='fixture-temporary-access-token';
const authority={releaseSha:'a'.repeat(40),operationId:'01234567-89ab-cdef-0123-456789abcdef',
 attemptId:'11234567-89ab-cdef-0123-456789abcdef',workspace:'blackspire-command',gatewayIdentity:'blackspire-writer'};
const permit=JSON.stringify({issuer:'zola-control',audience:'buyer-writer',subject:'21234567-89ab-cdef-0123-456789abcdef',
 keyId:'fixture-key',origin:'https://zola.example',releaseSha:authority.releaseSha,operationId:authority.operationId,
 attemptId:authority.attemptId,workspace:authority.workspace});
const publicKeyPem=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
const gateway={version:4,mode:'research-admission',workspace:'blackspire-command',socketPath:'/run/blackspire/buyer-writer.sock',
 gatewayCapability:'a'.repeat(43),creatorOid:16384,authority,
 runtime:{host:BUYER_WRITER_MANAGEMENT_HOST,port:5432,database:'postgres',password:runtimePassword,ca},
 issuer:{host:BUYER_WRITER_MANAGEMENT_HOST,port:5432,database:'postgres',password:issuerPassword,ca},
 admission:{connection:{host:BUYER_WRITER_MANAGEMENT_HOST,port:5432,database:'postgres',user:'buyer_writer_admission_login',
  password:admissionPassword,ca},operationPermitConfiguration:permit,
  verificationConfiguration:{version:2,keys:[{keyId:'fixture-key',publicKeyPem,
    lifecycle:'current',verifyNotBefore:0,verifyNotAfter:null}]}}};

function fixture(t,{unsafeParent=false,existing=false,writeLimit=Infinity,uncertainLink=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-management-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const translated=value=>value==='/'?root:value==='/etc'?path.join(root,'etc'):value==='/etc/blackspire-buyer-writer-gateway'
    ?path.join(root,'etc','blackspire-buyer-writer-gateway'):value===BUYER_WRITER_MANAGEMENT_CONFIG
      ?path.join(root,'etc','blackspire-buyer-writer-gateway','management.json'):path.join(root,'etc','blackspire-buyer-writer-gateway',path.basename(value));
  fs.mkdirSync(translated('/etc/blackspire-buyer-writer-gateway'),{recursive:true,mode:0o700});
  if(existing)fs.writeFileSync(translated(BUYER_WRITER_MANAGEMENT_CONFIG),'existing',{mode:0o600});
  const metadata=(value,stat)=>Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{uid:0,gid:value===BUYER_WRITER_MANAGEMENT_CONFIG?0:44,
    mode:stat.isDirectory()?(unsafeParent&&value==='/etc'?0o40777:0o40700):0o100600});
  const io={
    lstatSync:value=>metadata(value,fs.lstatSync(translated(value))),
    openSync:(value,...args)=>fs.openSync(translated(value),...args),fstatSync:fd=>metadata(BUYER_WRITER_MANAGEMENT_CONFIG,fs.fstatSync(fd)),
    fchownSync:()=>{},fchmodSync:(fd,mode)=>fs.fchmodSync(fd,mode),
    writeSync:(fd,buffer,offset,length)=>fs.writeSync(fd,buffer,offset,Math.min(length,writeLimit)),fsyncSync:fd=>fs.fsyncSync(fd),
    closeSync:fd=>fs.closeSync(fd),linkSync:(from,to)=>{fs.linkSync(translated(from),translated(to));if(uncertainLink)throw new Error('unknown link outcome');},
    unlinkSync:value=>fs.unlinkSync(translated(value)),
  };
  const readSnapshot=(filename,{groupId})=>{
    if(filename.endsWith('gateway.json'))return {value:structuredClone(gateway),identity:{uid:0,gid:44,mode:0o100640}};
    assert.equal(groupId,0);return {value:JSON.parse(fs.readFileSync(translated(filename),'utf8')),
      identity:{uid:0,gid:0,mode:0o100600}};
  };
  return {io,readSnapshot,target:translated(BUYER_WRITER_MANAGEMENT_CONFIG)};
}

test('dummy credential fixture creates one exclusive root-only exact-schema configuration',t=>{
  const f=fixture(t,{writeLimit:7});const result=prepareBuyerWriterManagementConfig({password:managementPassword,writerGroupId:44,
    readSnapshot:f.readSnapshot,io:f.io,nonce:'a'.repeat(32),getuid:()=>0});
  assert.deepEqual(result,{status:'MANAGEMENT_CONFIG_PREPARED',path:BUYER_WRITER_MANAGEMENT_CONFIG,host:BUYER_WRITER_MANAGEMENT_HOST});
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(f.target,'utf8'))),['host','password','ca']);
  assert.equal(fs.statSync(f.target).mode&0o777,0o600);
});

test('unsafe parents, existing destinations, credential reuse and untrusted gateway bindings reject without replacement',t=>{
  const unsafe=fixture(t,{unsafeParent:true});assert.throws(()=>prepareBuyerWriterManagementConfig({password:managementPassword,writerGroupId:44,
    readSnapshot:unsafe.readSnapshot,io:unsafe.io,nonce:'b'.repeat(32),getuid:()=>0}),/preparation failed/);
  const existing=fixture(t,{existing:true});assert.throws(()=>prepareBuyerWriterManagementConfig({password:managementPassword,writerGroupId:44,
    readSnapshot:existing.readSnapshot,io:existing.io,nonce:'c'.repeat(32),getuid:()=>0}),/preparation failed/);
  assert.equal(fs.readFileSync(existing.target,'utf8'),'existing');
  const normal=fixture(t);for(const password of ['',runtimePassword,issuerPassword,admissionPassword,'line\nbreak'])assert.throws(()=>prepareBuyerWriterManagementConfig({password,
    writerGroupId:44,readSnapshot:normal.readSnapshot,io:normal.io,nonce:'d'.repeat(32),getuid:()=>0}),/preparation failed/);
  const prior=gateway.runtime.host;gateway.runtime.host='other.example';
  assert.throws(()=>prepareBuyerWriterManagementConfig({password:managementPassword,writerGroupId:44,readSnapshot:normal.readSnapshot,
    io:normal.io,nonce:'e'.repeat(32),getuid:()=>0}),/preparation failed/);gateway.runtime.host=prior;
  const uncertain=fixture(t,{uncertainLink:true});assert.throws(()=>prepareBuyerWriterManagementConfig({password:managementPassword,writerGroupId:44,
    readSnapshot:uncertain.readSnapshot,io:uncertain.io,nonce:'f'.repeat(32),getuid:()=>0}),/preparation failed/);
  assert.equal(fs.existsSync(uncertain.target),false,'unknown link outcome is reconciled by inode before cleanup');
});

test('public command is fixed-input, root-only and refuses non-terminal execution',()=>{
  const source=fs.readFileSync(new URL('../scripts/prepare-buyer-writer-management-config.js',import.meta.url),'utf8');
  assert.match(source,/process\.argv\.length!==2/);assert.match(source,/process\.stdin\.isTTY!==true/);
  assert.match(source,/\/dev\/tty/);assert.match(source,/\['-echo'\]/);assert.match(source,/SIGINT','SIGTERM','SIGHUP/);
  assert.match(source,/restore\(\);process\.removeListener/);assert.doesNotMatch(source,/process\.env/);
});
