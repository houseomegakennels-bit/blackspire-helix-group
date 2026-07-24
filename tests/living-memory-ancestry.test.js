import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-living-memory.sh');

test('living memory: check-living-memory.sh passes on clean reviewed repository ancestry', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-mem-clean-'));
  try {
    spawnSync('git', ['init', '-b', 'main'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

    // Commit 1: base commit
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'base\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SOURCE_OF_TRUTH.md'), `# Source of Truth
- Base \`origin/main\`: \`pending\`
- Last verified implementation commit: \`pending\`
`);
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_ACTIVE_CONTEXT.md'), '# Context\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_NEXT_ACTIONS.md'), '# Next Actions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_DECISIONS.md'), '# Decisions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SESSION_LOG.md'), '# Session Log\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_MEMORY_MAINTENANCE.md'), '# Maintenance\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'base commit'], { cwd: tmpDir, stdio: 'ignore' });

    const c1 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).stdout.trim();

    // Commit 2: reviewed merge commit on main
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'reviewed feature\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SOURCE_OF_TRUTH.md'), `# Source of Truth
- Base \`origin/main\`: \`${c1}\`
- Last verified implementation commit: \`${c1}\`
`);
    spawnSync('git', ['commit', '-am', 'reviewed merge commit'], { cwd: tmpDir, stdio: 'ignore' });

    const result = spawnSync('bash', [scriptPath], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH },
    });
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}\nOutput: ${result.stdout}\nError: ${result.stderr}`);
    assert.match(result.stdout, /canonical memory appears stale: NO/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('living memory: fails closed when recorded_base is a missing commit', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-mem-test-'));
  try {
    spawnSync('git', ['init', '-b', 'main'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SOURCE_OF_TRUTH.md'), `# Source of Truth
- Base \`origin/main\`: \`deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\`
- Last verified implementation commit: \`1111111111111111111111111111111111111111\`
`);
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_ACTIVE_CONTEXT.md'), '# Context\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_NEXT_ACTIONS.md'), '# Next Actions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_DECISIONS.md'), '# Decisions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SESSION_LOG.md'), '# Session Log\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_MEMORY_MAINTENANCE.md'), '# Maintenance\n');

    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'initial'], { cwd: tmpDir, stdio: 'ignore' });

    const result = spawnSync('bash', [scriptPath], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH },
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit code for missing recorded_base');
    assert.match(result.stdout, /canonical memory appears stale: YES/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('living memory: fails closed on unreviewed history divergence', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'living-mem-div-'));
  try {
    spawnSync('git', ['init', '-b', 'main'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'ignore' });

    fs.mkdirSync(path.join(tmpDir, 'docs'), { recursive: true });

    // Commit 1: base commit
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'base\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SOURCE_OF_TRUTH.md'), `# Source of Truth
- Base \`origin/main\`: \`pending\`
- Last verified implementation commit: \`pending\`
`);
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_ACTIVE_CONTEXT.md'), '# Context\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_NEXT_ACTIONS.md'), '# Next Actions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_DECISIONS.md'), '# Decisions\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SESSION_LOG.md'), '# Session Log\n');
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_MEMORY_MAINTENANCE.md'), '# Maintenance\n');
    spawnSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'commit1'], { cwd: tmpDir, stdio: 'ignore' });

    const c1 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).stdout.trim();

    // Commit 2: recorded as last verified and base
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'base2\n');
    spawnSync('git', ['commit', '-am', 'commit2'], { cwd: tmpDir, stdio: 'ignore' });
    const c2 = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir, encoding: 'utf8' }).stdout.trim();

    // Now create a divergent commit from c1 that does not include c2
    spawnSync('git', ['checkout', '-b', 'divergent', c1], { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'file.txt'), 'divergent\n');

    // Update memory docs to record c2 as recorded_base and c1 as last_verified
    fs.writeFileSync(path.join(tmpDir, 'docs', 'BLACKSPIRE_SOURCE_OF_TRUTH.md'), `# Source of Truth
- Base \`origin/main\`: \`${c2}\`
- Last verified implementation commit: \`${c1}\`
`);
    spawnSync('git', ['commit', '-am', 'divergent commit'], { cwd: tmpDir, stdio: 'ignore' });

    const result = spawnSync('bash', [scriptPath], {
      cwd: tmpDir,
      encoding: 'utf8',
      env: { ...process.env, PATH: process.env.PATH },
    });
    assert.notEqual(result.status, 0, 'Expected non-zero exit code for unreviewed history divergence');
    assert.match(result.stdout, /canonical memory appears stale: YES/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
