import fs from 'node:fs';
import {register} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {SUCCESSOR,successorFail} from '../packages/zola-six-reads/owned-collector-successor.js';
import {OWNED_SIX_READ} from '../packages/zola-release/owned-six-read-overlay.js';
import {readTerminalProof} from '../packages/zola-six-reads/owned-collector-successor-host.js';
try{
 const input='/var/lib/blackspire-operator/preparation/owned-successor-final-'+SUCCESSOR.releaseSha+'/production-release.json';
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[2]!=='--release-cloud-proof-attempt9'||process.argv[3]!==input||fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'')!==SUCCESSOR.root)successorFail();
 const env={PATH:'/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'};
 const git=(root,args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,env,stdio:['ignore','pipe','pipe']}).trim();
 const operatorSha=git(SUCCESSOR.root,['rev-parse','HEAD']);
 const check=()=>{
  git(SUCCESSOR.root,['merge-base','--is-ancestor',SUCCESSOR.baseSha,'HEAD']);
  for(const [root,sha] of [[SUCCESSOR.root,operatorSha],[SUCCESSOR.frozenRoot,SUCCESSOR.baseSha],[SUCCESSOR.canonicalRoot,SUCCESSOR.releaseSha],[OWNED_SIX_READ.frozenRoot,OWNED_SIX_READ.frozenSha]])if(fs.realpathSync(root)!==root||git(root,['rev-parse','HEAD'])!==sha||git(root,['status','--porcelain','--untracked-files=all'])!=='')successorFail();
  if(operatorSha===SUCCESSOR.baseSha)successorFail();readTerminalProof();
 };
 check();
 const guard=execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',[SUCCESSOR.root+'/scripts/zola-owned-six-read-start-guard.js'],{cwd:SUCCESSOR.root,encoding:'utf8',timeout:30000,maxBuffer:4096,env,stdio:['ignore','pipe','pipe']});
 if(guard!=='OWNED_SIX_READ_START_VERIFIED\n')successorFail();check();
 register(new URL('../packages/zola-six-reads/owned-collector-successor-loader.js',import.meta.url));
 await import(OWNED_SIX_READ.frozenRoot+'/scripts/zola-release-owned-successor-operator.js');check();
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_COLLECTOR_SUCCESSOR_REJECTED',releaseReady:false})+'\n');process.exitCode=1;}
