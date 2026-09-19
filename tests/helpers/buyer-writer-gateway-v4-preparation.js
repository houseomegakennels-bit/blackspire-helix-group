import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync,randomBytes} from 'node:crypto';

export const ids=Object.freeze({
  releaseSha:'a'.repeat(40),
  operationId:'00000000-0000-4000-8000-000000000001',
  attemptId:'00000000-0000-4000-8000-000000000002',
  subject:'00000000-0000-4000-8000-000000000003',
});
export const keyId='zola-'+ids.releaseSha.slice(0,16);
export const preparationRoot='/var/lib/blackspire-operator/preparation';
export const candidatePath=preparationRoot+'/buyer-writer-v4-'+ids.releaseSha+'.json';
export const keyPath='/etc/blackspire/buyer-writer-signing-key-'+keyId+'.pem';
export const sourceConfigurationFile=preparationRoot+'/source-v1.json';
export const artifactRoot='/opt/blackspire-command/releases/'+ids.releaseSha;
export const currentGatewayFile='/etc/blackspire-buyer-writer-gateway/gateway.json';

const secret=byte=>Buffer.alloc(32,byte).toString('base64url');
export function inputFixture(overrides={}){
  const ca=fs.readFileSync(new URL('../fixtures/buyer-writer/supabase-production-ca.crt',import.meta.url),'utf8');
  const runtime={host:'db.kchtrvfcixnimvxxctkj.supabase.co',port:5432,database:'postgres',password:secret(3),ca};
  const issuer={...runtime,password:secret(4)};
  const sourceConfiguration={version:1,workspace:'blackspire-command',
    bindingFile:'/etc/blackspire/buyer-writer-binding.json',
    writerCredential:secret(1),issuerCredential:secret(2),creatorOid:16384,runtime,issuer};
  const currentGatewayConfiguration={version:2,workspace:'blackspire-command',
    socketPath:'/run/blackspire/buyer-writer.sock',gatewayCapability:secret(7),creatorOid:16384,
    authority:{releaseSha:'9'.repeat(40),operationId:'90000000-0000-4000-8000-000000000001',
      attemptId:'90000000-0000-4000-8000-000000000002',workspace:'blackspire-command',
      gatewayIdentity:'blackspire-writer'},runtime,issuer};
  return {
    releaseSha:ids.releaseSha,operationId:ids.operationId,attemptId:ids.attemptId,
    workspace:'blackspire-command',origin:'https://blackspirehelix.com',keyId,
    preparationRoot,candidatePath,
    artifact:{releaseSha:ids.releaseSha,environment:'production',artifactDigest:'b'.repeat(64),
      status:'SEALED_ARTIFACT_VERIFIED',deployed:false,productionAccepted:false},
    sourceConfiguration,currentGatewayConfiguration,...overrides,
  };
}

export function deterministicDependencies(){
  const pair=generateKeyPairSync('ed25519'),values=[secret(5)];
  return {
    now:()=>Date.UTC(2026,8,19,0,0,0),
    randomBytes:size=>size===32?Buffer.from(values.shift(),'base64url'):randomBytes(size),
    randomUUID:()=>ids.subject,
    generateKeyPairSync:algorithm=>{if(algorithm!=='ed25519')throw new Error('wrong algorithm');return pair;},
    aclTool:(command,args,options)=>{
      if(command!=='/usr/bin/getfacl'||!Array.isArray(args)
        ||args[0]!=='--numeric'||args[1]!=='--omit-header'||args[2]!=='--skip-base'
        ||!args.includes('--logical')||args.at(-2)!=='--'
        ||typeof args.at(-1)!=='string'||options?.encoding!=='utf8')
        throw new Error('unexpected ACL inspection');
      return {status:0,error:undefined,signal:null,stdout:'',stderr:''};
    },
    apiUid:994,credentialGroupId:984,
  };
}

export function translatedFilesystem(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'buyer-writer-v4-preparation-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const translate=value=>typeof value==='string'&&path.isAbsolute(value)?path.join(root,value):value;
  for(const logical of ['/etc/blackspire',preparationRoot])fs.mkdirSync(translate(logical),{recursive:true,mode:0o700});
  const metadata=new Map(),fds=new Map(),inode=stat=>`${stat.dev}:${stat.ino}`;
  const remember=(stat,{uid=0,gid=0,mode=stat.mode&0o7777}={})=>{
    metadata.set(inode(stat),{uid,gid,mode});return stat;
  };
  const decorated=stat=>{
    const value=metadata.get(inode(stat));if(!value)return stat;
    return Object.assign(Object.create(Object.getPrototypeOf(stat)),stat,{
      uid:value.uid,gid:value.gid,mode:(stat.mode&~0o7777)|value.mode,
    });
  };
  for(const logical of ['/','/etc','/etc/blackspire','/var','/var/lib','/var/lib/blackspire-operator',preparationRoot]){
    const stat=fs.lstatSync(translate(logical));remember(stat,{mode:stat.mode&0o7777});
  }
  const io={...fs,
    lstatSync:value=>decorated(fs.lstatSync(translate(value))),
    statSync:value=>decorated(fs.statSync(translate(value))),
    fstatSync:fd=>decorated(fs.fstatSync(fd)),
    openSync:(value,...args)=>{
      const fd=fs.openSync(translate(value),...args),stat=fs.fstatSync(fd),flags=args[0];fds.set(fd,inode(stat));
      if(typeof flags==='number'&&(flags&fs.constants.O_CREAT)||!metadata.has(inode(stat)))
        remember(stat,{mode:stat.mode&0o7777});return fd;
    },
    closeSync:fd=>{try{return fs.closeSync(fd);}finally{fds.delete(fd);}},
    fchownSync:(fd,uid,gid)=>{const key=fds.get(fd),prior=metadata.get(key);metadata.set(key,{...prior,uid,gid});},
    fchmodSync:(fd,mode)=>{const key=fds.get(fd),prior=metadata.get(key);metadata.set(key,{...prior,mode});},
    chownSync:(value,uid,gid)=>{const stat=fs.lstatSync(translate(value)),prior=metadata.get(inode(stat));
      metadata.set(inode(stat),{...prior,uid,gid});},
    chmodSync:(value,mode)=>{const stat=fs.lstatSync(translate(value)),prior=metadata.get(inode(stat));
      metadata.set(inode(stat),{...prior,mode});},
    writeFileSync:(value,...args)=>{const result=fs.writeFileSync(translate(value),...args);
      if(typeof value==='string'){const stat=fs.lstatSync(translate(value));remember(stat,{mode:stat.mode&0o7777});}return result;},
    mkdirSync:(value,...args)=>{const result=fs.mkdirSync(translate(value),...args),stat=fs.lstatSync(translate(value));
      remember(stat,{mode:stat.mode&0o7777});return result;},
    readFileSync:(value,...args)=>fs.readFileSync(translate(value),...args),
    unlinkSync:value=>fs.unlinkSync(translate(value)),rmSync:(value,...args)=>fs.rmSync(translate(value),...args),
    accessSync:(value,...args)=>fs.accessSync(translate(value),...args),
    readdirSync:(value,...args)=>fs.readdirSync(translate(value),...args),
    realpathSync:(value,...args)=>fs.realpathSync(translate(value),...args),
    existsSync:value=>fs.existsSync(translate(value)),
    linkSync:(left,right)=>fs.linkSync(translate(left),translate(right)),
    renameSync:(left,right)=>fs.renameSync(translate(left),translate(right)),
    copyFileSync:(left,right,...args)=>{const result=fs.copyFileSync(translate(left),translate(right),...args);
      const stat=fs.lstatSync(translate(right));remember(stat,{mode:stat.mode&0o7777});return result;},
  };
  return {root,io,translate};
}
