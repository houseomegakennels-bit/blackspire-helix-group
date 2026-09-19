import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash} from './commander-journal.js';
import {readReleaseProtectedBytes,verifyReleaseSource} from './commander-host.js';

export const PRODUCTION_REPOSITORY_ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const PRODUCTION_PREPARATION_ROOT='/var/lib/blackspire-operator/preparation';
export const PRODUCTION_OPERATOR_ROOT='/var/lib/blackspire-operator';
export const PRODUCTION_PRINCIPAL='blackspire-release-root';
export const PRODUCTION_WORKSPACE='zola-production';
const fields=['schema','kind','releaseSha','previousMainSha','recoverySha','workspace','principal','preparationRoot','packageConfigurationFile','n8nBackupFile','diskConfigurationFile','backupManifestFile','migrationConfigurationFile','activationConfigurationFile'];
const sha=value=>typeof value==='string'&&/^[a-f0-9]{40}$/.test(value);
const reject=()=>{throw new Error('Protected production release input rejected');};
const under=(root,value)=>typeof value==='string'&&path.isAbsolute(value)&&path.resolve(value)===value&&value.startsWith(`${root}/`)&&!value.includes('\0');

function assertRootOnly({getuid=process.getuid,geteuid=process.geteuid}={}){
 if(typeof getuid!=='function'||typeof geteuid!=='function'||getuid()!==0||geteuid()!==0)reject();
}
function assertRepository({cwd=process.cwd,root=PRODUCTION_REPOSITORY_ROOT}={}){
 const actual=fs.realpathSync(cwd()),expected=fs.realpathSync(root);
 if(actual!==expected||cwd()!==expected||fs.lstatSync(root).isSymbolicLink())reject();
}
function assertInputFile(filename,preparationRoot,owner){
 if(!under(preparationRoot,filename))reject();
 const root=fs.lstatSync(preparationRoot),stat=fs.lstatSync(filename);
 if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==owner||(root.mode&0o7777)!==0o700
  ||!stat.isFile()||stat.isSymbolicLink()||stat.uid!==owner||stat.gid!==owner||stat.nlink!==1||(stat.mode&0o7777)!==0o600)reject();
}

// The input chooses no commands, evidence, outcomes, URLs, tokens or adapter
// implementations. It only binds immutable package paths and release identity.
export function loadProductionReleaseInput(filename,{
 readBytes=readReleaseProtectedBytes,verifySource=verifyReleaseSource,identity,repository,
 policy={preparationRoot:PRODUCTION_PREPARATION_ROOT,operatorRoot:PRODUCTION_OPERATOR_ROOT,owner:0},
 runtimeVersion=process.versions.node,
}={}){
 if(runtimeVersion!=='22.23.1'||!exactPolicy(policy))reject();
 assertRootOnly(identity);assertRepository(repository);assertInputFile(filename,policy.preparationRoot,policy.owner);
 const raw=readBytes(filename,65536);let value;try{value=JSON.parse(raw);}catch{reject();}
 if(raw!==`${JSON.stringify(value)}\n`)reject();
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...fields].sort().join(',')
  ||value.schema!==1||value.kind!=='zola_production_release'||![value.releaseSha,value.previousMainSha,value.recoverySha].every(sha)
  ||new Set([value.releaseSha,value.previousMainSha,value.recoverySha]).size!==3
  ||value.workspace!==PRODUCTION_WORKSPACE||value.principal!==PRODUCTION_PRINCIPAL||value.preparationRoot!==policy.preparationRoot)reject();
 for(const key of fields.slice(8))if(!under(policy.operatorRoot,value[key]))reject();
 const source=verifySource(value.releaseSha);
 const second=readBytes(filename,65536);if(second!==raw)reject();
 const inputDigest=hash({bytes:raw,filename,repositoryRoot:PRODUCTION_REPOSITORY_ROOT,workspace:value.workspace,principal:value.principal});
 return Object.freeze({value:Object.freeze(structuredClone(value)),inputDigest,source:Object.freeze(structuredClone(source))});
}
function exactPolicy(value){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='operatorRoot,owner,preparationRoot'
 &&typeof value.preparationRoot==='string'&&path.isAbsolute(value.preparationRoot)&&typeof value.operatorRoot==='string'&&path.isAbsolute(value.operatorRoot)
 &&value.preparationRoot.startsWith(`${value.operatorRoot}/`)&&Number.isInteger(value.owner)&&value.owner>=0;}
