#!/usr/bin/env node
// Explicit root production preparation, not development provisioning. Fixed
// database and identity; reads no runtime credentials and starts no services.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {verifyReleaseSource,readReleaseProtectedBytes} from '../packages/zola-release/commander-host.js';
import {findMissingSchemaObjects} from '../packages/shared/schema-validation.js';
import {prepareDenialPrincipal} from '../packages/zola-six-reads/denial-principal.js';
const DATABASE='/opt/blackspire-command/shared/database/command.sqlite';
const fail=()=>{throw new Error('DENIAL_PRINCIPAL_HOST_REJECTED');};
const run=(command,args)=>execFileSync(command,args,{encoding:'utf8',timeout:5000,maxBuffer:16384,
 env:{PATH:'/usr/bin:/bin',LC_ALL:'C'},stdio:['ignore','pipe','pipe']}).trim();
let database;
try{
 if(process.getuid?.()!==0||process.geteuid?.()!==0||process.versions.node!=='22.23.1'||process.argv.length!==4||process.argv[2]!=='--prepare')fail();
 const input=JSON.parse(readReleaseProtectedBytes(process.argv[3],16384));
 if(!input||Object.keys(input).sort().join(',')!=='issuedAt,releaseSha')fail();
 verifyReleaseSource(input.releaseSha);
 const uid=Number(run('/usr/bin/id',['-u','blackspire-api']));
 const group=run('/usr/bin/getent',['group','blackspire']).split(':');const gid=Number(group[2]);
 if(!Number.isSafeInteger(uid)||uid<1||group[0]!=='blackspire'||!Number.isSafeInteger(gid)||gid<1)fail();
 const identity=fs.lstatSync(DATABASE);
 const aclSafe=file=>{if(run('/usr/bin/getfacl',['--numeric','--omit-header','--skip-base','--logical','--',file])!=='')fail();};
 const assertHost=()=>{
  verifyReleaseSource(input.releaseSha);
  for(const unit of ['blackspire-command.service','blackspire-command-worker.service','blackspire-buyer-writer-gateway.service']){
   const values=run('/usr/bin/systemctl',['show',unit,'--property=ActiveState','--property=MainPID']).split('\n').sort().join('\n');
   if(values!=='ActiveState=inactive\nMainPID=0')fail();
  }
  for(let p=path.dirname(DATABASE);;p=path.dirname(p)){
   const s=fs.lstatSync(p);
   if(!s.isDirectory()||s.isSymbolicLink()||![0,uid].includes(s.uid)||(s.mode&0o002)
    ||(s.mode&0o020)&&s.gid!==gid)fail();
   aclSafe(p);if(p==='/')break;
  }
  const s=fs.lstatSync(DATABASE);
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==uid||s.gid!==gid||(s.mode&0o7777)!==0o660
   ||s.dev!==identity.dev||s.ino!==identity.ino)fail();
  aclSafe(DATABASE);
  // SQLite must have opened the inode we validated, not a substituted path.
  if(database&&!fs.readdirSync('/proc/self/fd').some(name=>{try{const fd=fs.statSync(`/proc/self/fd/${name}`);return fd.dev===s.dev&&fd.ino===s.ino;}catch{return false;}}))fail();
 };
 assertHost();database=new DatabaseSync(DATABASE);database.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 if(findMissingSchemaObjects(database).length)fail();
 const result=prepareDenialPrincipal(database,{issuedAt:input.issuedAt},{assertHost});
 process.stdout.write(JSON.stringify(result)+'\n');
}catch{process.stderr.write('Denial principal preparation refused; retain identity and reconcile.\n');process.exitCode=1;}
finally{try{database?.close();}catch{process.exitCode=1;}}
