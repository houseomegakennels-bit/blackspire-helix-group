import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cwd = new URL('..', import.meta.url).pathname;
const baseEnv = { PATH: process.env.PATH, HOME: '/tmp' };

function verify(profile, env = {}) {
  return spawnSync('bash', ['scripts/verify-environment.sh', profile], {
    cwd,
    encoding: 'utf8',
    env: { ...baseEnv, ...env }
  });
}

test('environment profiles fail closed and do not disclose credential values', () => {
  assert.equal(verify('development', { BLACKSPIRE_PROVIDER_MODE: 'manual' }).status, 0);

  const iphone = verify('iphone-test', {
    NODE_ENV: 'test',
    BLACKSPIRE_PROVIDER_MODE: 'mock',
    UNIFIED_IPHONE_TEST_MODE: 'true',
    UNIFIED_TEST_ACCESS_CODE: 'disposable-code-only',
    HERMES_TEST_PROVIDER: 'mock',
    TELEGRAM_MODE: 'mock',
    BLACKSPIRE_DB_PATH: '/tmp/blackspire-readiness.sqlite'
  });
  assert.equal(iphone.status, 0, iphone.stderr);

  const marker = 'credential-value-must-not-appear';
  const codespace = verify('codespace', {
    CODESPACES: 'true',
    BLACKSPIRE_PROVIDER_MODE: 'manual',
    OPENAI_API_KEY: marker
  });
  assert.notEqual(codespace.status, 0);
  assert.doesNotMatch(`${codespace.stdout}${codespace.stderr}`, new RegExp(marker));

  const production = verify('vps-production', {
    NODE_ENV: 'production',
    BLACKSPIRE_STATE_OWNER: 'vps-production',
    BLACKSPIRE_PROVIDER_MODE: 'mock',
    BLACKSPIRE_DB_PATH: '/tmp/not-production.sqlite',
    COMMAND_ADMIN_TOKEN: 'not-a-real-token',
    SESSION_SECRET: 'not-a-real-secret'
  });
  assert.notEqual(production.status, 0);
});

test('runtime scripts are syntactically valid and devcontainer exposes only the test port', async () => {
  const scripts = [
    'bootstrap-development.sh',
    'bootstrap-codespace.sh',
    'codespace-readiness-check.sh',
    'health-check.sh',
    'start-iphone-test.sh',
    'start-production.sh',
    'stop-iphone-test.sh',
    'verify-environment.sh'
  ];
  for (const script of scripts) {
    const result = spawnSync('bash', ['-n', `scripts/${script}`], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${script}: ${result.stderr}`);
  }

  const devcontainer = JSON.parse(await readFile(new URL('../.devcontainer/devcontainer.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(devcontainer.portsAttributes), ['8790']);
  assert.equal(devcontainer.portsAttributes['8790'].visibility, 'private');
  assert.equal(devcontainer.otherPortsAttributes.onAutoForward, 'ignore');
  assert.equal(JSON.stringify(devcontainer).includes('TOKEN'), false);
});
