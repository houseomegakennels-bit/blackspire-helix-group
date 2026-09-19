import crypto from 'node:crypto';
export const RECEIVER_AUTHORITY_HEADER='x-blackspire-receiver-authority';
export const RECEIVER_AUTHORITY_REQUIRED=Symbol.for('blackspire.receiver-authority-required');
const routes={'seller.opportunities.search':'/api/internal/capabilities/seller-opportunities','buyer.profiles.search':'/api/internal/capabilities/buyer-profiles','buyer.matches.search':'/api/internal/capabilities/buyer-profiles','deal.records.search':'/api/internal/capabilities/deal-records','deal.analysis.get':'/api/internal/capabilities/deal-analysis','nexus.enrichment.status':'/api/internal/capabilities/nexus-enrichment'};
const permissions={'seller.opportunities.search':'seller.opportunities.read','buyer.profiles.search':'buyer.profiles.read','buyer.matches.search':'buyer.matches.read','deal.records.search':'deal.records.read','deal.analysis.get':'deal.analysis.read','nexus.enrichment.status':'nexus.enrichment.read'};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const fail=()=>{throw new Error('Receiver authority refused');};
const persistedKeys=['version','releaseSha','releaseRunId','apiGeneration','workerGeneration','workspaceId','principalId','principalSecurityVersion','grantId','grantVersion','grantSecurityVersion','capabilityId','permission','taskId','attemptId','workerId','claimDigest','method','path','bodySha256','issuedAt','expiresAt','proofDigest'];
export function receiverRequest(capabilityId,workspaceId,input){
 if(!routes[capabilityId]||!input||typeof input!=='object'||Array.isArray(input))fail();const body={workspaceId};
 if(capabilityId==='seller.opportunities.search'||capabilityId==='deal.records.search')body.limit=input.limit;
 else if(capabilityId==='deal.analysis.get')body.dealId=input.dealId;
 else if(capabilityId==='nexus.enrichment.status'){for(const key of ['ownerName','propertyAddress','sellerLeadId','dealId'])if(input[key])body[key]=input[key];}
 else{Object.assign(body,input);if(capabilityId==='buyer.matches.search')body.matchesOnly=true;}
 const bodyBytes=JSON.stringify(body);return Object.freeze({method:'POST',path:routes[capabilityId],body,bodyBytes,bodySha256:hash(bodyBytes)});
}
export function receiverAuthorityBindingDigest(value){
 if(!value||typeof value!=='object'||typeof value.proof!=='string'||value.permission!==permissions[value.capabilityId]||value.path!==routes[value.capabilityId])fail();
 const {proof,...claims}=value;return hash(JSON.stringify({...claims,proofDigest:hash(proof)}));
}
export function persistedReceiverAuthorityBindingDigest(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...persistedKeys].sort().join(',')||value.version!==1
  ||!/^[a-f0-9]{40}$/.test(value.releaseSha??'')||!/^[-A-Za-z0-9._:]{1,256}$/.test(value.releaseRunId??'')
  ||![value.apiGeneration,value.workerGeneration].every(v=>/^[a-f0-9]{32}$/.test(v??''))
  ||!['workspaceId','principalId','grantId','capabilityId','permission','taskId','attemptId','workerId'].every(k=>/^[A-Za-z0-9._:-]{1,256}$/.test(value[k]??''))
  ||![value.principalSecurityVersion,value.grantVersion,value.grantSecurityVersion].every(n=>Number.isSafeInteger(n)&&n>=1)
  ||value.permission!==permissions[value.capabilityId]||value.method!=='POST'||value.path!==routes[value.capabilityId]
  ||![value.claimDigest,value.bodySha256,value.proofDigest].every(v=>/^[a-f0-9]{64}$/.test(v??''))
  ||!Number.isSafeInteger(value.issuedAt)||!Number.isSafeInteger(value.expiresAt)||value.expiresAt-value.issuedAt!==15000)fail();
 return hash(JSON.stringify(value));
}
