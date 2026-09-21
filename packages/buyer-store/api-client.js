import {readRootOwnedJsonSnapshot} from '../buyer-writer/protected-json.js';
import {currentReleaseAdmissionContext} from '../shared/release-admission.js';
import {loadBuyerStoreClientConfiguration} from './configuration.js';
import {validateClientConfiguration} from './local-protocol.js';
import {resolveBuyerStoreApiGroup} from './identity.js';
import {createBuyerStoreLocalClient} from './local-client.js';
import {readConsumedBuyerData} from './capability.js';
import {createBuyerDealContextClient,validateBuyerDealContextClientConfiguration} from './deal-context-client.js';
const FILE='/etc/blackspire/command-buyer-deal-context.json';
const fail=()=>{throw new Error('Buyer store API unavailable');};
export function createBuyerStoreApiClient({clientConfiguration,dealConfiguration,context=currentReleaseAdmissionContext,localClient,lookupDeal}){
 clientConfiguration=validateClientConfiguration(clientConfiguration);
 const deal=validateBuyerDealContextClientConfiguration(dealConfiguration);
 if(clientConfiguration.releaseSha!==deal.releaseSha)fail();
 const client=localClient??createBuyerStoreLocalClient({configuration:clientConfiguration});
 const lookup=lookupDeal??createBuyerDealContextClient({configuration:deal});
 const verify=()=>{const active=context();if(active.role!=='api'||active.releaseSha!==clientConfiguration.releaseSha)fail();};
 return Object.freeze({
  backendProfile:clientConfiguration.backendProfile,profileDigest:clientConfiguration.profileDigest,
  async userRequest(value){verify();const result=await client.userRequest(value);verify();return result;},
  async readConsumedBuyerData(value){verify();const result=await readConsumedBuyerData(value,{repository:client,lookupDeal:lookup});verify();return result;},
  async checkAvailability(){verify();if(typeof client.checkAvailability!=='function')fail();const result=await client.checkAvailability();verify();return result;},
 });
}
export function loadBuyerStoreApiClient({releaseSha,groupId=resolveBuyerStoreApiGroup(),readSnapshot=readRootOwnedJsonSnapshot}={}){
 const clientConfiguration=loadBuyerStoreClientConfiguration({groupId,readSnapshot});
 const first=readSnapshot(FILE,{groupId,maxBytes:16384}),second=readSnapshot(FILE,{groupId,maxBytes:16384});
 if(JSON.stringify(first)!==JSON.stringify(second)||first.identity.uid!==0||first.identity.gid!==groupId
  ||(first.identity.mode&0o7777)!==0o640||clientConfiguration.releaseSha!==releaseSha)fail();
 return createBuyerStoreApiClient({clientConfiguration,dealConfiguration:first.value});
}
