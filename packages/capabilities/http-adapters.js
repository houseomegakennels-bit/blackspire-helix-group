const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export function createDivisionAdapters(env = process.env, fetchImpl = fetch) {
  return Object.freeze({
    sellerOpportunities: async ({ workspaceId, limit, signal }) => {
      const base = env.BLACKSPIRE_SELLER_CAPABILITY_URL;
      const token = env.BLACKSPIRE_SELLER_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Seller Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/seller-opportunities', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Seller Engine capability transport must use HTTPS or loopback HTTP');
      const response = await fetchImpl(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, limit }),
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Seller Engine capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Seller Engine capability returned malformed JSON'); }
    },
    buyerProfiles: async ({ workspaceId, signal, ...input }) => {
      const base = env.BLACKSPIRE_BUYER_CAPABILITY_URL;
      const token = env.BLACKSPIRE_BUYER_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Buyer Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/buyer-profiles', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Buyer Engine capability transport must use HTTPS or loopback HTTP');
      const response = await fetchImpl(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, ...input }),
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Buyer Engine capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Buyer Engine capability returned malformed JSON'); }
    },
    dealRecords: async ({ workspaceId, limit, signal }) => {
      const base = env.BLACKSPIRE_DEAL_CAPABILITY_URL;
      const token = env.BLACKSPIRE_DEAL_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Deal Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/deal-records', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Deal Engine capability transport must use HTTPS or loopback HTTP');
      const response = await fetchImpl(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, limit }),
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Deal Engine capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Deal Engine capability returned malformed JSON'); }
    },
    dealAnalysis: async ({ workspaceId, dealId, signal }) => {
      const base = env.BLACKSPIRE_DEAL_CAPABILITY_URL;
      const token = env.BLACKSPIRE_DEAL_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Deal Engine capability transport is not configured');
      const url = new URL('/api/internal/capabilities/deal-analysis', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Deal Engine capability transport must use HTTPS or loopback HTTP');
      const response = await fetchImpl(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId, dealId }),
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Deal Engine capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Deal Engine capability returned malformed JSON'); }
    },
    nexusEnrichment: async ({ workspaceId, ownerName, propertyAddress, sellerLeadId, dealId, signal }) => {
      const base = env.BLACKSPIRE_NEXUS_CAPABILITY_URL;
      const token = env.BLACKSPIRE_NEXUS_CAPABILITY_TOKEN;
      if (!base || !token) throw new Error('Nexus capability transport is not configured');
      const url = new URL('/api/internal/capabilities/nexus-enrichment', base);
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) throw new Error('Nexus capability transport must use HTTPS or loopback HTTP');
      const body = { workspaceId };
      if (ownerName) body.ownerName = ownerName;
      if (propertyAddress) body.propertyAddress = propertyAddress;
      if (sellerLeadId) body.sellerLeadId = sellerLeadId;
      if (dealId) body.dealId = dealId;
      const response = await fetchImpl(url, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const text = await readBoundedResponse(response, 32 * 1024);
      if (!response.ok) throw new Error(`Nexus capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Nexus capability returned malformed JSON'); }
    },
  });
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
