#!/usr/bin/env node
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import pg from 'pg';
import {inspectSealedBuyerWriterArtifact} from '../packages/buyer-writer/artifact-inspection.js';
import {prepareBuyerAcceptanceTarget} from '../packages/buyer-writer/acceptance-target-preparation.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const branch='release/zola-production-live';
const remote='https://github.com/houseomegakennels-bit/blackspire-helix-group.git';
const env=Object.freeze({PATH:'/usr/bin:/bin',HOME:'/nonexistent',LC_ALL:'C',LANG:'C',
  GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',
  GIT_NO_REPLACE_OBJECTS:'1',GIT_TERMINAL_PROMPT:'0'});
const fail=()=>{throw new Error('Buyer acceptance target preparation stopped');};
const sha=v=>/^[a-f0-9]{40}$/.test(v??'');
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
    ||process.geteuid?.()!==0||args.length!==2||args[0]!=='--prepare')fail();
  const [,releaseSha]=args;if(!sha(releaseSha))fail();
  exactRelease(releaseSha);
  const artifact=await inspectSealedBuyerWriterArtifact({artifactRoot:`/opt/blackspire-command/releases/${releaseSha}`,releaseSha,environment:'production'});
  if(artifact.releaseSha!==releaseSha||artifact.environment!=='production'
    ||artifact.status!=='SEALED_ARTIFACT_VERIFIED'||artifact.deployed!==false
    ||artifact.productionAccepted!==false)fail();
  const group=spawnSync('/usr/bin/getent',['group','blackspire-api'],{
    encoding:'utf8',stdio:['ignore','pipe','pipe'],env,timeout:1000,maxBuffer:4096});
  const fields=group.stdout?.trim().split(':');
  if(group.status!==0||group.error||group.signal||group.stderr!==''||fields?.length!==4
    ||fields[0]!=='blackspire-api'||!/^[1-9][0-9]{0,9}$/.test(fields[2]))fail();
  const credentialGroupId=Number(fields[2]);
  const connect=async credential=>{
    const client=new pg.Client({host:credential.host,port:5432,database:'postgres',user:'postgres',
      password:credential.password,ssl:{rejectUnauthorized:true,ca:credential.ca},
      application_name:'blackspire-buyer-acceptance-preparation',
      connectionTimeoutMillis:5000,query_timeout:10000,
      options:'-c statement_timeout=7000 -c lock_timeout=1000 -c search_path=pg_catalog'});
    client.on('error',()=>{});
    try{await client.connect();return client;}catch{try{await client.end();}catch{}fail();}
  };
  const result=await prepareBuyerAcceptanceTarget({releaseSha,credentialGroupId},{connect});
  process.stdout.write(JSON.stringify(result)+'\n');
}catch{
  process.stderr.write('Buyer acceptance target preparation stopped; protected inputs and state were not disclosed\n');
  process.exitCode=1;
}
