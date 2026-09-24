#!/usr/bin/env node
import {databaseTlsOptions} from '../packages/buyer-writer/database-profile.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {prepareBuyerWriterSourceV1} from '../packages/buyer-writer/source-v1-preparation.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const branch='release/zola-production-live';
const remote='https://github.com/houseomegakennels-bit/blackspire-helix-group.git';
const preparation='/var/lib/blackspire-operator/preparation';
const releaseRoot='/opt/blackspire-command/releases';
const managementConfig='/etc/blackspire-buyer-writer-gateway/management.json';
const env=Object.freeze({PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C',
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',
  GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'});
const fail=()=>{throw new Error('Buyer writer source v1 preparation stopped');};
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
const uuid=v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(v??'');
const protectedPath=v=>typeof v==='string'&&path.isAbsolute(v)
  &&path.resolve(v)===v&&path.dirname(v)===preparation;
function git(args,maxBuffer=65536){
  const r=spawnSync('/usr/bin/git',['--no-replace-objects','-C',root,...args],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],env,timeout:15000,maxBuffer,
    killSignal:'SIGKILL'});
  if(r.status!==0||r.error||r.signal!==null||r.stderr!=='')fail();
  return r.stdout;
}
function exactRelease(releaseSha){
  if(process.cwd()!==fs.realpathSync(root)||fs.realpathSync(process.cwd())!==fs.realpathSync(root)
    ||fs.lstatSync(root).isSymbolicLink()||git(['rev-parse','--verify','HEAD']).trim()!==releaseSha
    ||git(['symbolic-ref','--quiet','--short','HEAD']).trim()!==branch
    ||git(['status','--porcelain','--untracked-files=all'])!=='')fail();
  const found=git(['ls-remote','--exit-code',remote,`refs/heads/${branch}`],4096)
    .trim().split(/\s+/);
  if(found.length!==2||found[0]!==releaseSha||found[1]!==`refs/heads/${branch}`)fail();
}
try{
  const args=process.argv.slice(2);
  if(process.versions.node!=='22.23.1'||process.getuid?.()!==0
    ||process.geteuid?.()!==0||args.length!==7||args[0]!=='--prepare')fail();
  const [,releaseSha,operationId,attemptId,credentialSourceFile,
    managementConfigFile,destinationFile]=args;
  if(!sha(releaseSha)||!uuid(operationId)||!uuid(attemptId)||operationId===attemptId
    ||![credentialSourceFile,destinationFile].every(protectedPath)
    ||![managementConfig,'/etc/blackspire/owned-postgres/management.json'].includes(managementConfigFile)
    ||new Set([credentialSourceFile,managementConfigFile,destinationFile]).size!==3)fail();
  exactRelease(releaseSha);
  const connect=async credential=>{
    const client=new pg.Client({host:credential.host,port:credential.port??5432,database:credential.database??'postgres',user:credential.user??'postgres',
      password:credential.password,ssl:databaseTlsOptions(credential),
      application_name:'blackspire-buyer-writer-source-v1-catalog',
      connectionTimeoutMillis:5000,query_timeout:10000,
      options:'-c statement_timeout=7000 -c lock_timeout=1000 -c search_path=pg_catalog'});
    client.on('error',()=>{});await client.connect();return client;
  };
  const result=await prepareBuyerWriterSourceV1({releaseSha,operationId,attemptId,
    credentialSourceFile,managementConfigFile,destinationFile,
    artifactRoot:path.join(releaseRoot,releaseSha)},{connect});
  process.stdout.write(JSON.stringify(result)+'\n');
}catch{
  process.stderr.write('Buyer writer source v1 preparation stopped; protected inputs and state were not disclosed\n');
  process.exitCode=1;
}
