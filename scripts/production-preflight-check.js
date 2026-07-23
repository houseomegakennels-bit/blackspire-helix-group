#!/usr/bin/env node
// Deterministic, read-only Gate 4 production preflight.
//
// Reports pass/fail for the complete source-controlled production activation contract in one
// command, so activation blockers are found together instead of one per attempt. It is strictly
// read-only: it never starts, stops, reloads, enables, installs, migrates, binds, or modifies
// anything, and it prints no secret values — only key names, file modes, and structural facts.
//
// Findings are split into two classes:
//   source     - defects in this repository. These fail the contract and exit nonzero.
//   deployment - host state that the activation runbook is responsible for, such as an installed
//                unit that is stale relative to the reviewed template. These are reported, and
//                only fail the run under --strict, because they are follow-ups rather than
//                source defects.
//
// Usage: node scripts/production-preflight-check.js [--json] [--strict]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROTECTED_PORTS, PRODUCTION_BIND_HOST, PRODUCTION_PORT_CANDIDATES } from '../packages/shared/bind.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asJson = process.argv.includes('--json');
const strict = process.argv.includes('--strict');

const UNIT_PATH = 'ops/runtime-ownership/blackspire-command.service';
const INSTALLED_UNIT_PATH = '/etc/systemd/system/blackspire-command.service';
const NODE_BIN_LIB = 'scripts/lib/node-bin.sh';

// Every shell script that can run on the production startup, health, or ownership path. Each must
// resolve its interpreter through the shared resolver rather than through PATH.
const PRODUCTION_PATH_SCRIPTS = [
  'scripts/verify-environment.sh',
  'scripts/start-production.sh',
  'scripts/health-check.sh',
  'ops/blackspire-command-healthcheck.sh',
  'ops/runtime-ownership/verify-ownership.sh',
];

// Tooling the activation and rollback runbook depends on existing in the artifact.
const REQUIRED_TOOLING = [
  'scripts/migrate.js',
  'scripts/backup.js',
  'scripts/restore.js',
  'scripts/release-create.sh',
  'scripts/release-switch.sh',
  'scripts/release-rollback.sh',
  'scripts/release-preflight.sh',
  'scripts/release-tree-validator.sh',
  'scripts/verify-environment.sh',
  'scripts/production-supervisor.js',
  'ops/blackspire-command-healthcheck.sh',
  'ops/blackspire-command-logrotate.conf',
  'ops/reverse-proxy/blackspire-command.nginx.conf',
  'ops/runtime-ownership/OWNERSHIP_MAP.md',
];

const findings = [];
const record = (id, ok, klass, detail) => findings.push({ id, ok, class: klass, detail });

const read = (relative) => {
  try {
    return fs.readFileSync(path.join(rootDirectory, relative), 'utf8');
  } catch {
    return null;
  }
};

// --- Node interpreter contract -------------------------------------------------------------

const pinnedNodeVersion = (read('.node-version') || '').trim();
{
  const [major, minor] = pinnedNodeVersion.split('.').map(Number);
  const satisfies = Number.isInteger(major) && (major > 22 || (major === 22 && minor >= 5));
  record('node-floor', satisfies, 'source',
    satisfies ? `.node-version ${pinnedNodeVersion} provides node:sqlite`
      : `.node-version ${pinnedNodeVersion || '(missing)'} does not reach the node:sqlite floor of 22.5`);
}

const unit = read(UNIT_PATH);
if (unit === null) {
  record('unit-present', false, 'source', `${UNIT_PATH} is missing`);
} else {
  record('unit-present', true, 'source', `${UNIT_PATH} present`);

  const execStart = unit.match(/^ExecStart=(\S+)/m);
  const interpreter = execStart ? execStart[1] : null;
  const execStartPinned = Boolean(interpreter)
    && interpreter.startsWith('/')
    && interpreter !== '/usr/bin/node'
    && !/^\/usr\/bin\/env$/.test(interpreter)
    && interpreter.includes(pinnedNodeVersion);
  record('unit-execstart-pinned', execStartPinned, 'source',
    execStartPinned ? `ExecStart pins ${interpreter}`
      : `ExecStart must name an absolute Node ${pinnedNodeVersion} interpreter, got ${interpreter ?? '(missing)'}`);

  // ExecStartPre may legitimately run bash, but nothing on the startup path may resolve node
  // through an unpinned PATH, so a pinned Environment=PATH is required alongside it.
  const pathLine = unit.match(/^Environment=PATH=(\S+)/m);
  const pathValue = pathLine ? pathLine[1] : null;
  const nodeDirectory = interpreter ? path.dirname(interpreter) : null;
  const pathPinned = Boolean(pathValue) && Boolean(nodeDirectory) && pathValue.split(':')[0] === nodeDirectory;
  record('unit-path-pinned', pathPinned, 'source',
    pathPinned ? `Environment=PATH leads with ${nodeDirectory}`
      : 'Environment=PATH must lead with the pinned Node interpreter directory so no helper resolves /usr/bin/node');

  const execStartPre = /^ExecStartPre=.*verify-environment\.sh vps-production/m.test(unit);
  record('unit-execstartpre', execStartPre, 'source',
    execStartPre ? 'ExecStartPre runs the vps-production environment verification'
      : 'ExecStartPre must run scripts/verify-environment.sh vps-production');

  const hardening = ['User=blackspire', 'Group=blackspire', 'NoNewPrivileges=yes', 'ProtectSystem=strict',
    'ProtectHome=yes', 'PrivateTmp=yes', 'RestrictSUIDSGID=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities='];
  const missingHardening = hardening.filter((directive) => !unit.includes(directive));
  record('unit-hardening', missingHardening.length === 0, 'source',
    missingHardening.length === 0 ? 'least-privilege and sandboxing directives present'
      : `missing hardening directives: ${missingHardening.join(', ')}`);

  const workdir = /^WorkingDirectory=\/opt\/blackspire-command\/current$/m.test(unit);
  record('unit-workingdirectory', workdir, 'source',
    workdir ? 'WorkingDirectory is the current symlink, so the switch must precede systemctl start'
      : 'WorkingDirectory must be /opt/blackspire-command/current');

  const startLimit = /StartLimitBurst=\d+/.test(unit) && /StartLimitIntervalSec=\d+/.test(unit);
  record('unit-restart-cap', startLimit, 'source',
    startLimit ? 'restart storm cap present' : 'StartLimitIntervalSec/StartLimitBurst must cap restart storms');
}

// --- Startup-path interpreter resolution ----------------------------------------------------

{
  const libPresent = read(NODE_BIN_LIB) !== null;
  record('node-resolver-present', libPresent, 'source',
    libPresent ? `${NODE_BIN_LIB} present` : `${NODE_BIN_LIB} is missing`);

  const offenders = [];
  for (const relative of PRODUCTION_PATH_SCRIPTS) {
    const body = read(relative);
    if (body === null) { offenders.push(`${relative} (missing)`); continue; }
    if (!body.includes('node-bin.sh')) { offenders.push(`${relative} (does not source the resolver)`); continue; }
    // A bare `node ` invocation not preceded by $ or / means PATH resolution.
    const lines = body.split('\n');
    lines.forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      if (/(^|[^\w./$"'-])node\s+(-|--|<|scripts\/|apps\/)/.test(line)) {
        offenders.push(`${relative}:${index + 1} resolves node through PATH`);
      }
    });
  }
  record('startup-scripts-pinned', offenders.length === 0, 'source',
    offenders.length === 0 ? `${PRODUCTION_PATH_SCRIPTS.length} production-path scripts resolve Node deterministically`
      : offenders.join('; '));
}

// --- Bind, port, and proxy contract ---------------------------------------------------------

{
  const profile = read('scripts/production-profile.env.example') || '';
  const host = profile.match(/^BIND_HOST=(.*)$/m);
  const port = profile.match(/^PORT=(\d+)$/m);
  const hostOk = Boolean(host) && host[1].trim() === PRODUCTION_BIND_HOST;
  record('profile-loopback', hostOk, 'source',
    hostOk ? `production profile pins BIND_HOST=${PRODUCTION_BIND_HOST}` : `production profile must pin BIND_HOST=${PRODUCTION_BIND_HOST}`);
  const portOk = Boolean(port) && !PROTECTED_PORTS.includes(Number(port[1])) && PRODUCTION_PORT_CANDIDATES.includes(Number(port[1]));
  record('profile-port', portOk, 'source',
    portOk ? `production profile pins reviewed port ${port[1]}`
      : `production profile must pin an explicit reviewed port outside ${PROTECTED_PORTS.join('/')}`);

  const requiredKeys = ['NODE_ENV', 'BLACKSPIRE_RUNTIME_MODE', 'BLACKSPIRE_STATE_OWNER', 'BIND_HOST', 'PORT',
    'PUBLIC_BASE_URL', 'SECURE_COOKIES', 'BLACKSPIRE_DB_PATH', 'BLACKSPIRE_BACKUP_DIR'];
  const missingKeys = requiredKeys.filter((key) => !new RegExp(`^${key}=`, 'm').test(profile));
  record('profile-required-keys', missingKeys.length === 0, 'source',
    missingKeys.length === 0 ? 'production profile documents every required key'
      : `production profile is missing keys: ${missingKeys.join(', ')}`);
}

{
  const conf = read('ops/reverse-proxy/blackspire-command.nginx.conf') || '';
  const targetsProtected = new RegExp(`server\\s+\\S*:(${PROTECTED_PORTS.join('|')});`).test(conf);
  record('nginx-upstream-safe', conf.length > 0 && !targetsProtected, 'source',
    targetsProtected ? 'nginx upstream must never target a protected port' : 'nginx upstream avoids protected ports');
  const publishesAppPort = PRODUCTION_PORT_CANDIDATES.some((candidate) => new RegExp(`listen\\s+(0\\.0\\.0\\.0:)?${candidate}\\b`).test(conf));
  record('nginx-no-public-app-port', !publishesAppPort, 'source',
    publishesAppPort ? 'nginx must never listen directly on the application port' : 'nginx never publishes the application port');
  const loopbackUpstream = /server\s+127\.0\.0\.1:\d+;/.test(conf);
  record('nginx-loopback-upstream', loopbackUpstream, 'source',
    loopbackUpstream ? 'nginx proxies a loopback upstream' : 'nginx upstream must be loopback');
}

// --- Cutover ordering and rollback ----------------------------------------------------------

{
  const switchScript = read('scripts/release-switch.sh') || '';
  const atomic = /ln -sfn/.test(switchScript) && /mv -Tf?/.test(switchScript);
  record('cutover-atomic', atomic, 'source',
    atomic ? 'release-switch.sh swaps the current symlink atomically'
      : 'release-switch.sh must create the current symlink atomically (ln -sfn then mv -T)');

  const rollback = read('scripts/release-rollback.sh');
  record('rollback-tooling', rollback !== null && rollback.length > 0, 'source',
    rollback ? 'release-rollback.sh present' : 'release-rollback.sh is missing');
}

{
  const missing = REQUIRED_TOOLING.filter((relative) => read(relative) === null);
  record('activation-tooling', missing.length === 0, 'source',
    missing.length === 0 ? `${REQUIRED_TOOLING.length} activation and rollback tools present`
      : `missing activation tooling: ${missing.join(', ')}`);
}

// --- Deployment-class: installed unit drift (read-only) --------------------------------------

{
  let installed = null;
  try { installed = fs.readFileSync(INSTALLED_UNIT_PATH, 'utf8'); } catch { installed = null; }
  if (installed === null) {
    record('installed-unit', true, 'deployment', 'no unit installed yet; the runbook must install the reviewed template before daemon-reload');
  } else if (unit !== null && installed === unit) {
    record('installed-unit', true, 'deployment', 'installed unit matches the reviewed template');
  } else {
    record('installed-unit', false, 'deployment',
      'installed unit differs from the reviewed template and must be reinstalled before daemon-reload and start');
  }
}

// --- Report -----------------------------------------------------------------------------------

const sourceFindings = findings.filter((finding) => finding.class === 'source');
const deploymentFindings = findings.filter((finding) => finding.class === 'deployment');
const sourceFailures = sourceFindings.filter((finding) => !finding.ok);
const deploymentFailures = deploymentFindings.filter((finding) => !finding.ok);
const ok = sourceFailures.length === 0 && (!strict || deploymentFailures.length === 0);

if (asJson) {
  console.log(JSON.stringify({
    ok,
    checked: findings.length,
    sourcePassed: sourceFindings.length - sourceFailures.length,
    sourceFailed: sourceFailures.length,
    deploymentPassed: deploymentFindings.length - deploymentFailures.length,
    deploymentFailed: deploymentFailures.length,
    findings,
  }, null, 2));
} else {
  for (const finding of findings) {
    console.log(`${finding.ok ? 'PASS' : 'FAIL'} [${finding.class}] ${finding.id}: ${finding.detail}`);
  }
  console.log(`\nBLACKSPIRE PRODUCTION PREFLIGHT: ok=${ok} source=${sourceFindings.length - sourceFailures.length}/${sourceFindings.length} deployment=${deploymentFindings.length - deploymentFailures.length}/${deploymentFindings.length}`);
}

process.exit(ok ? 0 : 1);
