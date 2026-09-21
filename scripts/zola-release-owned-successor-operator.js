#!/usr/bin/env node
import {register} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {OWNED_SEQUENCE} from '../packages/zola-release/owned-sequence-overlay.js';
const canonical='/mnt/blackspire-builds/development-cache/0/workspaces/zola-final-release-20260921/';
try{
 if(process.getuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||!['--release','--reassert-credential','--release-cloud-proof-attempt3'].includes(process.argv[2])
  ||process.argv[3]!==`/var/lib/blackspire-operator/preparation/owned-successor-final-${OWNED_SEQUENCE.releaseSha}/production-release.json`)throw Error('Arguments refused');
 const root=fileURLToPath(new URL('../',import.meta.url));
 const git=args=>execFileSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1'}}).trim();
 if(git(['status','--porcelain','--untracked-files=all']))throw Error('Operator source refused');
 git(['merge-base','--is-ancestor',OWNED_SEQUENCE.releaseSha,'HEAD']);
 const {verifyReleaseSource}=await import(canonical+'packages/zola-release/commander-host.js');verifyReleaseSource(OWNED_SEQUENCE.releaseSha);
 register(new URL('../packages/zola-release/owned-sequence-loader.js',import.meta.url));
 await import('./zola-release-owned-n8n-operator.js');
}catch{process.stdout.write(JSON.stringify({status:'STOPPED',reason:'OWNED_SUCCESSOR_OPERATOR_REJECTED',releaseReady:false})+'\n');process.exitCode=1;}
