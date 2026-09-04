import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { createDivisionAdapters } from '../packages/capabilities/http-adapters.js';

const routeSource = fs.readFileSync(new URL('../frontend/src/app/api/internal/capabilities/buyer-profiles/route.ts', import.meta.url), 'utf8');
const dealRouteSource = fs.readFileSync(new URL('../frontend/src/app/api/internal/capabilities/deal-analysis/route.ts', import.meta.url), 'utf8');

test('Buyer internal endpoint is server-only, authorized, bounded, and read-only', () => {
  assert.match(routeSource, /import "server-only"/);
  assert.match(routeSource, /authorizeInternalCapability\(request, input\.workspaceId\)/);
  assert.match(routeSource, /limit < 1 \|\| limit > 10/);
  assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(routeSource, /primary_phone|primary_email|mailing_address_snapshot/);
  assert.match(routeSource, /\.from\("deal_leads"\)[\s\S]*\.eq\("id", opportunityId\.toUpperCase\(\)\)[\s\S]*\.limit\(1\)/);
  assert.match(routeSource, /matchBuyersForProperty/);
});

test('Deal analysis capability disables UI scaffold persistence on its read path', () => {
  assert.match(dealRouteSource, /getDealEngineDealDetail\(dealId, \{ persistScaffold: false \}\)/);
});

test('Buyer adapter preserves bounded profile and match inputs over HTTP', async () => {
  const bodies = [];
  const fetchImpl = async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ profiles: [], matches: [], sourceSnapshotAt: new Date().toISOString() }));
  };
  const adapter = createDivisionAdapters({ BLACKSPIRE_BUYER_CAPABILITY_URL: 'https://buyer.example', BLACKSPIRE_BUYER_CAPABILITY_TOKEN: 'x' }, fetchImpl).buyerProfiles;
  await adapter({ workspaceId: 'ws', county: 'Forsyth', limit: 4, signal: null });
  await adapter({ workspaceId: 'ws', opportunityId: 'DE-2417', matchesOnly: true, limit: 3, signal: null });
  assert.deepEqual(bodies, [
    { workspaceId: 'ws', county: 'Forsyth', limit: 4 },
    { workspaceId: 'ws', opportunityId: 'DE-2417', matchesOnly: true, limit: 3 },
  ]);
});
