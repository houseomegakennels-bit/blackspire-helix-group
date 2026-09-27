import test from "node:test";
import assert from "node:assert/strict";

import {
  inferCountyFromCity,
  inferNcCountyFromCity,
  normalizeUsStateCode,
} from "../frontend/src/lib/real-estate-jurisdiction.ts";

test("normalizes valid US state codes without inventing a default", () => {
  assert.equal(normalizeUsStateCode(" nc "), "NC");
  assert.equal(normalizeUsStateCode("Virginia"), "");
  assert.equal(normalizeUsStateCode(null), "");
});

test("NC city inference is explicit and state-scoped", () => {
  assert.equal(inferNcCountyFromCity("Greenville"), "Pitt");
  assert.equal(inferCountyFromCity("NC", "Greenville"), "Pitt");
  assert.equal(inferCountyFromCity("SC", "Greenville"), null);
  assert.equal(inferCountyFromCity("VA", "Durham"), null);
  assert.equal(inferCountyFromCity("TN", "Charlotte"), null);
});

test("unknown or missing jurisdictions stay unresolved", () => {
  assert.equal(inferCountyFromCity("", "Greenville"), null);
  assert.equal(inferCountyFromCity("SC", ""), null);
  assert.equal(inferCountyFromCity("ZZ", "Greenville"), null);
});
