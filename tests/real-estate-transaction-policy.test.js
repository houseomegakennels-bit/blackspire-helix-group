import test from "node:test";
import assert from "node:assert/strict";

import { evaluateTransactionPolicyCore } from "../frontend/src/lib/real-estate-transaction-policy-core.ts";

test("existing NC transaction path stays available", () => {
  const decision = evaluateTransactionPolicyCore({
    state: "NC",
    action: "send_deal_email",
  });
  assert.equal(decision.allowed, true);
});

test("unresolved jurisdiction fails closed", () => {
  const decision = evaluateTransactionPolicyCore({
    state: null,
    marketKey: "TN:Sullivan",
    transactionReadiness: "blocked",
    action: "generate_contract",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /unresolved/i);
});

test("non-NC jurisdiction without an approved market fails closed", () => {
  const decision = evaluateTransactionPolicyCore({
    state: "TN",
    action: "send_deal_email",
  });
  assert.equal(decision.allowed, false);
  assert.match(decision.reason, /not an approved/i);
});

test("new-state market remains blocked until transaction readiness is ready", () => {
  const blocked = evaluateTransactionPolicyCore({
    state: "TN",
    marketKey: "TN:Sullivan",
    transactionReadiness: "blocked",
    action: "send_deal_email",
  });
  assert.equal(blocked.allowed, false);

  const ready = evaluateTransactionPolicyCore({
    state: "TN",
    marketKey: "TN:Sullivan",
    transactionReadiness: "ready",
    action: "send_deal_email",
  });
  assert.equal(ready.allowed, true);
});
