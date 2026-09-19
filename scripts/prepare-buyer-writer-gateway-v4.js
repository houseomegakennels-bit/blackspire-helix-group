#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareBuyerWriterGatewayV4} from '../packages/buyer-writer/gateway-v4-preparation.js';

const repositoryRoot=fileURLToPath(new URL('../',import.meta.url));
const preparationRoot='/var/lib/blackspire-operator/preparation';
const releaseBranch='release/zola-production-live';
const canonicalRepository='https://github.com/houseomegakennels-bit/blackspire-helix-group.git';
const releaseRoot='/opt/blackspire-command/releases';
const commandEnvironment=Object.freeze({
  PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C',GIT_CONFIG_NOSYSTEM:'1',
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_NO_REPLACE_OBJECTS:'1',
  GIT_TERMINAL_PROMPT:'0',
});
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const uuid=value=>typeof value==='string'
  &&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(value);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const protectedPath=value=>typeof value==='string'&&path.isAbsolute(value)
  &&path.resolve(value)===value&&value.startsWith(preparationRoot+'/')&&!value.includes('\0');
const fail=()=>{throw new Error('Buyer writer gateway v4 preparation stopped');};

function git(args,{maxBuffer=65_536}={}){
  const result=spawnSync('/usr/bin/git',['--no-replace-objects','-C',repositoryRoot,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],env:commandEnvironment,
    timeout:15_000,maxBuffer,killSignal:'SIGKILL',
  });
  if(result.status!==0||result.error||result.signal!==null||result.stderr!=='')fail();
  return result.stdout;
}

function assertExactReleaseSource(releaseSha){
  const expected=fs.realpathSync(repositoryRoot),actual=fs.realpathSync(process.cwd());
  if(process.cwd()!==expected||actual!==expected||fs.lstatSync(repositoryRoot).isSymbolicLink())fail();
  if(git(['rev-parse','--verify','HEAD']).trim()!==releaseSha
    ||git(['symbolic-ref','--quiet','--short','HEAD']).trim()!==releaseBranch
    ||git(['status','--porcelain','--untracked-files=all'])!=='')fail();
  const remote=git(['ls-remote','--exit-code',canonicalRepository,
    `refs/heads/${releaseBranch}`],{
    maxBuffer:4096,
  }).trim().split(/\s+/);
  if(remote.length!==2||remote[0]!==releaseSha
    ||remote[1]!==`refs/heads/${releaseBranch}`)fail();
}

function sanitizedResult(value,{releaseSha,operationId,attemptId,candidatePath}){
  const keys=['status','releaseSha','operationId','attemptId','keyId','candidatePath',
    'keyPath','candidateDigest','publicKeyDigest'];
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!==[...keys].sort().join(',')
    ||value.status!=='BUYER_WRITER_GATEWAY_V4_PREPARED'
    ||value.releaseSha!==releaseSha||value.operationId!==operationId
    ||value.attemptId!==attemptId||value.candidatePath!==candidatePath
    ||typeof value.keyId!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(value.keyId)
    ||value.keyPath!==`/etc/blackspire/buyer-writer-signing-key-${value.keyId}.pem`
    ||!digest(value.candidateDigest)||!digest(value.publicKeyDigest))fail();
  return Object.fromEntries(keys.map(key=>[key,value[key]]));
}
try{
  const args=process.argv.slice(2);
  if(process.versions.node!=='22.23.1'||process.getuid?.()!==0
    ||process.geteuid?.()!==0||args.length!==6||args[0]!=='--prepare')fail();
  const [,releaseSha,operationId,attemptId,sourceConfigurationFile,candidatePath]=args;
  if(!sha(releaseSha)||!uuid(operationId)||!uuid(attemptId)
    ||operationId===attemptId||!protectedPath(sourceConfigurationFile)
    ||!protectedPath(candidatePath)||sourceConfigurationFile===candidatePath)fail();
  assertExactReleaseSource(releaseSha);
  const result=await prepareBuyerWriterGatewayV4({
    releaseSha,operationId,attemptId,sourceConfigurationFile,candidatePath,
    artifactRoot:path.join(releaseRoot,releaseSha),
  });
  process.stdout.write(JSON.stringify(sanitizedResult(result,{
    releaseSha,operationId,attemptId,candidatePath,
  }))+'\n');
}catch{
  process.stderr.write(
    'Buyer writer gateway v4 preparation stopped; protected inputs and state were not disclosed\n',
  );
  process.exitCode=1;
}
