#!/usr/bin/env node
// Offline post-deploy decision contract. It consumes a sanitized observation fixture and never
// connects to an environment, deploys, rolls back, invokes a provider, or sends Telegram traffic.
import fs from 'node:fs';
import path from 'node:path';
import { verifyPostDeploy } from '../packages/shared/post-deploy-verifier.js';

const args = process.argv.slice(2);
const value = (name) => { const index = args.indexOf(name); return index < 0 ? null : args[index + 1]; };
const inputPath = value('--input');
const auditPath = value('--audit-output');
if (!inputPath || !path.isAbsolute(inputPath)) throw new Error('--input must be an explicit absolute path');
const inputStat = fs.lstatSync(inputPath);
if (!inputStat.isFile() || inputStat.isSymbolicLink()) throw new Error('--input must be a regular non-symlink file');
const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
const nowMs = Date.now();
const report = verifyPostDeploy(input, nowMs);
const audit = { ...report, recordedAt: new Date().toISOString() };
if (auditPath) {
  if (!path.isAbsolute(auditPath)) throw new Error('--audit-output must be an explicit absolute path');
  fs.mkdirSync(path.dirname(auditPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}
console.log(JSON.stringify(audit, null, 2));
process.exit(report.classification === 'proceed' || report.classification === 'observe' ? 0 : 1);
