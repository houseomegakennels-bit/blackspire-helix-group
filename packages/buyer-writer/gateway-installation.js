import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const GATEWAY_SERVICE='blackspire-buyer-writer-gateway.service';
export const GATEWAY_RELEASE_TOKEN='@BLACKSPIRE_GATEWAY_RELEASE_SHA@';
export const GATEWAY_CONFIG_TOKEN='@BLACKSPIRE_GATEWAY_CONFIG_PATH@';
export const GATEWAY_CONFIG_PATH='/etc/blackspire-buyer-writer-gateway/gateway.json';
export const GATEWAY_NODE='/opt/nodejs/node-v22.23.1-linux-x64/bin/node';

const SHA=/^[a-f0-9]{40}$/;
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const fail=message=>{throw new Error(message);};
const digest=value=>createHash('sha256').update(value).digest('hex');

export function validateGatewayReleaseSha(sha){
  if(typeof sha!=='string'||!SHA.test(sha))fail('gateway installer requires an exact full release SHA');
  return sha;
}

export function gatewayArtifactPath(sha,{releaseRoot='/opt/blackspire-command'}={}){
  validateGatewayReleaseSha(sha);
  if(typeof releaseRoot!=='string'||!path.isAbsolute(releaseRoot)||path.resolve(releaseRoot)!==releaseRoot||releaseRoot==='/'||releaseRoot.includes('\0'))fail('gateway release root rejected');
  return path.join(releaseRoot,'releases',sha);
}

export function renderGatewayUnit(template,{sha,configPath=GATEWAY_CONFIG_PATH,releaseRoot='/opt/blackspire-command'}={}){
  const artifact=gatewayArtifactPath(sha,{releaseRoot});
  if(typeof template!=='string'||template.length<1||template.length>65_536)fail('gateway unit template rejected');
  if((template.match(new RegExp(GATEWAY_RELEASE_TOKEN,'g'))??[]).length<1
    ||(template.match(new RegExp(GATEWAY_CONFIG_TOKEN,'g'))??[]).length<1)fail('gateway unit template binding is incomplete');
  if(configPath!==GATEWAY_CONFIG_PATH)fail('gateway configuration path rejected');
  const rendered=template.replaceAll(GATEWAY_RELEASE_TOKEN,sha).replaceAll(GATEWAY_CONFIG_TOKEN,configPath);
  if(rendered.includes('@BLACKSPIRE_GATEWAY_')||rendered.includes('/current')||rendered.includes('/HEAD')
    ||rendered.includes('WorkingDirectory='+releaseRoot)&&!rendered.includes(`WorkingDirectory=${artifact}`))fail('gateway unit retained mutable executable authority');
  if(!rendered.includes(artifact)||!rendered.includes(configPath))fail('gateway unit exact authority binding rejected');
  return rendered;
}

function safeRegular(stat,mode){return stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&(stat.mode&0o777)===mode;}

export function inspectGatewayArtifact({sha,releaseRoot='/opt/blackspire-command',io=fs,validateCompletedRelease=()=>true}={}){
  const artifact=gatewayArtifactPath(sha,{releaseRoot});
  try{
    const stat=io.lstatSync(artifact);
    if(!stat.isDirectory()||stat.isSymbolicLink())fail('gateway artifact is missing or unsafe');
    const marker=io.lstatSync(path.join(artifact,'.release-complete'));
    const commit=io.lstatSync(path.join(artifact,'COMMIT_SHA'));
    const entry=io.lstatSync(path.join(artifact,'packages/buyer-writer/gateway-entry.js'));
    const readiness=io.lstatSync(path.join(artifact,'packages/buyer-writer/gateway-readiness.js'));
    const cleanup=io.lstatSync(path.join(artifact,'packages/buyer-writer/gateway-socket-cleanup.js'));
    const unit=io.lstatSync(path.join(artifact,'ops/runtime-ownership',GATEWAY_SERVICE));
    if(!safeRegular(marker,0o644)||!safeRegular(commit,0o644)||!safeRegular(entry,0o644)
      ||!safeRegular(readiness,0o644)||!safeRegular(cleanup,0o644)||!safeRegular(unit,0o644))
      fail('gateway artifact file contract rejected');
    if(io.readFileSync(path.join(artifact,'COMMIT_SHA'),'utf8')!==`${sha}\n`)fail('gateway artifact SHA rejected');
    if(validateCompletedRelease(artifact,sha)!==true)fail('gateway artifact release evidence rejected');
    return Object.freeze({state:'VERIFIED',sha,artifact,entrypoint:path.join(artifact,'packages/buyer-writer/gateway-entry.js')});
  }catch(error){
    if(error?.message?.startsWith('gateway artifact'))throw error;
    fail('gateway artifact is missing or unsafe');
  }
}

export function gatewayInstallEffects({sha,artifact,sourceUnit,destinationUnit=`/etc/systemd/system/${GATEWAY_SERVICE}`}={}){
  validateGatewayReleaseSha(sha);
  const expected=gatewayArtifactPath(sha);
  if(artifact!==expected)fail('gateway installer refuses non-canonical artifact authority');
  if(sourceUnit!==path.join(expected,'ops/runtime-ownership',GATEWAY_SERVICE))fail('gateway installer refuses a mutable unit source');
  if(destinationUnit!==`/etc/systemd/system/${GATEWAY_SERVICE}`)fail('gateway installer destination rejected');
  return Object.freeze([
    Object.freeze({kind:'provision-identity',source:path.join(expected,'ops/runtime-ownership/blackspire-buyer-writer-gateway.sysusers.conf')}),
    Object.freeze({kind:'provision-directories',source:path.join(expected,'ops/runtime-ownership/blackspire-buyer-writer-gateway.tmpfiles.conf')}),
    Object.freeze({kind:'install-unit',source:sourceUnit,destination:destinationUnit}),
    Object.freeze({kind:'daemon-reload'}),
    Object.freeze({kind:'enable-start',unit:GATEWAY_SERVICE}),
  ]);
}

export function assertGatewayOnlyEffects(effects){
  if(!Array.isArray(effects)||effects.length<1)fail('gateway installation effects rejected');
  const serialized=JSON.stringify(effects);
  for(const forbidden of ['blackspire-command.service','blackspire-command-worker.service','n8n','release-switch','migration']){
    if(serialized.includes(forbidden))fail('gateway installer attempted an out-of-scope effect');
  }
  for(const effect of effects){
    if(effect.kind==='enable-start'&&effect.unit!==GATEWAY_SERVICE)fail('gateway installer service target rejected');
  }
  return true;
}

export function gatewayActivationActions(){
  return Object.freeze([
    Object.freeze(['enable',GATEWAY_SERVICE]),
    Object.freeze(['restart',GATEWAY_SERVICE]),
  ]);
}

export function gatewayRollbackActions({previousUnitSha256,previousEnabled,previousActive}={}){
  if(previousUnitSha256!==null&&!/^[a-f0-9]{64}$/.test(previousUnitSha256??'')
    ||previousUnitSha256===null&&(previousEnabled!==false||previousActive!==false)
    ||typeof previousEnabled!=='boolean'||typeof previousActive!=='boolean')fail('gateway rollback service state rejected');
  const actions=[Object.freeze(['disable','--now',GATEWAY_SERVICE]),Object.freeze(['daemon-reload'])];
  if(previousEnabled)actions.push(Object.freeze(['enable',GATEWAY_SERVICE]));
  if(previousActive)actions.push(Object.freeze(['start',GATEWAY_SERVICE]));
  return Object.freeze(actions);
}

export function validateGatewayRuntimeObservation({state,exe,cwd,cmdline}={}, {sha}={}){
  const artifact=gatewayArtifactPath(sha),entry=path.join(artifact,'packages/buyer-writer/gateway-entry.js');
  if(!exact(state,['ActiveState','SubState','MainPID','User','Group'])||state.ActiveState!=='active'||state.SubState!=='running'
    ||!/^[1-9][0-9]*$/.test(state.MainPID??'')||state.User!=='blackspire-writer'||state.Group!=='blackspire-api'
    ||exe!==GATEWAY_NODE||cwd!==artifact||!Array.isArray(cmdline)
    ||cmdline.length!==4||cmdline[0]!==GATEWAY_NODE||cmdline[1]!==entry||cmdline[2]!=='--configuration'||cmdline[3]!==GATEWAY_CONFIG_PATH)
    fail('gateway runtime exact authority rejected');
  return true;
}

export function validateGatewayRestoredServiceState({unitExists,enabled,active}={},state={}){
  if(typeof unitExists!=='boolean'||typeof enabled!=='boolean'||typeof active!=='boolean'
    ||unitExists!==(state.previousUnitSha256!==null)||enabled!==state.previousEnabled||active!==state.previousActive)
    fail('gateway rollback service restoration rejected');
  return true;
}

export function encodeGatewayInstallState({sha,unitBackup,previousUnit,installedUnit,previousEnabled=false,previousActive=false}={}){
  validateGatewayReleaseSha(sha);
  if(unitBackup!==null&&(typeof unitBackup!=='string'||!path.isAbsolute(unitBackup)))fail('gateway backup path rejected');
  if(previousUnit!==null&&typeof previousUnit!=='string'&&!Buffer.isBuffer(previousUnit))fail('previous gateway unit rejected');
  if(typeof installedUnit!=='string'||installedUnit.length<1)fail('installed gateway unit rejected');
  if(typeof previousEnabled!=='boolean'||typeof previousActive!=='boolean'||previousUnit===null&&(previousEnabled||previousActive))fail('previous gateway service state rejected');
  return `${JSON.stringify({version:3,sha,unitBackup,previousUnitSha256:previousUnit===null?null:digest(previousUnit),installedUnitSha256:digest(installedUnit),previousEnabled,previousActive})}\n`;
}

export function decodeGatewayInstallState(bytes){
  let value;try{value=JSON.parse(bytes);}catch{fail('gateway installation state rejected');}
  const base=['version','sha','unitBackup','previousUnitSha256','installedUnitSha256','previousEnabled','previousActive'];
  const prepared=value?.version===4;
  if(prepared&&(!/^[a-f0-9]{64}$/.test(value.artifactDigest??'')||!/^[a-f0-9]{64}$/.test(value.configurationSha256??'')||value.mode!=='prepare'||value.previousActive!==false))fail('gateway preparation state rejected');
  if(!exact(value,prepared?[...base,'mode','artifactDigest','configurationSha256']:base)||![3,4].includes(value.version)||!SHA.test(value.sha??'')
    ||value.unitBackup!==null&&(typeof value.unitBackup!=='string'||!path.isAbsolute(value.unitBackup))
    ||value.previousUnitSha256!==null&&!/^[a-f0-9]{64}$/.test(value.previousUnitSha256??'')
    ||!/^[a-f0-9]{64}$/.test(value.installedUnitSha256??'')||typeof value.previousEnabled!=='boolean'||typeof value.previousActive!=='boolean')fail('gateway installation state rejected');
  if((value.unitBackup===null)!==(value.previousUnitSha256===null)
    ||value.previousUnitSha256===null&&(value.previousEnabled||value.previousActive))fail('gateway installation state rejected');
  return Object.freeze(value);
}

export function encodeGatewayPreparedState(input){
 const {artifactDigest,configurationSha256,...base}=input;
 const state={...JSON.parse(encodeGatewayInstallState(base)),version:4,mode:'prepare',artifactDigest,configurationSha256};
 const bytes=JSON.stringify(state)+'\n';decodeGatewayInstallState(bytes);return bytes;
}
export function validateGatewayPreparedObservation(state,{sha,artifactDigest,configurationSha256,installedUnit,backupUnit,enabled,servicesStopped,daemonReloaded}){
 const checked=decodeGatewayInstallState(JSON.stringify(state));
 if(checked.version!==4||checked.sha!==sha||checked.artifactDigest!==artifactDigest||checked.configurationSha256!==configurationSha256
  ||digest(installedUnit)!==checked.installedUnitSha256||enabled!==checked.previousEnabled||servicesStopped!==true||daemonReloaded!==true
  ||(backupUnit===null?null:digest(backupUnit))!==checked.previousUnitSha256)fail('gateway prepared observation rejected');
 return Object.freeze({status:'UNIT_PREPARED',sha,artifactDigest,installedUnitSha256:checked.installedUnitSha256,stateDigest:digest(JSON.stringify(checked)),service:GATEWAY_SERVICE,intakeOpen:false});
}

// The durable rollback state is published before unit replacement. A caller that
// finds that state must select reconciliation, which never sends a second write.
export async function runGatewayUnitPreparation({reconcile=false},{host}){
 if(typeof reconcile!=='boolean'||!host)fail('gateway preparation transaction rejected');
 if(!reconcile){const prepared=await host.prepare();await host.persist(prepared);await host.publish(prepared);await host.reload();}
 return host.inspect();
}
