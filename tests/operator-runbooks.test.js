import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const runbooks = [
  'docs/PRODUCTION_READINESS_PLAN.md',
  'docs/STAGING_DEPLOYMENT_RUNBOOK.md',
  'docs/PRODUCTION_DEPLOYMENT_RUNBOOK.md',
  'docs/ROLLBACK_AND_RECOVERY_RUNBOOK.md',
  'docs/TELEGRAM_OPERATOR_RUNBOOK.md',
  'docs/INCIDENT_RESPONSE_RUNBOOK.md',
];

test('production operator runbooks exist and label authorization boundaries', () => {
  for (const file of runbooks) {
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /REQUIRES OPERATOR AUTHORIZATION|operator authorization/i, file);
    assert.doesNotMatch(content, /TELEGRAM_BOT_TOKEN=\S+|COMMAND_ADMIN_TOKEN=\S+|SESSION_SECRET=\S+/, file);
  }
});

test('every package command documented by the operator runbooks exists', () => {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const content = runbooks.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const command of content.matchAll(/npm run ([a-z0-9:-]+)/g)) {
    assert.ok(pkg.scripts[command[1]], `missing package script documented as npm run ${command[1]}`);
  }
});

test('every repository script explicitly documented by the operator runbooks exists', () => {
  const content = runbooks.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
  for (const match of content.matchAll(/(?:bash|node) (scripts\/[a-zA-Z0-9._/-]+)/g)) {
    assert.ok(fs.statSync(match[1]).isFile(), `missing documented tool ${match[1]}`);
  }
});

