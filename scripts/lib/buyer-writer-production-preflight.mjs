import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {
 BUYER_WRITER_ADMISSION_ROUTINES,BUYER_WRITER_ISSUER_ROUTINES,BUYER_WRITER_ROUTINES,BUYER_WRITER_RUNTIME_ROUTINES,
} from '../../packages/buyer-writer/production-verifier.js';

const ROOT=fileURLToPath(new URL('../..',import.meta.url));
const ARTIFACT_PATHS=Object.freeze({
 installer:path.join(ROOT,'packages/buyer-writer/sql/install.sql'),
 provisioner:path.join(ROOT,'packages/buyer-writer/production-provisioner.js'),
 verifier:path.join(ROOT,'packages/buyer-writer/production-verifier.js'),
});
const HOST='db.kchtrvfcixnimvxxctkj.supabase.co';
const MODES=Object.freeze(['inspect','apply','reconcile','verify','rollback']);
const CATEGORIES=Object.freeze(['roles','schemas','objects','acls','defaultPrivileges','extensions','publicDatabasePrivileges']);
const fail=()=>{throw new Error('Buyer writer production preflight failed');};
const sha=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const abs=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/';
const sameStat=(a,b)=>['dev','ino','mode','nlink','uid','gid','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);

function secureJson(filename,mode,maxBytes=1048576){
 let fd;
 try{
  if(!abs(filename))fail();
  const before=fs.lstatSync(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==mode
   ||before.nlink!==1||before.size<2||before.size>maxBytes)fail();
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  const inside=fs.fstatSync(fd);if(!sameStat(before,inside))fail();
  const bytes=Buffer.alloc(inside.size);
  if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
  const after=fs.fstatSync(fd);if(!sameStat(inside,after))fail();
  return Object.freeze({value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)),sha256:sha(bytes)});
 }catch{fail();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function secureStat(filename,mode){
 try{
  if(!abs(filename))fail();const value=fs.lstatSync(filename);
  if(!value.isFile()||value.isSymbolicLink()||value.uid!==0||value.gid!==0||(value.mode&0o7777)!==mode||value.nlink!==1)fail();
  return Object.freeze({mode:mode.toString(8).padStart(4,'0'),size:value.size});
 }catch{fail();}
}
function target(value){
 const keys=['environment','host','port','database','actor','creatorOid','serverMajor'];
 if(!exact(value,keys)||value.environment!=='production'||value.host!==HOST||value.port!==5432
  ||value.database!=='postgres'||value.actor!=='postgres'||!Number.isInteger(value.creatorOid)
  ||value.creatorOid<1||value.creatorOid>4294967295||value.serverMajor!==17)fail();
 return value;
}
function sorted(values){
 if(!Array.isArray(values)||values.some(value=>typeof value!=='string'||value.length<1||value.length>1024)
  ||new Set(values).size!==values.length)fail();
 return [...values].sort();
}
function canonicalImpact(){
 const roles=[
  'buyer_writer_owner:NOLOGIN:NOINHERIT','buyer_writer_runtime:LOGIN:NOINHERIT',
  'buyer_writer_issuer:LOGIN:NOINHERIT','buyer_writer_admission:NOLOGIN:NOINHERIT',
  'buyer_writer_admission_login:LOGIN:NOINHERIT',
 ];
 const tables=['dispatches','receipts','sales','operation_admissions'];
 const objects=[...tables.map(name=>`table:buyer_writer.${name}`),
  ...BUYER_WRITER_ROUTINES.map(signature=>`function:${signature}`)];
 const acls=[
  'schema:buyer_writer:PUBLIC:NONE','schema:buyer_writer:anon:NONE','schema:buyer_writer:authenticated:NONE',
  'schema:buyer_writer:buyer_writer_owner:USAGE+CREATE','schema:buyer_writer:buyer_writer_runtime:USAGE',
  'schema:buyer_writer:buyer_writer_issuer:USAGE','schema:buyer_writer:buyer_writer_admission:USAGE',
  'target-relations:buyer_writer_owner:canonical-column-only','internal-relations:non-owner:NONE',
  'external-routines:buyer-writer-roles:NONE',
 ];
 for(const signature of BUYER_WRITER_ROUTINES){
  const grants=['owner'];
  if(BUYER_WRITER_RUNTIME_ROUTINES.includes(signature))grants.push('buyer_writer_runtime');
  if(BUYER_WRITER_ISSUER_ROUTINES.includes(signature))grants.push('buyer_writer_issuer');
  if(BUYER_WRITER_ADMISSION_ROUTINES.includes(signature))grants.push('buyer_writer_admission');
  acls.push(`function:${signature}:EXECUTE:${grants.join('+')}`);
 }
 return Object.freeze({
  roles:Object.freeze(sorted(roles)),schemas:Object.freeze(['buyer_writer:owner=buyer_writer_owner']),
  objects:Object.freeze(sorted(objects)),acls:Object.freeze(sorted(acls)),
  defaultPrivileges:Object.freeze([]),extensions:Object.freeze([]),
  publicDatabasePrivileges:Object.freeze(sorted([
   'postgres:PUBLIC:CREATE:revoke','postgres:PUBLIC:TEMPORARY:revoke',
   'postgres:buyer_writer_admission_login:ALL:revoke',
  ])),
 });
}
export const BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT=canonicalImpact();
const EXPECTED=BUYER_WRITER_PRODUCTION_EXPECTED_IMPACT;

function readRelease(filename){
 const snapshot=secureJson(filename,0o600,65536),value=snapshot.value;
 if(!exact(value,['version','releaseSha','nonce','target','artifacts'])||value.version!==1
  ||!/^[a-f0-9]{40}$/.test(value.releaseSha)||!/^[a-f0-9]{64}$/.test(value.nonce))fail();
 target(value.target);
 if(!exact(value.artifacts,['installer','provisioner','verifier']))fail();
 for(const [name,expectedPath] of Object.entries(ARTIFACT_PATHS)){
  const row=value.artifacts[name];
  if(!exact(row,['path','sha256'])||row.path!==expectedPath||!/^[a-f0-9]{64}$/.test(row.sha256))fail();
  const bytes=fs.readFileSync(expectedPath);if(sha(bytes)!==row.sha256)fail();
 }
 return Object.freeze({value,sha256:snapshot.sha256});
}
function readCatalog(filename,release,now){
 const snapshot=secureJson(filename,0o600),value=snapshot.value;
 if(!exact(value,['version','capturedAt','releaseSha','nonce','target','releaseManifestSha256','artifactHashes','impact'])
  ||value.version!==1||value.releaseSha!==release.value.releaseSha||value.nonce!==release.value.nonce
  ||value.releaseManifestSha256!==release.sha256||JSON.stringify(value.target)!==JSON.stringify(release.value.target))fail();
 const captured=Date.parse(value.capturedAt),clock=now.getTime();
 if(!Number.isFinite(captured)||captured>clock+30000||clock-captured>300000)fail();
 if(!exact(value.artifactHashes,['installer','provisioner','verifier']))fail();
 for(const name of Object.keys(ARTIFACT_PATHS))if(value.artifactHashes[name]!==release.value.artifacts[name].sha256)fail();
 if(!exact(value.impact,CATEGORIES))fail();
 const counts={};
 for(const category of CATEGORIES){
  const actual=sorted(value.impact[category]),expected=EXPECTED[category];
  if(actual.length!==expected.length||actual.some((entry,index)=>entry!==expected[index]))fail();
  counts[category]=actual.length;
 }
 return Object.freeze({sha256:snapshot.sha256,capturedAt:value.capturedAt,counts:Object.freeze(counts)});
}
function claimNonce(directory,release,catalog){
 let fd;
 try{
  if(!abs(directory))fail();const stat=fs.lstatSync(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink()||stat.uid!==0||stat.gid!==0||(stat.mode&0o7777)!==0o700)fail();
  const filename=path.join(directory,`${release.value.nonce}.claim`);
  const bytes=Buffer.from(JSON.stringify({version:1,releaseSha:release.value.releaseSha,
   releaseManifestSha256:release.sha256,catalogSnapshotSha256:catalog.sha256}));
  fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
   |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  if(fs.writeSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();fs.fsyncSync(fd);
  return sha(bytes);
 }catch{fail();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function readRestore(filename,release){
 if(filename===undefined)return null;
 const manifest=secureJson(filename,0o600,65536),value=manifest.value;
 if(!exact(value,['version','kind','releaseSha','nonce','target','executable'])||value.version!==1
  ||value.kind!=='buyer_writer_exact_restore'||value.releaseSha!==release.value.releaseSha
  ||value.nonce!==release.value.nonce||JSON.stringify(value.target)!==JSON.stringify(release.value.target))fail();
 const executable=value.executable;
 if(!exact(executable,['format','path','sha256','coverage'])||executable.format!=='sql'||!abs(executable.path)
  ||!/^[a-f0-9]{64}$/.test(executable.sha256)||!Array.isArray(executable.coverage)
  ||executable.coverage.length!==CATEGORIES.length
  ||CATEGORIES.some((entry,index)=>executable.coverage[index]!==entry))fail();
 let fd;
 try{
  const before=fs.lstatSync(executable.path);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==0o600
   ||before.nlink!==1||before.size<32||before.size>1048576)fail();
  fd=fs.openSync(executable.path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  const inside=fs.fstatSync(fd);if(!sameStat(before,inside))fail();
  const bytes=Buffer.alloc(inside.size);if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
  const text=bytes.toString('utf8');
  if(sha(bytes)!==executable.sha256||!text.startsWith('-- BLACKSPIRE EXACT RESTORE\n')
   ||!text.endsWith('commit;\n'))fail();
 }catch{fail();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
 return Object.freeze({manifestSha256:manifest.sha256,executableSha256:executable.sha256,coverage:Object.freeze([...CATEGORIES])});
}
function phases(mode){
 const mutation=mode==='apply'||mode==='reconcile'||mode==='rollback';
 return Object.freeze([
  Object.freeze({id:'attest-input-files',mutation:false,checkpoint:'root ownership and pinned modes'}),
  Object.freeze({id:'attest-release-and-artifacts',mutation:false,checkpoint:'on-disk hashes bound'}),
  Object.freeze({id:'compare-catalog-impact',mutation:false,checkpoint:'complete canonical delta match'}),
  Object.freeze({id:'claim-single-use-nonce',mutation:false,checkpoint:'replay refused'}),
  Object.freeze({id:'provisioner-execution',mutation,checkpoint:mutation?'forward-only unless exact restore validated':'read only'}),
 ]);
}
export function validateBuyerWriterProductionPlan(options={}){
 try{
  const keys=['mode','releaseManifestPath','catalogSnapshotPath','gatewayConfigPath','managementConfigPath',
   'nonceClaimDirectory','restoreArtifactPath','now'];
  if(!exact(options,keys)||!MODES.includes(options.mode)||typeof options.now!=='function')fail();
  const release=readRelease(options.releaseManifestPath);
  const catalog=readCatalog(options.catalogSnapshotPath,release,options.now());
  const configs=Object.freeze({gateway:secureStat(options.gatewayConfigPath,0o640),
   management:secureStat(options.managementConfigPath,0o600)});
  const restore=readRestore(options.restoreArtifactPath,release);
  const claimSha256=claimNonce(options.nonceClaimDirectory,release,catalog);
  const mutating=options.mode==='apply'||options.mode==='reconcile';
  return Object.freeze({
   version:2,status:'PLAN_VALIDATED_OFFLINE',executed:false,connectionAttempted:false,mode:options.mode,
   executionClassification:mutating?(restore?'EXACT_RESTORE_ARTIFACT_VALIDATED':'IRREVERSIBLE_FORWARD_ONLY')
    :options.mode==='rollback'?'FAIL_CLOSED_ONLY':'READ_ONLY',
   release:Object.freeze({releaseSha:release.value.releaseSha,manifestSha256:release.sha256,
    artifactHashes:Object.freeze(Object.fromEntries(Object.entries(release.value.artifacts).map(([key,row])=>[key,row.sha256])))}),
   target:Object.freeze({...release.value.target}),catalog,configs,restore,
   nonce:Object.freeze({valueSha256:sha(Buffer.from(release.value.nonce)),claimSha256}),
   plan:phases(options.mode),
   safety:Object.freeze({networkCapability:'absent',credentialValuesAccepted:false,secretsEmitted:false,
    productionMutationPerformed:false,executorAccepted:false}),
  });
 }catch{fail();}
}
