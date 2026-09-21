import {resolveBuyerStoreApiGroup} from './identity.js';
import {createHash} from 'node:crypto';
import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {validateOwnedPostgresProfile,ownedPostgresProfileDigest} from '../buyer-writer/owned-postgres.js';
import {validateClientConfiguration,exact,fail} from './local-protocol.js';
export const BUYER_STORE_CONFIGURATION='/etc/blackspire-buyer-store/runtime.json';
export const BUYER_STORE_CLIENT_CONFIGURATION='/etc/blackspire/command-buyer-store-client.json';
export function validateBuyerStoreConfiguration(value){
 if(!exact(value,['version','client','profile','ca','repositoryPassword','capabilityPassword','publicKey','operatorOwnerId','ipcGroupId'])||value.version!==1)fail();
 if(!Number.isInteger(value.ipcGroupId)||value.ipcGroupId<=0)fail();
 const client=validateClientConfiguration(value.client),profile=validateOwnedPostgresProfile(value.profile);
 if(ownedPostgresProfileDigest(profile)!==client.profileDigest||typeof value.ca!=='string'||value.ca.length>16384||createHash('sha256').update(value.ca).digest('hex')!==profile.caSha256)fail();
 for(const key of ['repositoryPassword','capabilityPassword'])if(typeof value[key]!=='string'||value[key].length<32||value[key].length>4096||value[key].includes('\0'))fail();
 if(value.repositoryPassword===value.capabilityPassword||[value.repositoryPassword,value.capabilityPassword].includes(client.key)||typeof value.publicKey!=='string'||value.publicKey.length>4096||value.operatorOwnerId!==null&&!/^[a-f0-9-]{36}$/i.test(value.operatorOwnerId))fail();
 return Object.freeze({...value,client,profile});
}
function protectedRead(filename,groupId,readSnapshot){
 const a=readSnapshot(filename,{groupId,maxBytes:32768}),b=readSnapshot(filename,{groupId,maxBytes:32768});
 if(JSON.stringify(a)!==JSON.stringify(b)||a.identity.uid!==0||a.identity.gid!==groupId||(a.identity.mode&0o7777)!==0o640)fail();
 return a.value;
}
export function loadBuyerStoreConfiguration({groupId=process.getgid(),readSnapshot=readRootOwnedJsonSnapshot}={}){
 return validateBuyerStoreConfiguration(protectedRead(BUYER_STORE_CONFIGURATION,groupId,readSnapshot));
}
export function loadBuyerStoreClientConfiguration({groupId=resolveBuyerStoreApiGroup(),readSnapshot=readRootOwnedJsonSnapshot}={}){
 return validateClientConfiguration(protectedRead(BUYER_STORE_CLIENT_CONFIGURATION,groupId,readSnapshot));
}
