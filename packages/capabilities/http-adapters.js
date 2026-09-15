import { decodeObservedResponse } from './read-observation.js';
import {RECEIVER_AUTHORITY_HEADER,RECEIVER_AUTHORITY_REQUIRED,receiverAuthorityBindingDigest,receiverRequest as authorityRequest} from './receiver-authority-contract.js';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function createDivisionAdapters(env = process.env, fetchImpl = fetch) {
  const adapters={
    sellerOpportunities: async ({ workspaceId, limit, signal, receiverAuthority, receiverRequest }) => {
      const base = env.BLACKSPIRE_SELLER_CAPABILITY_URL;
      const token = env.BLACKSPIRE_SELLER_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Seller Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/seller-opportunities', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Seller Engine capability transport must use HTTPS or loopback HTTP');
      const request=boundRequest('seller.opportunities.search',workspaceId,{limit},receiverAuthority,receiverRequest);
      const response = await fetchImpl(url, {
        method: 'POST', signal, redirect: 'error',
        headers: authorityHeaders(token,receiverAuthority),body:request.bodyBytes,
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Seller Engine capability failed with HTTP ${response.status}`);
      try { return decodeObservedResponse(text, response, url.pathname,receiverAuthorityBindingDigest(receiverAuthority)); } catch { throw new Error('Seller Engine capability returned malformed JSON'); }
    },
    buyerProfiles: async ({ workspaceId, signal, receiverAuthority, receiverRequest, ...input }) => {
      const base = env.BLACKSPIRE_BUYER_CAPABILITY_URL;
      const token = env.BLACKSPIRE_BUYER_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Buyer Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/buyer-profiles', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Buyer Engine capability transport must use HTTPS or loopback HTTP');
      const capabilityId=input.matchesOnly===true?'buyer.matches.search':'buyer.profiles.search';
      const request=boundRequest(capabilityId,workspaceId,input,receiverAuthority,receiverRequest);
      const response = await fetchImpl(url, {
        method: 'POST', signal, redirect: 'error',
        headers: authorityHeaders(token,receiverAuthority),body:request.bodyBytes,
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Buyer Engine capability failed with HTTP ${response.status}`);
      try { return decodeObservedResponse(text, response, url.pathname,receiverAuthorityBindingDigest(receiverAuthority)); } catch { throw new Error('Buyer Engine capability returned malformed JSON'); }
    },
    dealRecords: async ({ workspaceId, limit, signal, receiverAuthority, receiverRequest }) => {
      const base = env.BLACKSPIRE_DEAL_CAPABILITY_URL;
      const token = env.BLACKSPIRE_DEAL_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Deal Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/deal-records', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Deal Engine capability transport must use HTTPS or loopback HTTP');
      const request=boundRequest('deal.records.search',workspaceId,{limit},receiverAuthority,receiverRequest);
      const response = await fetchImpl(url, {
        method: 'POST', signal, redirect: 'error',
        headers: authorityHeaders(token,receiverAuthority),body:request.bodyBytes,
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Deal Engine capability failed with HTTP ${response.status}`);
      try { return decodeObservedResponse(text, response, url.pathname,receiverAuthorityBindingDigest(receiverAuthority)); } catch { throw new Error('Deal Engine capability returned malformed JSON'); }
    },
    dealAnalysis: async ({ workspaceId, dealId, signal, receiverAuthority, receiverRequest }) => {
      const base = env.BLACKSPIRE_DEAL_CAPABILITY_URL;
      const token = env.BLACKSPIRE_DEAL_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Deal Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/deal-analysis', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Deal Engine capability transport must use HTTPS or loopback HTTP');
      const request=boundRequest('deal.analysis.get',workspaceId,{dealId},receiverAuthority,receiverRequest);
      const response = await fetchImpl(url, {
        method: 'POST', signal, redirect: 'error',
        headers: authorityHeaders(token,receiverAuthority),body:request.bodyBytes,
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Deal Engine capability failed with HTTP ${response.status}`);
      try { return decodeObservedResponse(text, response, url.pathname,receiverAuthorityBindingDigest(receiverAuthority)); } catch { throw new Error('Deal Engine capability returned malformed JSON'); }
    },
    nexusEnrichment: async ({ workspaceId, ownerName, propertyAddress, sellerLeadId, dealId, signal, receiverAuthority, receiverRequest }) => {
      const base = env.BLACKSPIRE_NEXUS_CAPABILITY_URL;
      const token = env.BLACKSPIRE_NEXUS_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Nexus capability transport is not configured');
      const url = new URL('/api/internal/capabilities/nexus-enrichment', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Nexus capability transport must use HTTPS or loopback HTTP');
      const input={ownerName,propertyAddress,sellerLeadId,dealId};
      const request=boundRequest('nexus.enrichment.status',workspaceId,input,receiverAuthority,receiverRequest);
      const response = await fetchImpl(url, {
        method: 'POST', signal, redirect: 'error',
        headers: authorityHeaders(token,receiverAuthority),body:request.bodyBytes,
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Nexus capability failed with HTTP ${response.status}`);
      try { return decodeObservedResponse(text, response, url.pathname,receiverAuthorityBindingDigest(receiverAuthority)); } catch { throw new Error('Nexus capability returned malformed JSON'); }
    },
  };
  Object.defineProperty(adapters,RECEIVER_AUTHORITY_REQUIRED,{value:true,enumerable:false});
  return Object.freeze(adapters);
}

function boundRequest(capabilityId,workspaceId,input,envelope,prepared){
  const request=authorityRequest(capabilityId,workspaceId,input);
  if(!envelope||!prepared||prepared.method!==request.method||prepared.path!==request.path||prepared.bodyBytes!==request.bodyBytes
    ||prepared.bodySha256!==request.bodySha256||envelope.capabilityId!==capabilityId||envelope.bodySha256!==request.bodySha256)throw new Error('Capability receiver authority is unavailable');
  return request;
}
function authorityHeaders(token,envelope){
  const encoded=Buffer.from(JSON.stringify(envelope)).toString('base64url');
  if(encoded.length>8192)throw new Error('Capability receiver authority is unavailable');
  return {'content-type':'application/json',authorization:`Bearer ${token}`,[RECEIVER_AUTHORITY_HEADER]:encoded};
}

async function readBoundedResponse(response, maxBytes, transportName = 'Seller Engine capability') {
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error(`${transportName} response too large`);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel('response too large');
        throw new Error(`${transportName} response too large`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw new Error(`${transportName} returned malformed UTF-8`); }
}
