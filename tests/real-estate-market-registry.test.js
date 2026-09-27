import test from "node:test";
import assert from "node:assert/strict";

import {
  REAL_ESTATE_PILOT_MARKETS,
  canRunRealEstateTransactionActions,
  getRealEstateMarketProfile,
} from "../frontend/src/lib/real-estate-market-registry.ts";

test("pilot registry uses state-qualified unique market keys", () => {
  const keys = REAL_ESTATE_PILOT_MARKETS.map((market) => market.key);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(keys.includes("VA:Danville"));
  assert.ok(keys.includes("TN:Sullivan"));
  assert.ok(keys.includes("SC:York"));
});

test("all new-state pilot markets start transaction-blocked", () => {
  for (const market of REAL_ESTATE_PILOT_MARKETS) {
    assert.equal(market.transactionReadiness, "blocked");
    assert.equal(canRunRealEstateTransactionActions(market), false);
  }
});

test("market lookup distinguishes state and jurisdiction names", () => {
  assert.equal(getRealEstateMarketProfile("VA", "Danville")?.jurisdictionType, "independent_city");
  assert.equal(getRealEstateMarketProfile("TN", "Sullivan")?.state, "TN");
  assert.equal(getRealEstateMarketProfile("NC", "Sullivan"), null);
});
