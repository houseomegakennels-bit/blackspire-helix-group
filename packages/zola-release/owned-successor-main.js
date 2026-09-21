import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const PREDECESSOR_MAIN='2775fd5043ad422418a4177f686671961e9a9738';
export const SUCCESSOR_MAIN='3019785f108f3da78720da265bb5ccc6e17ae2d4';
const fail=()=>{throw Error('Owned successor reviewed main refused');};
export function bindSuccessorMain(previous,observedMain){
 if(previous?.previousMainSha!==PREDECESSOR_MAIN||observedMain!==SUCCESSOR_MAIN)fail();
 return {...previous,previousMainSha:SUCCESSOR_MAIN};
}
export function observeSuccessorMain(releaseSha,{root=fileURLToPath(new URL('../../',import.meta.url)),run=execFileSync}={}){
 if(!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
 const options={encoding:'utf8',timeout:10000,maxBuffer:256*1024,stdio:['ignore','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}};
 const git=args=>run('/usr/bin/git',['--no-replace-objects','-C',root,...args],options).trim();
 if(git(['ls-remote','https://github.com/houseomegakennels-bit/blackspire-helix-group.git','refs/heads/main'])!==`${SUCCESSOR_MAIN}\trefs/heads/main`)fail();
 git(['merge-base','--is-ancestor',PREDECESSOR_MAIN,SUCCESSOR_MAIN]);
 git(['merge-base','--is-ancestor',SUCCESSOR_MAIN,releaseSha]);
 return SUCCESSOR_MAIN;
}
