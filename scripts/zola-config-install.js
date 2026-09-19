import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareZolaConfigurationInstall,installZolaConfiguration} from '../packages/zola-release/configuration-install.js';

const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function inspectConfigurationInstallJournal(bytes,plan){
  if(bytes.length===0)return [];
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(!text.endsWith('\n'))throw new Error();
  const rows=text.slice(0,-1).split('\n').map(line=>JSON.parse(line));
  if(rows.length<1||rows.length>2
    ||!exact(rows[0],['event','releaseSha','artifactDigest'])
    ||rows[0].event!=='configuration_install_intent'
    ||rows[0].releaseSha!==plan.releaseSha||rows[0].artifactDigest!==plan.artifactDigest)throw new Error();
  if(rows[1]&&(!exact(rows[1],['event','releaseSha','manifestPath','manifestDigest'])
    ||rows[1].event!=='configuration_install_verified'||rows[1].releaseSha!==plan.releaseSha
    ||rows[1].manifestPath!==plan.manifestPath||!/^[a-f0-9]{64}$/.test(rows[1].manifestDigest)))throw new Error();
  return rows;
}
function journalAcl(fd){
  const result=spawnSync('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--','/proc/self/fd/3'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe',fd],timeout:1000,maxBuffer:4096,
    killSignal:'SIGKILL',env:{PATH:'/usr/bin:/bin',LC_ALL:'C'}});
  if(result.status!==0||result.error||result.stdout!==''||result.stderr!=='')throw new Error();
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  let fd;
  try{
    const [mode,releaseSha,configurationFile,journal]=process.argv.slice(2);
    if(process.getuid()!==0||!['--plan','--install'].includes(mode)||process.argv.length!==(mode==='--plan'?5:6))throw new Error();
    const plan=await prepareZolaConfigurationInstall({releaseSha,configurationFile});
    let result=plan;
    if(mode==='--install'){
      if(!path.isAbsolute(journal)||path.resolve(journal)!==journal)throw new Error();
      let current='/';
      for(const part of journal.split('/').slice(1,-1)){
        current=path.join(current,part);const s=fs.lstatSync(current);
        if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||(s.mode&0o022)!==0)throw new Error();
      }
      let created=false;
      try{fd=fs.openSync(journal,fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);}
      catch(error){
        if(error.code!=='ENOENT')throw error;
        fd=fs.openSync(journal,fs.constants.O_RDWR|fs.constants.O_APPEND|fs.constants.O_CREAT
          |fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);created=true;
        fs.fchownSync(fd,0,0);fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);
        const parent=fs.openSync(path.dirname(journal),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
        try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
      }
      const before=fs.fstatSync(fd);
      if(!before.isFile()||before.uid!==0||before.gid!==0||before.nlink!==1
        ||(before.mode&0o7777)!==0o600||before.size>8192)throw new Error();
      journalAcl(fd);
      const bytes=fs.readFileSync(fd);const after=fs.fstatSync(fd);
      if(['dev','ino','uid','gid','mode','nlink','size','ctimeMs','mtimeMs'].some(key=>before[key]!==after[key]))throw new Error();
      const existing=inspectConfigurationInstallJournal(bytes,plan);bytes.fill(0);let cursor=0;
      const record=event=>{
        if(cursor<existing.length){if(JSON.stringify(existing[cursor])!==JSON.stringify(event))throw new Error();cursor++;return;}
        const candidate=[...existing,event];
        inspectConfigurationInstallJournal(Buffer.from(candidate.map(row=>JSON.stringify(row)+'\n').join('')),plan);
        fs.writeFileSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);existing.push(structuredClone(event));cursor++;
      };
      result=await installZolaConfiguration(plan,{record});
      if(cursor!==existing.length||created&&existing.length!==2)throw new Error();
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Zola configuration installation rejected; inspect protected journal and exact files before retry\n');process.exitCode=1;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
