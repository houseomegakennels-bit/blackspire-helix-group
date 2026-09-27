import test from "node:test";
import assert from "node:assert/strict";

import { evaluateRealEstateTransactionPolicy } from "../frontend/src/lib/real-estate-transaction-policy.ts";

test("existing NC transaction path stays available", () => {
  const decision = evaluateRealEstateTransactionPolicy({
    state: "NC",
    county: "Forsyth",
    action: "send_deal_email",
  });
  assert.equal(decision.allowed, true);
});

test("unresolved jurisdiction fails closed", () => {
  const decision = evaluateRealEstateTransactionPolicy({
    state: null,
    county: "Sullivan",
    action: "generate_contract",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /unresolved/i);
});

test("VA SC and TN pilots stay blocked until transaction readiness is promoted", () => {
  for (const input of [
    { state: "TN", county: "Sullivan" },
    { state: "VA", county: "Pittsylvania" },
    { state: "VA", city: "Danville" },
    { state: "SC", county: "York" },
  ]) {
    const decision = evaluateRealEstateTransactionPolicy({
      ...input,
      action: "send_deal_email",
    });
    assert.equal(decision.allowed, false);
  }
});
