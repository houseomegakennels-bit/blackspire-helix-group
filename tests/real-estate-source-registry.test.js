import test from "node:test";
import assert from "node:assert/strict";

import {
  REAL_ESTATE_SOURCE_CANDIDATES,
  listProductionEnabledRealEstateSources,
} from "../frontend/src/lib/real-estate-source-registry.ts";

test("new-state source candidates are state-qualified and unique", () => {
  const ids = REAL_ESTATE_SOURCE_CANDIDATES.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(REAL_ESTATE_SOURCE_CANDIDATES.every((source) => ["VA", "SC", "TN"].includes(source.state)));
});

test("research sources cannot become production connectors by existing in the registry", () => {
  assert.deepEqual(listProductionEnabledRealEstateSources(), []);
  assert.ok(REAL_ESTATE_SOURCE_CANDIDATES.every((source) => source.productionEnabled === false));
});

test("stale Danville sales lane remains explicitly blocked", () => {
  const sales = REAL_ESTATE_SOURCE_CANDIDATES.find((source) => source.id === "va-danville-sales");
  assert.equal(sales?.status, "blocked");
  assert.equal(sales?.productionEnabled, false);
});
