#!/usr/bin/env node
// Deterministic, read-only Gate 4 production preflight.
//
// Reports pass/fail for the complete source-controlled production activation contract in one
// command, so activation blockers are found together instead of one per attempt. It is strictly
// read-only: it never starts, stops, reloads, enables, installs, migrates, binds, or modifies
// anything. It reads file contents and metadata only, and prints no secret values — only key
// names, file sizes and modes, a port number, and structural facts.
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
const WORKER_UNIT_PATH = 'ops/runtime-ownership/blackspire-command-worker.service';
const TARGET_PATH = 'ops/runtime-ownership/blackspire-command.target';
const INSTALLED_UNIT_PATH = '/etc/systemd/system/blackspire-command.service';
const INSTALLED_WORKER_UNIT_PATH = '/etc/systemd/system/blackspire-command-worker.service';
const INSTALLED_TARGET_PATH = '/etc/systemd/system/blackspire-command.target';
const NODE_BIN_LIB = 'scripts/lib/node-bin.sh';

// Shell scripts are discovered rather than listed, so a newly added production script is covered
// by default instead of being silently exempt. Only these documented development-only entry points
// are excluded, and each is excluded for a stated reason.
const DEVELOPMENT_ONLY_SCRIPTS = new Map([
  // The canonical resolver is the one place a PATH lookup may legitimately appear: it is the
  // documented development and CI last resort, is refused under vps-production, and is covered by
  // behavioural tests that execute it against valid and invalid interpreters.
  [NODE_BIN_LIB, 'the canonical resolver itself; its PATH last resort is refused under vps-production'],
  ['scripts/codespace-readiness-check.sh', 'Codespaces bootstrap; never runs on the durable VPS'],
  ['scripts/setup-picsart-mcp.sh', 'developer MCP tooling; never runs on the durable VPS'],
  ['scripts/start-iphone-test.sh', 'disposable iphone-test runtime under its own state owner'],
  ['scripts/bootstrap-development.sh', 'development bootstrap only'],
  ['scripts/bootstrap-codespace.sh', 'Codespaces bootstrap only'],
]);

// Direct and indirect PATH resolution of a Node interpreter.
const PATH_LOOKUP_PATTERNS = [
  { id: 'bare node invocation', regex: /(^|[^\w./$"'-])node\s+(-|--|<|\/?\w[\w./-]*\.(js|mjs|cjs))/ },
  { id: 'env node', regex: /\benv\s+node\b/ },
  { id: 'command -v node', regex: /command\s+-v\s+node/ },
  { id: 'which node', regex: /\bwhich\s+node\b/ },
  { id: 'type -p node', regex: /\btype\s+-p\s+node\b/ },
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
  WORKER_UNIT_PATH,
  TARGET_PATH,
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

// Metadata only; never mutates. Returns null when the path is absent.
const statOf = (absolute) => {
  try {
    return fs.statSync(absolute);
  } catch {
    return null;
  }
};

// A required tool must exist, be a regular file, and be non-empty. A zero-byte file is a broken
// checkout or a truncated copy, not a present tool.
const usableFile = (relative) => {
  const stat = statOf(path.join(rootDirectory, relative));
  return stat !== null && stat.isFile() && stat.size > 0;
};

// Recursively collect shell scripts under a directory, relative to the repository root.
const collectShellScripts = (relativeDirectory) => {
  const found = [];
  const walk = (current) => {
    let entries;
    try {
      entries = fs.readdirSync(path.join(rootDirectory, current), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const next = path.posix.join(current, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile() && entry.name.endsWith('.sh')) found.push(next);
    }
  };
  walk(relativeDirectory);
  return found.sort();
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
const workerUnit = read(WORKER_UNIT_PATH);
const runtimeTarget = read(TARGET_PATH);
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

  // The helpers must be pinned to the same interpreter ExecStart runs, and the reviewed value must
  // be declared after the operator-managed EnvironmentFile so it takes precedence over it.
  const pinnedEnv = unit.match(/^Environment=BLACKSPIRE_NODE_BIN=(\S+)$/m);
  const afterEnvironmentFile = pinnedEnv !== null
    && unit.indexOf('Environment=BLACKSPIRE_NODE_BIN=') > unit.indexOf('EnvironmentFile=');
  const interpreterAgrees = pinnedEnv !== null && interpreter !== null && pinnedEnv[1] === interpreter;
  record('unit-interpreter-env-pinned', interpreterAgrees && afterEnvironmentFile, 'source',
    interpreterAgrees && afterEnvironmentFile
      ? 'the unit pins BLACKSPIRE_NODE_BIN to the ExecStart interpreter, after EnvironmentFile'
      : 'the unit must pin Environment=BLACKSPIRE_NODE_BIN to the ExecStart interpreter, declared after EnvironmentFile');

  const execStartPre = /^ExecStartPre=.*verify-environment\.sh vps-production/m.test(unit);
  record('unit-execstartpre', execStartPre, 'source',
    execStartPre ? 'ExecStartPre runs the vps-production environment verification'
      : 'ExecStartPre must run scripts/verify-environment.sh vps-production');

  const hardening = ['User=blackspire', 'Group=blackspire', 'NoNewPrivileges=yes', 'ProtectSystem=strict',
    'ProtectHome=yes', 'PrivateTmp=yes', 'RestrictSUIDSGID=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=',
    'LogsDirectory=blackspire-command', 'LogsDirectoryMode=0750', 'UMask=0027',
    'StandardOutput=append:/var/log/blackspire-command/command.log',
    'StandardError=append:/var/log/blackspire-command/command.log'];
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

{
  const apiIsolated = unit !== null && /^ExecStart=.*production-supervisor\.js --api-only$/m.test(unit);
  const workerIsolated = workerUnit !== null && /^ExecStart=.*production-supervisor\.js --worker-only$/m.test(workerUnit);
  const targetStartsBoth = runtimeTarget !== null && /^Wants=blackspire-command\.service blackspire-command-worker\.service$/m.test(runtimeTarget);
  const lifecycleIndependent = unit !== null && workerUnit !== null &&
    !/Requires=blackspire-command-worker\.service/.test(unit) && !/Requires=blackspire-command\.service/.test(workerUnit);
  const workerHardening = workerUnit !== null && ['User=blackspire', 'Group=blackspire', 'NoNewPrivileges=yes',
    'ProtectSystem=strict', 'ProtectHome=yes', 'PrivateTmp=yes', 'ReadWritePaths=/opt/blackspire-command/shared',
    'CapabilityBoundingSet=', 'AmbientCapabilities=', 'TimeoutStopSec=35'].every((directive) => workerUnit.includes(directive));
  const complete = apiIsolated && workerIsolated && targetStartsBoth && lifecycleIndependent && workerHardening;
  record('service-topology', complete, 'source',
    complete
      ? 'API and worker have independent supervisors and restarts under one non-coupling target'
      : 'API and hardened worker must use role-specific supervisors under a target without cross-service Requires coupling');
}

// --- Startup-path interpreter resolution ----------------------------------------------------

{
  // Non-empty, for the same reason zero-byte tooling counts as missing: an emptied resolver would
  // otherwise satisfy a mere existence check while every caller fails.
  const libUsable = usableFile(NODE_BIN_LIB) && (read(NODE_BIN_LIB) ?? '').includes('blackspire_resolve_node');
  record('node-resolver-present', libUsable, 'source',
    libUsable ? `${NODE_BIN_LIB} present and defines the resolver` : `${NODE_BIN_LIB} is missing, empty, or does not define blackspire_resolve_node`);

  // Discovered, not listed: every shell script under scripts/ and ops/ is inspected unless it is a
  // documented development-only entry point, so a new production script cannot be silently exempt.
  const discovered = [...collectShellScripts('scripts'), ...collectShellScripts('ops')];
  const inScope = discovered.filter((relative) => !DEVELOPMENT_ONLY_SCRIPTS.has(relative));
  const offenders = [];
  for (const relative of inScope) {
    const body = read(relative);
    if (body === null) { offenders.push(`${relative} (unreadable)`); continue; }
    body.split('\n').forEach((line, index) => {
      if (/^\s*#/.test(line)) return;
      for (const pattern of PATH_LOOKUP_PATTERNS) {
        if (pattern.regex.test(line)) offenders.push(`${relative}:${index + 1} ${pattern.id}`);
      }
    });
  }
  record('startup-scripts-pinned', offenders.length === 0, 'source',
    offenders.length === 0 ? `${inScope.length} discovered shell scripts resolve Node deterministically (${DEVELOPMENT_ONLY_SCRIPTS.size} documented development-only exclusions)`
      : offenders.join('; '));

  // package.json entry points are part of the activation path too: db:backup and db:restore import
  // node:sqlite and run during the Gate 4 WAL-safe backup.
  let packageOffenders = [];
  try {
    const manifest = JSON.parse(read('package.json') ?? '{}');
    const activationScripts = ['db:migrate', 'db:backup', 'db:restore', 'start:production'];
    packageOffenders = activationScripts.filter((name) => {
      const command = manifest.scripts?.[name];
      return typeof command === 'string' && /(^|[^\w./$"'-])node\s/.test(command);
    });
  } catch {
    packageOffenders = ['package.json is unreadable'];
  }
  record('package-scripts-pinned', packageOffenders.length === 0, 'source',
    packageOffenders.length === 0 ? 'activation package scripts route through the pinned interpreter'
      : `activation package scripts resolve node through PATH: ${packageOffenders.join(', ')}`);
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
    'PUBLIC_BASE_URL', 'SECURE_COOKIES', 'BLACKSPIRE_DB_PATH', 'BLACKSPIRE_BACKUP_DIR',
    'BLACKSPIRE_RUNTIME_USER', 'BLACKSPIRE_STARTUP_TIMEOUT_SECONDS', 'BLACKSPIRE_HEALTH_TIMEOUT_SECONDS',
    'BLACKSPIRE_OPERATOR_PRINCIPAL_ID',
    // Required since the workspace-root preflight: ExecStartPre now refuses a production profile
    // that omits it, so a profile not documenting it would fail every start.
    'BLACKSPIRE_WORKSPACE_ROOT',
    // The real-provider-execution opt-in. It must be stated explicitly in the profile, so an
    // operator reading the profile can see whether this deployment can reach a paid provider
    // instead of having to infer it from an absent variable.
    'BLACKSPIRE_PRODUCTION_EXECUTION',
    // Required for production Codex execution because ProtectHome=yes blocks ~/.codex.
    'CODEX_HOME'];
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
  // A zero-byte file is a truncated or broken copy, not a present tool.
  const unusable = REQUIRED_TOOLING.filter((relative) => !usableFile(relative));
  const logrotate = read('ops/blackspire-command-logrotate.conf') ?? '';
  const isolatedRotation = /^\/var\/log\/blackspire-command\/command\.log\s*\{/m.test(logrotate)
    && /\bmaxsize\s+50M\b/.test(logrotate)
    && /\bcreate\s+0640\s+blackspire\s+blackspire\b/.test(logrotate)
    && !/\/var\/lib\/docker|\*/.test(logrotate);
  record('activation-tooling', unusable.length === 0 && isolatedRotation, 'source',
    unusable.length === 0 && isolatedRotation
      ? `${REQUIRED_TOOLING.length} activation and rollback tools present and non-empty; log rotation targets only the service log`
      : (unusable.length > 0
        ? `missing or empty activation tooling: ${unusable.join(', ')}`
        : 'log rotation must target only /var/log/blackspire-command/command.log with bounded retention'));
}

// --- Deployment-class: installed unit drift (read-only) --------------------------------------

// The interpreter the unit pins must actually exist on the host, be a regular file, and be
// executable. Without this the preflight can report success on a host where the single failure
// mode this contract exists to prevent is still present.
{
  const execStart = unit ? unit.match(/^ExecStart=(\S+)/m) : null;
  const interpreter = execStart ? execStart[1] : null;
  if (interpreter === null) {
    record('host-interpreter', false, 'deployment', 'no pinned interpreter could be read from the unit');
  } else {
    const stat = statOf(interpreter);
    const usable = stat !== null && stat.isFile() && (stat.mode & 0o111) !== 0;
    record('host-interpreter', usable, 'deployment',
      usable ? `pinned interpreter present and executable: ${interpreter} (mode ${(stat.mode & 0o777).toString(8)})`
        : `pinned interpreter ${interpreter} is absent or not executable on this host; the unit cannot start`);
  }
}

for (const [id, installedPath, reviewed] of [
  ['installed-unit', INSTALLED_UNIT_PATH, unit],
  ['installed-worker-unit', INSTALLED_WORKER_UNIT_PATH, workerUnit],
  ['installed-runtime-target', INSTALLED_TARGET_PATH, runtimeTarget],
]) {
  let installed = null;
  let installedIsRegular = false;
  try {
    const installedStat = fs.lstatSync(installedPath);
    installedIsRegular = installedStat.isFile() && !installedStat.isSymbolicLink();
    if (installedIsRegular) installed = fs.readFileSync(installedPath, 'utf8');
  } catch { installed = null; }
  if (installed === null) {
    record(id, false, 'deployment', `${installedPath} is absent, symlinked, or non-regular and must be installed as a regular file before activation`);
  } else if (reviewed !== null && installed === reviewed) {
    record(id, true, 'deployment', `${installedPath} matches the reviewed template`);
  } else {
    record(id, false, 'deployment', `${installedPath} differs from the reviewed template`);
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
