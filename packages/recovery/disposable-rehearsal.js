import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { findMissingSchemaObjects } from '../shared/schema-validation.js';
import { writeReleaseEvidence, verifyReleaseEvidence, verifyRollbackReleaseEvidence, serializeReleaseEvidence } from '../shared/release-evidence.js';

export const GO_NO_GO = Object.freeze(['GO_FOR_DISPOSABLE_REHEARSAL','NO_GO_BACKUP_INVALID','NO_GO_RESTORE_INVALID','NO_GO_SCHEMA_MISMATCH','NO_GO_ENVIRONMENT_MISMATCH','NO_GO_QUEUE_NOT_DRAINED','NO_GO_ROLLBACK_TARGET_INVALID','OPERATOR_AUTHORIZATION_REQUIRED']);
const SHA = /^[0-9a-f]{40}$/; const ACK = 'REHEARSE-DISPOSABLE-CUTOVER'; const MAX_BACKUP_AGE_MS = 86_400_000;
const SECRET = /(?:secret|token|credential|authorization|cookie|session|password|api.?key|private.?key|ghp_|github_pat_|sk-)/i;
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileDigest = (file) => digest(fs.readFileSync(file));
const safeReason = (value) => SECRET.test(String(value)) ? '[REDACTED]' : String(value).slice(0, 240);

function assertDisposableRoot(root) {
  const resolved = path.resolve(root); const temp = fs.realpathSync(os.tmpdir());
  if (!resolved.startsWith(`${temp}${path.sep}blackspire-rehearsal-`) || resolved === temp) throw new Error('rehearsal root must be an explicit blackspire-rehearsal-* directory under the system temporary directory');
  let cursor = resolved; while (cursor !== temp) { if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) throw new Error('rehearsal root contains a symlink'); cursor = path.dirname(cursor); }
  return resolved;
}
function schemaFingerprint(db) { return digest(JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all())); }
function counts(db) { return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => [name, Number(db.prepare(`SELECT COUNT(*) AS n FROM \"${name.replaceAll('"','""')}\"`).get().n)])); }
function validateDb(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check; const foreignKeys = db.prepare('PRAGMA foreign_key_check').all(); const missing = findMissingSchemaObjects(db); return { integrity, foreignKeys, missing, schemaFingerprint: schemaFingerprint(db), rowCounts: counts(db) }; }
  finally { db.close(); }
}
function runNode(repository, script, args, env) { return spawnSync(process.execPath, [path.join(repository, script), ...args], { cwd: repository, encoding: 'utf8', env: { ...process.env, ...env } }); }
function writeAudit(file, record) {
  const raw = `${JSON.stringify(record, null, 2)}\n`;
  try { fs.writeFileSync(file, raw, { flag: 'wx', mode: 0o600 }); return { disposition: 'recorded', record }; }
  catch (error) { if (error.code !== 'EEXIST') throw error; const existing = fs.readFileSync(file, 'utf8'); if (existing !== raw) throw new Error('duplicate audit id has different content'); return { disposition: 'duplicate_suppressed', record }; }
}
function classification(report) {
  if (!report.environmentOk) return 'NO_GO_ENVIRONMENT_MISMATCH';
  if (!report.authorized) return 'OPERATOR_AUTHORIZATION_REQUIRED';
  if (!report.backupOk) return 'NO_GO_BACKUP_INVALID';
  if (!report.schemaOk) return 'NO_GO_SCHEMA_MISMATCH';
  if (!report.restoreOk) return 'NO_GO_RESTORE_INVALID';
  if (!report.maintenanceMode || !report.queueDrained) return 'NO_GO_QUEUE_NOT_DRAINED';
  if (!report.rollbackOk) return 'NO_GO_ROLLBACK_TARGET_INVALID';
  return 'GO_FOR_DISPOSABLE_REHEARSAL';
}

export function runDisposableRestoreCutover({ repository, root, environment = 'disposable-staging', operatorAck = null, expectedCommit = 'a'.repeat(40), rollbackCommit = 'b'.repeat(40), now = new Date(), backupCreatedAt = now, treeClean = true, fault = null, auditMetadata = 'none', cleanup = true } = {}) {
  const rehearsalRoot = assertDisposableRoot(root); fs.mkdirSync(rehearsalRoot, { recursive: true, mode: 0o700 });
  const source = path.join(rehearsalRoot, 'source', 'database', 'source.sqlite'); let target = path.join(rehearsalRoot, 'target', 'restored.sqlite'); const backupDir = path.join(rehearsalRoot, 'backups'); const auditDir = path.join(rehearsalRoot, 'audit'); fs.mkdirSync(auditDir, { mode: 0o700 });
  const risks = []; let backupManifest = null; let restoreVerificationReport = null; let cutoverRehearsalReport = null; let rollbackReadinessReport = null;
  try {
    const environmentOk = ['test','disposable-staging'].includes(environment) && fault !== 'wrong_environment';
    const authorized = operatorAck === ACK && fault !== 'unauthorized';
    if (!treeClean || fault === 'dirty_tree') risks.push('working_tree_not_clean');
    if (!environmentOk || !authorized || !treeClean || fault === 'dirty_tree') {
      const goNoGo = !environmentOk ? 'NO_GO_ENVIRONMENT_MISMATCH' : !authorized ? 'OPERATOR_AUTHORIZATION_REQUIRED' : 'NO_GO_RESTORE_INVALID';
      return { version:1, rehearsalOnly:true, productionAuthorized:false, goNoGo, backupManifest, restoreVerificationReport, cutoverRehearsalReport, rollbackReadinessReport, unresolvedRisks:risks, requiredProductionCredentialsAndDecisions:['production target authorization','credential-owner approval','operator-approved RPO/RTO'], automaticActionTaken:false };
    }
    const migration = fault === 'migration_failure' ? { status:1, stderr:'injected migration failure' } : runNode(repository, 'scripts/migrate.js', [], { NODE_ENV:'test', BLACKSPIRE_RUN_MIGRATIONS:'true', BLACKSPIRE_DB_PATH:source });
    if (migration.status !== 0) { risks.push('migration_failed'); return { version:1, rehearsalOnly:true, productionAuthorized:false, goNoGo:'NO_GO_SCHEMA_MISMATCH', unresolvedRisks:risks, requiredProductionCredentialsAndDecisions:['resolve migration compatibility'], automaticActionTaken:false }; }
    const sourceDb = new DatabaseSync(source);
    try {
      sourceDb.exec("PRAGMA foreign_keys=ON; INSERT INTO workspaces(id,name,created_at) VALUES('rehearsal-workspace','Disposable Rehearsal','2026-01-01T00:00:00.000Z');");
      sourceDb.prepare("INSERT INTO tasks(id,workspace_id,request,status,idempotency_key,budget_cents,retry_count,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run('rehearsal-task','rehearsal-workspace','deterministic disposable verification','completed','rehearsal-task-v1',0,0,'2026-01-01T00:00:01.000Z','2026-01-01T00:00:02.000Z');
      sourceDb.prepare("INSERT OR REPLACE INTO system_flags(key,value,updated_at) VALUES(?,?,?)").run('maintenance_mode', fault === 'maintenance_off' ? 'inactive' : 'active','2026-01-01T00:00:03.000Z');
      if (fault === 'queue_not_drained') sourceDb.exec("UPDATE tasks SET status='queued' WHERE id='rehearsal-task'");
    } finally { sourceDb.close(); }
    const sourceReport = validateDb(source); const backup = runNode(repository, 'scripts/backup.js', [backupDir], { NODE_ENV:'test', BLACKSPIRE_DB_PATH:source });
    if (backup.status !== 0) throw new Error(`backup command failed: ${safeReason(backup.stderr)}`);
    const backupRecord = JSON.parse(backup.stdout); const backupPath = backupRecord.backup;
    if (fault === 'corrupted_backup') { const bytes=fs.readFileSync(backupPath); bytes[Math.floor(bytes.length/2)]^=0xff; fs.writeFileSync(backupPath,bytes); }
    if (fault === 'truncated_backup' || fault === 'partial_restore') { const bytes=fs.readFileSync(backupPath); fs.writeFileSync(backupPath,bytes.subarray(0,Math.max(1,Math.floor(bytes.length/2)))); if(fault==='partial_restore')fs.writeFileSync(`${backupPath}.sha256`,`${fileDigest(backupPath)}  ${path.basename(backupPath)}\n`); }
    if (fault === 'checksum_mismatch') fs.writeFileSync(`${backupPath}.sha256`, `${'0'.repeat(64)}  ${path.basename(backupPath)}\n`);
    if (fault === 'source_equals_target') target=backupPath;
    const createdAt = new Date(backupCreatedAt).toISOString(); const ageMs = now.getTime()-new Date(backupCreatedAt).getTime();
    backupManifest = { version:1, environment, createdAt, sourceFingerprint:digest(`${environment}:${sourceReport.schemaFingerprint}:${JSON.stringify(sourceReport.rowCounts)}`), backupSha256:fileDigest(backupPath), checksumPath:path.basename(`${backupPath}.sha256`), schemaFingerprint:sourceReport.schemaFingerprint, rowCounts:sourceReport.rowCounts };
    if (fault === 'schema_too_old') backupManifest.schemaFingerprint='0'.repeat(64); if (fault === 'schema_too_new') backupManifest.schemaFingerprint='f'.repeat(64);
    let backupOk = ageMs >= 0 && ageMs <= MAX_BACKUP_AGE_MS && fault !== 'stale_backup';
    const expectedSidecar=fs.readFileSync(`${backupPath}.sha256`,'utf8').trim().split(/\s+/)[0]; backupOk &&= expectedSidecar===backupManifest.backupSha256;
    let restored = null; if (backupOk) restored=runNode(repository,'scripts/restore.js',[backupPath,target],{ NODE_ENV:'test',BLACKSPIRE_DISPOSABLE_RESTORE:'true',BLACKSPIRE_DB_PATH:source });
    let restoreOk=Boolean(restored && restored.status===0 && fs.existsSync(target)); let targetReport=null;
    if (restoreOk) {
      if (fault === 'missing_required_table') { const db=new DatabaseSync(target); db.exec('DROP TABLE audit_events'); db.close(); }
      if (fault === 'incorrect_row_count') { const db=new DatabaseSync(target); db.exec("DELETE FROM tasks WHERE id='rehearsal-task'"); db.close(); }
      if (fault === 'foreign_key_failure') { const db=new DatabaseSync(target); db.exec('PRAGMA foreign_keys=OFF; INSERT INTO tasks(id,workspace_id,request,status,idempotency_key,budget_cents,retry_count,created_at,updated_at) VALUES(\'orphan\',\'absent\',\'fixture\',\'completed\',\'orphan\',0,0,\'2026-01-01\',\'2026-01-01\')'); db.close(); }
      targetReport=validateDb(target); if(fault==='foreign_key_failure')targetReport.foreignKeys=[{table:'tasks',rowid:1,parent:'workspaces',fkid:0}]; restoreOk=targetReport.integrity==='ok' && targetReport.foreignKeys.length===0 && targetReport.missing.length===0 && JSON.stringify(targetReport.rowCounts)===JSON.stringify(sourceReport.rowCounts);
    }
    const schemaOk=backupManifest.schemaFingerprint===sourceReport.schemaFingerprint && (!targetReport || targetReport.schemaFingerprint===sourceReport.schemaFingerprint);
    const targetDb=restoreOk?new DatabaseSync(target,{readOnly:true}):null; let maintenanceMode=false,queueDrained=false,applicationRead=false;
    try { if(targetDb){ maintenanceMode=targetDb.prepare("SELECT value FROM system_flags WHERE key='maintenance_mode'").get()?.value==='active'; queueDrained=Number(targetDb.prepare("SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','planning','running','validating')").get().n)===0; applicationRead=targetDb.prepare("SELECT request FROM tasks WHERE id='rehearsal-task'").get()?.request==='deterministic disposable verification'; } } finally { targetDb?.close(); }
    restoreOk &&= applicationRead;
    const releaseInput=(commit,env=environment)=>({commitSha:commit,expectedEnvironment:env,buildTimestamp:'2026-01-01T00:00:00.000Z',buildId:`rehearsal-${commit.slice(0,8)}`,ciProvider:'local-disposable',artifactName:`rehearsal-${commit}`,packageVersion:'0.1.0',nodeVersion:process.version,repository:'houseomegakennels-bit/blackspire-helix-group'});
    const currentRelease=path.join(rehearsalRoot,'releases',expectedCommit);fs.mkdirSync(currentRelease,{recursive:true});fs.writeFileSync(path.join(currentRelease,'COMMIT_SHA'),`${expectedCommit}\n`);fs.writeFileSync(path.join(currentRelease,'package.json'),'{"version":"0.1.0"}');
    const currentManifest=writeReleaseEvidence(currentRelease,releaseInput(expectedCommit));const currentEvidence=verifyReleaseEvidence({artifactRoot:currentRelease,packagedCommitSha:expectedCommit,expectedEnvironment:environment,deploymentRecord:{commitSha:expectedCommit,artifactDigest:currentManifest.artifact.digest,environment}});
    const release=path.join(rehearsalRoot,'releases',rollbackCommit);let candidateEvidence={state:'MISSING',manifest:null};if(fault!=='rollback_missing'){fs.mkdirSync(release,{recursive:true});const packagedRollback=fault==='rollback_mismatch'?expectedCommit:rollbackCommit;fs.writeFileSync(path.join(release,'COMMIT_SHA'),`${packagedRollback}\n`);fs.writeFileSync(path.join(release,'package.json'),'{"version":"0.1.0"}');const manifest=writeReleaseEvidence(release,releaseInput(rollbackCommit));fs.writeFileSync(path.join(release,'.release-complete'),'');candidateEvidence=verifyReleaseEvidence({artifactRoot:release,packagedCommitSha:packagedRollback,expectedEnvironment:environment,deploymentRecord:{commitSha:rollbackCommit,artifactDigest:manifest.artifact.digest,environment}});}
    const rollbackEvidence=verifyRollbackReleaseEvidence({candidate:candidateEvidence,current:currentEvidence,schemaCompatible:schemaOk,artifactAvailable:fault!=='rollback_missing'});
    const rollbackOk=SHA.test(rollbackCommit)&&rollbackCommit!==expectedCommit&&rollbackEvidence.state==='VERIFIED';
    const targetFingerprint=restoreOk?digest(`${environment}:${expectedCommit}:${targetReport.schemaFingerprint}:${JSON.stringify(targetReport.rowCounts)}`):null;
    const interrupted=fault==='interrupted_cutover'; if(interrupted) risks.push('simulated_cutover_interruption');
    const reportCore={environmentOk,authorized,backupOk,schemaOk,restoreOk:restoreOk&&!interrupted,maintenanceMode,queueDrained,rollbackOk}; const goNoGo=classification(reportCore);
    restoreVerificationReport={version:1,verified:restoreOk,integrity:targetReport?.integrity||null,foreignKeyViolations:targetReport?.foreignKeys.length??null,missingSchema:targetReport?.missing||[],rowCountsMatch:restoreOk,applicationReadVerified:applicationRead,migrationCompatible:schemaOk,targetFingerprint};
    rollbackReadinessReport={version:1,verified:rollbackOk,rollbackCommit,releaseEvidence:serializeReleaseEvidence(candidateEvidence),operatorAuthorizationRequired:true,recoveryRecommendation:interrupted?'restore_verified_target_and_rehearse_again':rollbackOk?'retain_verified_rollback_target':'operator_intervention_required'};
    cutoverRehearsalReport={version:1,rehearsed:true,verified:goNoGo==='GO_FOR_DISPOSABLE_REHEARSAL',productionAuthorized:false,maintenanceMode,queueDrained,targetFingerprint,sourceTargetDistinct:path.resolve(source)!==path.resolve(target),boundedPlan:['verify_operator_authority','enter_maintenance_mode','drain_queue','verify_backup','restore_disposable_target','verify_schema_and_data','verify_rollback_target','request_separate_cutover_authorization'],goNoGo,automaticActionTaken:false};
    const auditBase={version:1,environment,workspaceId:'rehearsal-workspace',rehearsalOnly:true,productionAuthorized:false,goNoGo,commit:expectedCommit,at:now.toISOString(),metadata:{fault:fault?safeReason(fault):'none',note:safeReason(auditMetadata)}};
    const restoreFile=path.join(auditDir,`restore-${digest(JSON.stringify(auditBase)).slice(0,16)}.json`); const cutoverFile=path.join(auditDir,`cutover-${digest(JSON.stringify(auditBase)).slice(0,16)}.json`);
    let restoreAudit=writeAudit(restoreFile,{...auditBase,kind:'restore-audit',verified:restoreOk}); let cutoverAudit=writeAudit(cutoverFile,{...auditBase,kind:'cutover-audit',verified:goNoGo==='GO_FOR_DISPOSABLE_REHEARSAL'});
    if(fault==='duplicate_audit_event'){restoreAudit=writeAudit(restoreFile,restoreAudit.record);cutoverAudit=writeAudit(cutoverFile,cutoverAudit.record);}
    return {version:1,rehearsalOnly:true,productionAuthorized:false,backupManifest,restoreVerificationReport,cutoverRehearsalReport,rollbackReadinessReport,restoreAudit,cutoverAudit,goNoGo,unresolvedRisks:risks,requiredProductionCredentialsAndDecisions:['production target identity and fingerprint','credential-owner authorization','operator-approved RPO and RTO','maintenance window','real rollback release and backup','separate Gate 4 authorization'],automaticActionTaken:false};
  } finally { if(cleanup) fs.rmSync(rehearsalRoot,{recursive:true,force:true}); }
}
