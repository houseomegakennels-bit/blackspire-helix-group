import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {prepareZolaConfigurationInstall,installZolaConfiguration} from '../packages/zola-release/configuration-install.js';

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
      fd=fs.openSync(journal,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);
      const parent=fs.openSync(path.dirname(journal),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
      result=await installZolaConfiguration(plan,{record:event=>{fs.writeFileSync(fd,JSON.stringify(event)+'\n');fs.fsyncSync(fd);}});
    }
    process.stdout.write(JSON.stringify(result)+'\n');
  }catch{process.stderr.write('Zola configuration installation rejected; inspect protected journal and exact files before retry\n');process.exitCode=1;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
