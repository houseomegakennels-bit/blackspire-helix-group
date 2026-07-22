import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  assertTrustedReportDirectory,
  createTerminalRecord,
  expectedTestFiles,
  selectTrustedExecutionEvidence,
  writeTrustedInventoryReport,
} from './test-inventory.js';

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runnerChild = path.join(rootDirectory, 'scripts/test-runner-child.js');
const verifier = path.join(rootDirectory, 'scripts/verify-test-inventory.js');

function cleanupReport(directory, directoryStat, reportPath) {
  assertTrustedReportDirectory(directory, directoryStat);
  if (fs.existsSync(reportPath) || fs.lstatSync(directory).nlink > 2) {
    const reportStat = fs.lstatSync(reportPath);
    if (!reportStat.isFile() || reportStat.isSymbolicLink()) {
      throw new Error('refusing unsafe trusted-report cleanup of a substituted report path');
    }
    fs.unlinkSync(reportPath);
  }
  fs.rmdirSync(directory);
}

function runChild(runId, discovered, environment) {
  return new Promise((resolve) => {
    const messages = [];
    const child = fork(runnerChild, [runId, rootDirectory, ...discovered], {
      cwd: rootDirectory,
      env: environment,
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
    });
    let spawnError = null;
    child.on('message', (message) => messages.push(message));
    child.once('error', (error) => { spawnError = error; });
    child.once('close', (code, signal) => resolve({ code, signal, messages, spawnError }));
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => child.kill(signal));
    }
  });
}

const discovered = expectedTestFiles();
const runId = crypto.randomBytes(16).toString('hex');
const reportDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'blackspire-test-report-'));
fs.chmodSync(reportDirectory, 0o700);
const reportDirectoryStat = fs.lstatSync(reportDirectory);
const reportPath = path.join(reportDirectory, 'terminal.jsonl');
const environment = { ...process.env };
delete environment.BLACKSPIRE_RUN_MIGRATIONS;
delete environment.BLACKSPIRE_TEST_MANIFEST_PATH;
delete environment.BLACKSPIRE_TEST_REPORT_PATH;

let finalExitCode = 1;
try {
  const child = await runChild(runId, discovered, environment);
  if (child.spawnError) throw child.spawnError;

  let evidence = null;
  let evidenceError = null;
  try {
    evidence = selectTrustedExecutionEvidence(child.messages, { intended: discovered, runId });
  } catch (error) {
    evidenceError = error;
  }

  const interrupted = child.signal !== null;
  const terminalRecord = createTerminalRecord({
    runId,
    discovered,
    started: evidence?.started ?? [],
    completed: evidence?.completed ?? [],
    fileStatuses: evidence?.fileStatuses ?? [],
    childStatus: { code: child.code, signal: child.signal, interrupted },
    terminalState: evidenceError ? 'invalid-evidence' : interrupted ? 'interrupted' : 'completed',
  });

  assertTrustedReportDirectory(reportDirectory, reportDirectoryStat);
  writeTrustedInventoryReport(reportPath, terminalRecord);
  if (evidenceError) console.error(`Trusted execution evidence rejected: ${evidenceError.message}`);

  const verification = spawnSync(process.execPath, [verifier, reportPath, runId], {
    cwd: rootDirectory,
    env: environment,
    stdio: 'inherit',
  });
  if (verification.error) throw verification.error;

  if (typeof child.code === 'number' && child.code !== 0) finalExitCode = child.code;
  else if (interrupted) finalExitCode = 1;
  else if (verification.status !== 0) finalExitCode = verification.status ?? 1;
  else finalExitCode = 0;
} catch (error) {
  console.error(`Test runner failed: ${error.message}`);
  finalExitCode = 1;
} finally {
  try {
    cleanupReport(reportDirectory, reportDirectoryStat, reportPath);
  } catch (error) {
    console.error(`Trusted report cleanup failed: ${error.message}`);
    finalExitCode = 1;
  }
}

process.exitCode = finalExitCode;
