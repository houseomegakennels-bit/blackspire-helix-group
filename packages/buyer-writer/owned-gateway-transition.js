import {createHash} from 'node:crypto';
import {BLOCKED_RELEASE} from '../zola-release/retired-release-history.js';
import {validateDatabaseTarget,databaseProfileDigest,validateOwnedDatabaseProfile,LEGACY_DATABASE_HOST} from './database-profile.js';
const fail=()=>{throw new Error('Owned gateway transition rejected');};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function assertOwnedGatewayConfigurationTransition({oldConfiguration:old,newConfiguration:next,ownedProfile,ownedSource,releaseSha,operationId,attemptId}){
 const profile=validateOwnedDatabaseProfile(ownedProfile),source=ownedSource;
 if(old.version!==4||old.mode!=='research-admission'||next.version!==4||next.mode!=='research-admission'
  ||old.authority.releaseSha!==BLOCKED_RELEASE.releaseSha||old.authority.operationId!==BLOCKED_RELEASE.operationId||old.authority.attemptId!==BLOCKED_RELEASE.attemptId
  ||old.runtime.backendProfile!==undefined||old.issuer.backendProfile!==undefined||old.runtime.host!==LEGACY_DATABASE_HOST||old.issuer.host!==LEGACY_DATABASE_HOST
  ||next.workspace!==old.workspace||next.socketPath!==old.socketPath||!source||Object.keys(source).sort().join(',')!=='authority,bindingFile,creatorOid,gatewayCapability,issuer,issuerCredential,runtime,version,workspace,writerCredential'||source.version!==3||source.workspace!==next.workspace
  ||source.authority.releaseSha!==releaseSha||source.authority.operationId!==operationId||source.authority.attemptId!==attemptId
  ||!same(source.authority,next.authority)||next.creatorOid!==profile.creatorOid||source.creatorOid!==profile.creatorOid
  ||next.gatewayCapability!==source.gatewayCapability||next.gatewayCapability===old.gatewayCapability
  ||!same(next.runtime,source.runtime)||!same(next.issuer,source.issuer)
  ||next.runtime.backendProfile!=='owned-postgres-v1'||next.issuer.backendProfile!=='owned-postgres-v1'
  ||next.runtime.profileDigest!==databaseProfileDigest(profile)||next.issuer.profileDigest!==databaseProfileDigest(profile))fail();
 validateDatabaseTarget(next.runtime,{ownedProfile:profile});validateDatabaseTarget(next.issuer,{ownedProfile:profile});
 const fresh=[source.writerCredential,source.issuerCredential,source.gatewayCapability,source.runtime.password,source.issuer.password];
 if(fresh.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(v))||new Set(fresh).size!==5||fresh.some(v=>[old.gatewayCapability,old.runtime.password,old.issuer.password].includes(v)))fail();
 return true;
}
export function assertRetiredGatewaySnapshot({current,state}){
 const digest=createHash('sha256').update(JSON.stringify(current)+'\n').digest('hex');
 if(!state||Object.keys(state).sort().join(',')!=='artifactDigest,attemptId,backupFile,candidateDigest,configurationFile,kind,newConfigDigest,oldConfigDigest,operationId,phase,releaseSha,version'
  ||state.configurationFile!=='/etc/blackspire-buyer-writer-gateway/gateway.json'||state.backupFile!=='/var/lib/blackspire-operator/gateway-configuration-upgrade/'+BLOCKED_RELEASE.operationId+'.backup.json'
  ||['artifactDigest','candidateDigest','newConfigDigest','oldConfigDigest'].some(k=>!/^[a-f0-9]{64}$/.test(state[k]??''))||state.version!==2||state.kind!=='buyer_writer_gateway_configuration_upgrade'||state.phase!=='COMPLETED'
  ||state.releaseSha!==BLOCKED_RELEASE.releaseSha||state.operationId!==BLOCKED_RELEASE.operationId||state.attemptId!==BLOCKED_RELEASE.attemptId||state.newConfigDigest!==digest)fail();
 return true;
}
