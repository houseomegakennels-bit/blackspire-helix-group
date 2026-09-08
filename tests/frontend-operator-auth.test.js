import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(repositoryRoot, 'frontend/src/app/api');
const protectedRoots = [
  'seller-engine',
  'deal-engine',
  'buyer-engine',
];

function routeFiles(relative) {
  const absolute = path.join(apiRoot, relative);
  const stat = fs.statSync(absolute);
  if (stat.isFile()) return [absolute];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(absolute, entry.name);
    return entry.isDirectory() ? routeFiles(path.relative(apiRoot, child)) : entry.name === 'route.ts' ? [child] : [];
  });
}

test('every operator API handler enforces admin authorization before route work', () => {
  const files = protectedRoots.flatMap(routeFiles);
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    assert.match(source, /import \{ guardAdminApi(?:Context)? \} from "@\/lib\/operator-access";/, path.relative(repositoryRoot, file));
    const handlers = [...source.matchAll(/export async function (?:GET|POST|PUT|PATCH|DELETE)\s*\([^]*?\)\s*\{/g)];
    assert.ok(handlers.length > 0, `no route handler found in ${path.relative(repositoryRoot, file)}`);
    for (const handler of handlers) {
      const opening = handler.index + handler[0].length;
      const contextGuard = source.includes('import { guardAdminApiContext }');
      const expected = contextGuard
        ? /const gate = await guardAdminApiContext\(\);\s*if \("response" in gate\) return gate.response;/
        : /const denied = await guardAdminApi\(\);\s*if \(denied\) return denied;/;
      assert.match(source.slice(opening, opening + 180), expected, path.relative(repositoryRoot, file));
    }
  }
});

test('buyer beta surfaces and persisted helper APIs require an authenticated operator', () => {
  for (const relative of ['buyers/layout.tsx', 'searches/layout.tsx']) {
    const source = fs.readFileSync(path.join(repositoryRoot, 'frontend/src/app', relative), 'utf8');
    assert.match(source, /await requireSignedInPage\(\)/, relative);
  }
  for (const relative of ['buyer-reports/route.ts', 'exports/route.ts', 'outreach-drafts/route.ts', 'buyer-summary/route.ts', 'outreach-brief/route.ts']) {
    const source = fs.readFileSync(path.join(apiRoot, relative), 'utf8');
    assert.match(source, /guardSignedInApi\(\)/, relative);
  }
  const jobs = fs.readFileSync(path.join(apiRoot, 'search-jobs/route.ts'), 'utf8');
  assert.match(jobs, /export async function GET[^]*?guardSignedInApi\(\)/);
  assert.match(jobs, /export async function POST[^]*?guardBetaAction\("sweep"\)/);
});

test('global search remains admin-only and direct Nexus trace is retired', () => {
  const search = fs.readFileSync(path.join(apiRoot, 'search/route.ts'), 'utf8');
  const nexus = fs.readFileSync(path.join(apiRoot, 'nexus/trace/route.ts'), 'utf8');
  assert.match(search, /export async function GET[^]*?guardAdminApi\(\)/);
  assert.doesNotMatch(search, /select\([^)]*(?:primary_phone|primary_email)/);
  assert.match(nexus, /export async function POST[^]*?guardAdminApi\(\)[^]*?status: 410/);
  assert.doesNotMatch(nexus, /runNexusSkipTrace|getNexusSnapshot/);
});
