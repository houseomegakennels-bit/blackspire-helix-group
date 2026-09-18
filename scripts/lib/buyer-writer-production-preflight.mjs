import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MODES=Object.freeze(['inspect','apply','reconcile','verify','rollback']);
const fail=()=>{throw new Error('Buyer writer production preflight failed');};
const sha=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
 &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const abs=value=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value!=='/';
const scalar=(value,max=1024)=>typeof value==='string'&&value.length>0&&value.length<=max;
const bool=value=>typeof value==='boolean';
const integer=value=>Number.isInteger(value)&&value>=0;
const sameStat=(a,b)=>['dev','ino','mode','nlink','uid','gid','size','mtimeMs','ctimeMs'].every(key=>a[key]===b[key]);
const sameDirectory=(a,b)=>['dev','ino','mode','uid','gid'].every(key=>a[key]===b[key]);

function secureBytes(filename,mode,maxBytes){
 let fd;
 try{
  if(!abs(filename))fail();const before=fs.lstatSync(filename);
  if(!before.isFile()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==mode
   ||before.nlink!==1||before.size<1||before.size>maxBytes)fail();
  fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  const inside=fs.fstatSync(fd);if(!sameStat(before,inside))fail();
  const bytes=Buffer.alloc(inside.size);if(fs.readSync(fd,bytes,0,bytes.length,0)!==bytes.length)fail();
  const after=fs.fstatSync(fd);if(!sameStat(inside,after))fail();
  return Object.freeze({bytes,sha256:sha(bytes),size:bytes.length});
 }catch{fail();}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
function secureJson(filename,mode,maxBytes){
 try{
  const snapshot=secureBytes(filename,mode,maxBytes);
  return Object.freeze({...snapshot,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(snapshot.bytes))});
 }catch{fail();}
}
function canonical(value){
 if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
 if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(key=>`${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
 return JSON.stringify(value);
}
function acl(value){
 return exact(value,['grantor','grantee','privilege','grantable'])&&scalar(value.grantor)&&scalar(value.grantee)
  &&scalar(value.privilege)&&bool(value.grantable);
}
function stringArray(value){return Array.isArray(value)&&value.every(entry=>scalar(entry));}
function aclArray(value){return Array.isArray(value)&&value.every(acl);}
function role(value){
 return exact(value,['name','oid','login','inherit','superuser','createDb','createRole','replication','bypassRls'])
  &&scalar(value.name)&&scalar(value.oid)&&['login','inherit','superuser','createDb','createRole','replication','bypassRls']
   .every(key=>bool(value[key]));
}
function membership(value){
 return exact(value,['role','roleOid','member','memberOid','grantor','grantorOid','memberLogin','grantorSuperuser','admin','inherit','set'])
  &&['role','roleOid','member','memberOid','grantor','grantorOid'].every(key=>scalar(value[key]))
  &&['memberLogin','grantorSuperuser','admin','inherit','set'].every(key=>bool(value[key]));
}
function column(value){
 return exact(value,['name','type','notNull','default'])&&scalar(value.name)&&scalar(value.type)
  &&bool(value.notNull)&&(value.default===null||typeof value.default==='string');
}
function constraint(value){
 return exact(value,['name','type','definition'])&&scalar(value.name)&&scalar(value.type)&&scalar(value.definition,16384);
}
function index(value){
 return exact(value,['name','unique','primary','definition'])&&scalar(value.name)&&bool(value.unique)
  &&bool(value.primary)&&scalar(value.definition,16384);
}
function relation(value){
 return exact(value,['schema','name','kind','owner','rlsEnabled','rlsForced','columns','constraints','indexes','edges'])
  &&['schema','name','kind','owner'].every(key=>scalar(value[key]))&&bool(value.rlsEnabled)&&bool(value.rlsForced)
  &&Array.isArray(value.columns)&&value.columns.every(column)
  &&Array.isArray(value.constraints)&&value.constraints.every(constraint)
  &&Array.isArray(value.indexes)&&value.indexes.every(index)&&aclArray(value.edges);
}
function routine(value){
 const keys=['signature','owner','ownerOid','securityDefiner','language','digest','config','volatility','kind','strict',
  'leakproof','parallel','argumentNames','result','argumentDefaults','returnsSet','variadic','hasAllArgumentTypes',
  'hasArgumentModes','edges'];
 return exact(value,keys)&&['signature','owner','ownerOid','language','digest','volatility','kind','parallel','result','variadic']
  .every(key=>scalar(value[key],16384))&&['securityDefiner','strict','leakproof','returnsSet','hasAllArgumentTypes','hasArgumentModes']
  .every(key=>bool(value[key]))&&integer(value.argumentDefaults)&&stringArray(value.config)
  &&stringArray(value.argumentNames)&&aclArray(value.edges);
}
function type(value){
 return exact(value,['schema','name','kind','owner','definition','edges'])
  &&['schema','name','kind','owner','definition'].every(key=>scalar(value[key],16384))&&aclArray(value.edges);
}
function defaultPrivilege(value){
 return exact(value,['owner','schema','objectType','edges'])&&scalar(value.owner)
  &&scalar(value.schema)&&scalar(value.objectType)&&aclArray(value.edges);
}
function extension(value){
 return exact(value,['name','version','schema','owner'])
  &&['name','version','schema','owner'].every(key=>scalar(value[key]));
}
function databasePrivilege(value){
 return exact(value,['database','grantee','connect','create','temporary'])
  &&scalar(value.database)&&scalar(value.grantee)&&['connect','create','temporary'].every(key=>bool(value[key]));
}
function observation(value){
 const keys=['version','roles','memberships','schema','relations','types','routines','defaultPrivileges','extensions',
  'databasePrivileges','targetRelations','targetPublicRelations','targetPublicColumns','directRelations','directSequences',
  'schemaCreate','externalRoutines','bootstrapSuperuser','creatorOid','relationPolicySafe','routinePolicySafe','ownerPolicySafe',
  'crossDatabaseConnect','databaseCreate','databaseTemporary','pgNet'];
 if(!exact(value,keys)||value.version!==1||!Array.isArray(value.roles)||!value.roles.every(role)
  ||!Array.isArray(value.memberships)||!value.memberships.every(membership)
  ||!exact(value.schema,['name','owner','edges'])||!scalar(value.schema.name)||!scalar(value.schema.owner)||!aclArray(value.schema.edges)
  ||!Array.isArray(value.relations)||!value.relations.every(relation)
  ||!Array.isArray(value.types)||!value.types.every(type)
  ||!Array.isArray(value.routines)||!value.routines.every(routine)
  ||!Array.isArray(value.defaultPrivileges)||!value.defaultPrivileges.every(defaultPrivilege)
  ||!Array.isArray(value.extensions)||!value.extensions.every(extension)
  ||!Array.isArray(value.databasePrivileges)||!value.databasePrivileges.every(databasePrivilege))fail();
 for(const key of ['targetRelations','targetPublicRelations','targetPublicColumns','directRelations','directSequences',
  'schemaCreate','externalRoutines','crossDatabaseConnect','pgNet'])if(!Array.isArray(value[key]))fail();
 if(!['bootstrapSuperuser','relationPolicySafe','routinePolicySafe','ownerPolicySafe'].every(key=>bool(value[key]))
  ||!scalar(value.creatorOid)||!value.databaseCreate||typeof value.databaseCreate!=='object'||Array.isArray(value.databaseCreate)
  ||!value.databaseTemporary||typeof value.databaseTemporary!=='object'||Array.isArray(value.databaseTemporary)
  ||Object.values(value.databaseCreate).some(entry=>!bool(entry))
  ||Object.values(value.databaseTemporary).some(entry=>!bool(entry)))fail();
 return value;
}
function target(value){
 const keys=['environment','host','port','database','actor','creatorOid','serverMajor'];
 if(!exact(value,keys)||value.environment!=='production'||!scalar(value.host)||value.port!==5432
  ||value.database!=='postgres'||value.actor!=='postgres'||!Number.isInteger(value.creatorOid)
  ||value.creatorOid<1||value.creatorOid>4294967295||value.serverMajor!==17)fail();
 return value;
}
function diff(before,after,prefix='',out=[]){
 if(Object.is(before,after))return out;
 if(typeof before!==typeof after||before===null||after===null||typeof before!=='object'){
  out.push(`${prefix}:${sha(Buffer.from(canonical(before)))}:${sha(Buffer.from(canonical(after)))}`);return out;
 }
 if(Array.isArray(before)!==Array.isArray(after)){out.push(`${prefix}:shape`);return out;}
 const keys=Array.isArray(before)?[...Array(Math.max(before.length,after.length)).keys()].map(String)
  :[...new Set([...Object.keys(before),...Object.keys(after)])].sort();
 for(const key of keys)diff(before[key],after[key],prefix?`${prefix}.${key}`:key,out);
 return out;
}
function releaseManifest(filename){
 const snapshot=secureJson(filename,0o600,131072),value=snapshot.value;
 const keys=['version','releaseSha','nonce','target','artifacts','configDigests','canonicalObservationSha256'];
 if(!exact(value,keys)||value.version!==2||!/^[a-f0-9]{40}$/.test(value.releaseSha)
  ||!/^[a-f0-9]{64}$/.test(value.nonce)||!/^[a-f0-9]{64}$/.test(value.canonicalObservationSha256)
  ||!exact(value.artifacts,['installer','provisioner','verifier'])
  ||!exact(value.configDigests,['gateway','management']))fail();
 target(value.target);
 for(const digest of Object.values(value.configDigests))if(!/^[a-f0-9]{64}$/.test(digest))fail();
 // No verifier module is imported or executed. Its bytes are authenticated here first.
 for(const row of Object.values(value.artifacts)){
  if(!exact(row,['path','sha256'])||!abs(row.path)||!/^[a-f0-9]{64}$/.test(row.sha256))fail();
  if(secureBytes(row.path,0o600,2097152).sha256!==row.sha256)fail();
 }
 return Object.freeze({value,sha256:snapshot.sha256});
}
function catalogSnapshot(filename,release,now){
 const snapshot=secureJson(filename,0o600,2097152),value=snapshot.value;
 const keys=['version','capturedAt','releaseSha','nonce','target','releaseManifestSha256','artifactHashes',
  'baselineObservation','projectedObservation'];
 if(!exact(value,keys)||value.version!==2||value.releaseSha!==release.value.releaseSha
  ||value.nonce!==release.value.nonce||value.releaseManifestSha256!==release.sha256
  ||canonical(value.target)!==canonical(release.value.target)||!exact(value.artifactHashes,['installer','provisioner','verifier']))fail();
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))fail();
 const captured=Date.parse(value.capturedAt);
 if(!Number.isFinite(captured)||captured>now.getTime()+30000||now.getTime()-captured>300000)fail();
 for(const name of Object.keys(value.artifactHashes))if(value.artifactHashes[name]!==release.value.artifacts[name].sha256)fail();
 const before=observation(value.baselineObservation),after=observation(value.projectedObservation);
 const projectedSha256=sha(Buffer.from(canonical(after)));
 if(projectedSha256!==release.value.canonicalObservationSha256)fail();
 const changes=diff(before,after);
 if(changes.length===0)fail();
 return Object.freeze({sha256:snapshot.sha256,capturedAt:value.capturedAt,baselineSha256:sha(Buffer.from(canonical(before))),
  projectedSha256,changeCount:changes.length,changeSetSha256:sha(Buffer.from(changes.join('\n')))});
}
function config(filename,mode,expectedDigest){
 const value=secureBytes(filename,mode,1048576);if(value.sha256!==expectedDigest)fail();
 return Object.freeze({mode:mode.toString(8).padStart(4,'0'),sha256:value.sha256,size:value.size});
}
function claim(directory,release,catalog){
 let directoryFd,claimFd;
 try{
  if(!abs(directory))fail();const before=fs.lstatSync(directory);
  if(!before.isDirectory()||before.isSymbolicLink()||before.uid!==0||before.gid!==0||(before.mode&0o7777)!==0o700)fail();
  directoryFd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC);
  if(!sameDirectory(before,fs.fstatSync(directoryFd)))fail();
  const filename=path.join(directory,`${release.value.nonce}.claim`);
  const bytes=Buffer.from(canonical({version:2,releaseSha:release.value.releaseSha,
   releaseManifestSha256:release.sha256,catalogSnapshotSha256:catalog.sha256}));
  claimFd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL
   |fs.constants.O_NOFOLLOW|fs.constants.O_CLOEXEC,0o600);
  if(fs.writeSync(claimFd,bytes)!==bytes.length)fail();fs.fsyncSync(claimFd);fs.fsyncSync(directoryFd);
  if(!sameDirectory(before,fs.fstatSync(directoryFd)))fail();
  return sha(bytes);
 }catch{fail();}finally{
  if(claimFd!==undefined)try{fs.closeSync(claimFd);}catch{}
  if(directoryFd!==undefined)try{fs.closeSync(directoryFd);}catch{}
 }
}
export function validateBuyerWriterProductionPlan(options={}){
 try{
  const keys=['mode','releaseManifestPath','catalogSnapshotPath','gatewayConfigPath','managementConfigPath',
   'nonceClaimDirectory','now'];
  if(!exact(options,keys)||!MODES.includes(options.mode)||typeof options.now!=='function')fail();
  const release=releaseManifest(options.releaseManifestPath);
  const gateway=config(options.gatewayConfigPath,0o640,release.value.configDigests.gateway);
  const management=config(options.managementConfigPath,0o600,release.value.configDigests.management);
  const catalog=catalogSnapshot(options.catalogSnapshotPath,release,options.now());
  const claimSha256=claim(options.nonceClaimDirectory,release,catalog);
  return Object.freeze({
   version:3,status:'OFFLINE_INPUTS_VALIDATED',productionReadinessEstablished:false,
   executionClassification:'IRREVERSIBLE_FORWARD_ONLY',executed:false,connectionAttempted:false,mode:options.mode,
   release:Object.freeze({releaseSha:release.value.releaseSha,manifestSha256:release.sha256}),
   target:Object.freeze({...release.value.target}),catalog,configs:Object.freeze({gateway,management}),
   nonce:Object.freeze({valueSha256:sha(Buffer.from(release.value.nonce)),claimSha256}),
   limitations:Object.freeze(['no production connection','no production identity attestation','no reversible restore established']),
   safety:Object.freeze({networkCapability:'absent',credentialValuesAccepted:false,secretsEmitted:false,
    productionMutationPerformed:false,executorAccepted:false}),
  });
 }catch{fail();}
}
