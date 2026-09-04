import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { nexusEnrichmentCapability } from '../packages/capabilities/nexus-enrichment.js';
import { validateCapabilityOutput } from '../packages/capabilities/contract.js';

const routeSource = fs.readFileSync(
  new URL('../frontend/src/app/api/internal/capabilities/nexus-enrichment/route.ts', import.meta.url),
  'utf8',
);
const migrationSource = fs.readFileSync(
  new URL('../frontend/supabase/migrations/011_nexus_read_security.sql', import.meta.url),
  'utf8',
);

test('canonical Nexus not-found result validates with every persisted field absent', () => {
  const result = validateCapabilityOutput(nexusEnrichmentCapability, {
    ownerName: null,
    propertyAddress: null,
    skipTraceStatus: null,
    phoneStatus: null,
    contactConfidenceScore: null,
    provider: null,
    source: null,
    updatedAt: null,
    sourceSnapshotAt: '2026-09-04T00:00:00.000Z',
  });

  assert.equal(result.ownerName, null);
  assert.equal(result.skipTraceStatus, null);
});

test('Nexus endpoint performs one bounded deterministic persisted read with phone presence only', () => {
  assert.match(routeSource, /\.select\("id,seller_lead_id,owner_name,property_address,primary_phone,contact_confidence_score,provider,status,updated_at"\)/);
  assert.match(routeSource, /\.eq\("seller_lead_id", args\.sellerLeadId\)/);
  assert.match(routeSource, /\.ilike\("owner_name", exactIlike\(args\.ownerName\)\)/);
  assert.match(routeSource, /\.ilike\("property_address", exactIlike\(args\.propertyAddress\)\)/);
  assert.match(routeSource, /\.order\("updated_at", \{ ascending: false \}\)\s*\.order\("id", \{ ascending: false \}\)/);
  assert.match(routeSource, /query\.limit\(1\)\.maybeSingle\(\)/);
  assert.doesNotMatch(routeSource, /\.limit\(500\)/);
  assert.doesNotMatch(routeSource, /primary_email|raw_response|raw_skiptrace_response/);
  assert.doesNotMatch(routeSource, /\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.doesNotMatch(routeSource, /tracerfy|fetch\(/i);
});

test('Nexus migration removes browser-role policy and table grants', () => {
  assert.match(migrationSource, /drop policy if exists "nexus_contacts_authenticated_all" on public\.nexus_contacts/i);
  assert.match(migrationSource, /revoke all privileges on table public\.nexus_contacts from anon/i);
  assert.match(migrationSource, /revoke all privileges on table public\.nexus_contacts from authenticated/i);
  assert.doesNotMatch(migrationSource, /create policy/i);
});
