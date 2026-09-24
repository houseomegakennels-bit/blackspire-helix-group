import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const fail=()=>{throw new Error('Runtime dependency installation rejected');};
const present=p=>{try{fs.lstatSync(p);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function readJson(file) {
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||stat.size>1024*1024)fail();
  return JSON.parse(fs.readFileSync(file,'utf8'));
}

// Install only an unsealed, freshly copied package. No inherited npm settings,
// credentials, lifecycle scripts, bin links, arbitrary URLs or host modules.
// Call before immutable evidence generation; dependency bytes remain in its hash.
export function installRuntimeDependencies(directory,{run=spawnSync}={}) {
  let temporary;
  try {
    if(process.versions.node!=='22.23.1'||typeof directory!=='string'||!path.isAbsolute(directory))fail();
    const root=path.resolve(directory);
    if(fs.realpathSync(root)!==root||!fs.statSync(root).isDirectory())fail();
    for(const name of ['RELEASE_EVIDENCE.json','.release-complete','.deployment-record.json','.npmrc','node_modules'])if(present(path.join(root,name)))fail();
    const pkg=readJson(path.join(root,'package.json'));const lock=readJson(path.join(root,'package-lock.json'));
    const manifests=['package.json','package-lock.json'].map(name=>({name,bytes:fs.readFileSync(path.join(root,name))}));
    if(['workspaces','optionalDependencies','bundleDependencies','bundledDependencies','overrides','resolutions'].some(name=>Object.hasOwn(pkg,name)))fail();
    if(lock.lockfileVersion!==3||!lock.packages||Array.isArray(lock.packages)||!lock.packages['']||Object.keys(lock.packages).length>128)fail();
    const dependencies=pkg.dependencies??{};
    if(typeof dependencies!=='object'||Array.isArray(dependencies))fail();
    if(JSON.stringify(dependencies)!==JSON.stringify(lock.packages['']?.dependencies??{}))fail();
    for(const [name,version] of Object.entries(dependencies))if(!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(name)
      ||typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))fail();
    for(const [relative,entry] of Object.entries(lock.packages)) {
      if(relative==='')continue;
      if(!/^node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/.test(relative)||entry.link)fail();
      const url=new URL(entry.resolved);
      if(url.protocol!=='https:'||url.hostname!=='registry.npmjs.org'||url.port||url.username||url.password||url.search||url.hash
        ||typeof entry.integrity!=='string'||!/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity))fail();
    }
    if(!Object.keys(dependencies).length)return {installed:false,packages:0};
    temporary=fs.mkdtempSync(path.join(os.tmpdir(),'blackspire-runtime-npm-'));
    for(const name of ['user.npmrc','global.npmrc'])fs.writeFileSync(path.join(temporary,name),'',{mode:0o600,flag:'wx'});
    const nodeDirectory=path.dirname(process.execPath);
    const npm=fs.realpathSync(path.join(nodeDirectory,'npm'));
    const result=run(process.execPath,[npm,'--prefix',root,'ci','--workspaces=false','--omit=dev','--ignore-scripts','--no-bin-links','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{
      cwd:root,timeout:120000,maxBuffer:1024*1024,killSignal:'SIGKILL',encoding:'utf8',
      env:{PATH:`${nodeDirectory}:/usr/bin:/bin`,HOME:temporary,NPM_CONFIG_USERCONFIG:path.join(temporary,'user.npmrc'),
        NPM_CONFIG_GLOBALCONFIG:path.join(temporary,'global.npmrc'),NPM_CONFIG_CACHE:path.join(temporary,'cache'),NPM_CONFIG_UPDATE_NOTIFIER:'false'},
    });
    if(result.status!==0||result.error)fail();
    for(const manifest of manifests)if(!fs.readFileSync(path.join(root,manifest.name)).equals(manifest.bytes))fail();
    let bytes=0,files=0;
    const inspect=current=>{
      for(const entry of fs.readdirSync(current,{withFileTypes:true})) {
        const file=path.join(current,entry.name);const stat=fs.lstatSync(file);
        if(stat.isSymbolicLink()||(!stat.isFile()&&!stat.isDirectory())||stat.isFile()&&stat.nlink!==1)fail();
        if(stat.isDirectory())inspect(file);
        else {bytes+=stat.size;files++;if(bytes>32*1024*1024||files>10000)fail();}
      }
    };
    inspect(path.join(root,'node_modules'));
    for(const [name,version] of Object.entries(dependencies))if(readJson(path.join(root,'node_modules',name,'package.json')).version!==version)fail();
    return {installed:true,packages:Object.keys(dependencies).length,files,bytes};
  }catch{fail();}
  finally{if(temporary)fs.rmSync(temporary,{recursive:true,force:true});}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{console.log(JSON.stringify(installRuntimeDependencies(process.argv[2])));}
  catch{console.error('Runtime dependency installation rejected');process.exitCode=1;}
}
