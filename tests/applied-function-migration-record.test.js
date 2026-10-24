import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import test from 'node:test';

test('applied function hardening has one byte-exact migration at its recorded production version', () => {
  const record = JSON.parse(readFileSync(new URL('../ops/security/function-hardening-execution-20261024.json', import.meta.url), 'utf8'));
  const directory = new URL('../frontend/supabase/migrations/', import.meta.url);
  const suffix = '_pin_ember_halo_function_search_path.sql';
  assert.equal(record.migration_version, '20261024214440');
  assert.deepEqual(readdirSync(directory).filter(file => file.endsWith(suffix)), [record.migration_version + suffix]);
  assert.equal(existsSync(new URL(record.previous_local_candidate_version + suffix, directory)), false);
  const bytes = readFileSync(new URL(record.migration_version + suffix, directory));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), record.sql_sha256);
  assert.equal(record.sql_sha256, 'd0788ab5ead974ade8e67b70960ba06a15691cf7bd514cd978496595f6eef521');
});
