import fs from 'node:fs';
import {register} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OWNED_SIX_READ,assertOwnedSixReadSource} from '../packages/zola-release/owned-six-read-overlay.js';
try{
 const input='/var/lib/blackspire-operator/preparation/owned-successor-final-'+OWNED_SIX_READ.releaseSha+'/production-release.json';
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[2]!=='--release-cloud-proof-attempt9'||process.argv[3]!==input)throw Error('Arguments');
 const root=fileURLToPath(new URL('../',import.meta.url)).replace(/\/$/,'');
 const env={PATH:'/opt/nodejs/node-v22.23.1-linux-x64/bin:/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'};
 const git=(r,args)=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',r,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,env}).trim();
 const sha=git(root,['rev-parse','HEAD']);
 const check=()=>{
  git(root,['merge-base','--is-ancestor',OWNED_SIX_READ.frozenSha,'HEAD']);
  assertOwnedSixReadSource({wrapperRoot:fs.realpathSync(root),frozenRoot:fs.realpathSync(OWNED_SIX_READ.frozenRoot),frozenSha:git(OWNED_SIX_READ.frozenRoot,['rev-parse','HEAD']),
   wrapperClean:git(root,['status','--porcelain','--untracked-files=all'])==='',frozenClean:git(OWNED_SIX_READ.frozenRoot,['status','--porcelain','--untracked-files=all'])==='',ancestor:true,wrapperSha:git(root,['rev-parse','HEAD'])});
  if(git(root,['rev-parse','HEAD'])!==sha)throw Error('Source changed');
 };
 check();
 const guard=execFileSync('/opt/nodejs/node-v22.23.1-linux-x64/bin/node',[root+'/scripts/zola-owned-six-read-start-guard.js'],{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:4096,env,stdio:['ignore','pipe','pipe']});
 if(guard!=='OWNED_SIX_READ_START_VERIFIED\n')throw Error('Guard');
 check();register(new URL('../packages/zola-release/owned-six-read-loader.js',import.meta.url));
 await import(OWNED_SIX_READ.frozenRoot+'/scripts/zola-release-owned-successor-operator.js');check();
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_SIX_READ_OPERATOR_REJECTED',releaseReady:false})+'\n');process.exitCode=1;}
