import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createPublicHealthResponse } from "../src/lib/public-health.mjs";

const GET = createPublicHealthResponse;

const EXPECTED_BODY = {
  ok: true,
  service: "blackspire-public",
  status: "up",
};

test("GET /health returns the exact sanitized public contract", async () => {
  process.env.BLACKSPIRE_HEALTH_TEST_SECRET = "must-not-leak";

  try {
    const response = await GET();

    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type") ?? "",
      /^application\/json\b/i,
    );
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(await response.json(), EXPECTED_BODY);
  } finally {
    delete process.env.BLACKSPIRE_HEALTH_TEST_SECRET;
  }
});

test("GET /health exposes only the approved keys and values", async () => {
  const bodyText = await (await GET()).text();

  assert.equal(
    bodyText,
    '{"ok":true,"service":"blackspire-public","status":"up"}',
  );
  assert.deepEqual(Object.keys(JSON.parse(bodyText)).sort(), [
    "ok",
    "service",
    "status",
  ]);
  assert.doesNotMatch(
    bodyText,
    /secret|token|password|environment|process|task|commit|branch|path|ip|admin|debug|system/i,
  );
});

test("the public route delegates only to the constant response factory", async () => {
  const routeSource = await readFile(
    new URL("../src/app/health/route.js", import.meta.url),
    "utf8",
  );

  assert.equal(
    routeSource,
    'import { createPublicHealthResponse } from "@/lib/public-health.mjs";\n\n' +
      "export function GET() {\n" +
      "  return createPublicHealthResponse();\n" +
      "}\n",
  );
  assert.doesNotMatch(routeSource, /process|env|fetch|headers|cookies|request/i);
});
