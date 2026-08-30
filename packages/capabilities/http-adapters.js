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
      const text = await response.text();
      if (Buffer.byteLength(text) > 32 * 1024) throw new Error('Seller Engine capability response too large');
      if (!response.ok) throw new Error(`Seller Engine capability failed with HTTP ${response.status}`);
      try { return JSON.parse(text); } catch { throw new Error('Seller Engine capability returned malformed JSON'); }
    },
  });
}
