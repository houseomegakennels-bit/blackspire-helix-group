import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
process.env.BLACKSPIRE_REHEARSAL_FAULT_INJECTION='1';
const { runDisposableRestoreCutover, GO_NO_GO } = await import('../packages/recovery/disposable-rehearsal.js');

const repository=path.resolve(import.meta.dirname,'..'); let seq=0;
const root=()=>path.join(os.tmpdir(),`blackspire-rehearsal-test-${process.pid}-${seq++}`);
const options=(overrides={})=>({repository,root:root(),environment:'disposable-staging',operatorAck:'REHEARSE-DISPOSABLE-CUTOVER',expectedCommit:'a'.repeat(40),rollbackCommit:'b'.repeat(40),now:new Date('2026-08-05T03:00:00.000Z'),treeClean:true,cleanup:true,...overrides});

test('successful backup, restore, cutover, rollback, audit, and cleanup rehearsal',()=>{const input=options();const report=runDisposableRestoreCutover(input);assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');assert.equal(report.backupManifest.version,1);assert.equal(report.restoreVerificationReport.verified,true);assert.equal(report.restoreVerificationReport.integrity,'ok');assert.equal(report.restoreVerificationReport.rowCountsMatch,true);assert.equal(report.restoreVerificationReport.applicationReadVerified,true);assert.equal(report.cutoverRehearsalReport.sourceTargetDistinct,true);assert.equal(report.cutoverRehearsalReport.productionAuthorized,false);assert.equal(report.cutoverRehearsalReport.automaticActionTaken,false);assert.equal(report.rollbackReadinessReport.verified,true);assert.equal(fs.existsSync(input.root),false);});

const cases=[
  ['corrupted_backup','NO_GO_BACKUP_INVALID'],['truncated_backup','NO_GO_BACKUP_INVALID'],['checksum_mismatch','NO_GO_BACKUP_INVALID'],['stale_backup','NO_GO_BACKUP_INVALID'],
  ['source_equals_target','NO_GO_RESTORE_INVALID'],['schema_drift','NO_GO_SCHEMA_MISMATCH'],['migration_failure','NO_GO_SCHEMA_MISMATCH'],
  ['partial_restore','NO_GO_RESTORE_INVALID'],['missing_required_table','NO_GO_SCHEMA_MISMATCH'],['incorrect_row_count','NO_GO_RESTORE_INVALID'],['extra_row_in_target','NO_GO_RESTORE_INVALID'],['corrupted_row_payload','NO_GO_RESTORE_INVALID'],['corrupted_target_index','NO_GO_RESTORE_INVALID'],
  ['unauthorized','OPERATOR_AUTHORIZATION_REQUIRED'],['queue_not_drained','NO_GO_QUEUE_NOT_DRAINED'],['maintenance_off','NO_GO_QUEUE_NOT_DRAINED'],
  ['rollback_missing','NO_GO_ROLLBACK_TARGET_INVALID'],['rollback_mismatch','NO_GO_ROLLBACK_TARGET_INVALID'],['interrupted_cutover','NO_GO_RESTORE_INVALID'],['dirty_tree','NO_GO_RESTORE_INVALID'],
];
for(const [fault,expected] of cases)test(`${fault} fails closed as ${expected}`,()=>{const report=runDisposableRestoreCutover(options({fault}));assert.equal(report.goNoGo,expected);assert.ok(GO_NO_GO.includes(report.goNoGo));assert.equal(report.automaticActionTaken,false);});

// `rowCountsMatch` reports the row-count comparison ONLY. It used to be assigned the whole
// `restoreOk` conjunction, so a fault detected by integrity or by the application-level read made
// the report claim a row-count mismatch that never happened.
test('rowCountsMatch reports its own measurement and not the overall restore verdict',()=>{
  const payload=runDisposableRestoreCutover(options({fault:'corrupted_row_payload'}));
  assert.equal(payload.goNoGo,'NO_GO_RESTORE_INVALID');
  assert.equal(payload.restoreVerificationReport.verified,false);
  assert.equal(payload.restoreVerificationReport.applicationReadVerified,false);
  assert.equal(payload.restoreVerificationReport.rowCountsMatch,true,'row counts genuinely match under payload corruption');
  // A genuine structural corruption of the restored target: integrity fails, row counts still match.
  const corrupt=runDisposableRestoreCutover(options({fault:'corrupted_target_index'}));
  assert.equal(corrupt.goNoGo,'NO_GO_RESTORE_INVALID');
  assert.notEqual(corrupt.restoreVerificationReport.integrity,'ok');
  assert.deepEqual(corrupt.restoreVerificationReport.missingSchema,[],'integrity fault must not disturb required schema objects');
  assert.equal(corrupt.restoreVerificationReport.rowCountsMatch,true);
  // A genuine row-count divergence still reports false.
  const extra=runDisposableRestoreCutover(options({fault:'extra_row_in_target'}));
  assert.equal(extra.restoreVerificationReport.rowCountsMatch,false);
  // No target at all: nothing was measured, so the field stays false.
  const noTarget=runDisposableRestoreCutover(options({fault:'checksum_mismatch'}));
  assert.equal(noTarget.restoreVerificationReport.rowCountsMatch,false);
});

test('backup age is derived from the real artifact mtime, and a genuinely old artifact is refused',()=>{
  const fresh=runDisposableRestoreCutover(options());
  assert.equal(fresh.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');
  assert.ok(fresh.backupManifest.ageMs>=0&&fresh.backupManifest.ageMs<60_000,`fresh age ${fresh.backupManifest.ageMs}`);
  // `stale_backup` backdates the real backup file's mtime by 48h; nothing about the age is hardcoded.
  const stale=runDisposableRestoreCutover(options({fault:'stale_backup'}));
  assert.equal(stale.goNoGo,'NO_GO_BACKUP_INVALID');
  assert.ok(stale.backupManifest.ageMs>86_400_000,`stale age ${stale.backupManifest.ageMs}`);
  assert.ok(Date.parse(stale.backupManifest.createdAt)<Date.parse(fresh.backupManifest.createdAt));
});

test('source aliased to the source database is refused on the identity property',()=>{const report=runDisposableRestoreCutover(options({fault:'source_equals_target'}));assert.equal(report.cutoverRehearsalReport.sourceTargetDistinct,false);assert.equal(report.goNoGo,'NO_GO_RESTORE_INVALID');});

test('fault injection is refused unless the test-only seam is explicitly enabled',()=>{
  const previous=process.env.BLACKSPIRE_REHEARSAL_FAULT_INJECTION; delete process.env.BLACKSPIRE_REHEARSAL_FAULT_INJECTION;
  try{assert.throws(()=>runDisposableRestoreCutover(options({fault:'unauthorized'})),/fault injection is test-only/);}
  finally{process.env.BLACKSPIRE_REHEARSAL_FAULT_INJECTION=previous;}
});

test('wrong environment refuses before any fixture directory is created',()=>{const input=options({environment:'production'});const report=runDisposableRestoreCutover(input);assert.equal(report.goNoGo,'NO_GO_ENVIRONMENT_MISMATCH');assert.equal(report.productionAuthorized,false);assert.equal(fs.existsSync(input.root),false);});
test('operator authorization is required when acknowledgement is absent',()=>{const input=options({operatorAck:null});const report=runDisposableRestoreCutover(input);assert.equal(report.goNoGo,'OPERATOR_AUTHORIZATION_REQUIRED');assert.equal(fs.existsSync(input.root),false);});
test('duplicate audit events and idempotent retry are suppressed',()=>{const report=runDisposableRestoreCutover(options({fault:'duplicate_audit_event'}));assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');assert.equal(report.restoreAudit.disposition,'duplicate_suppressed');assert.equal(report.cutoverAudit.disposition,'duplicate_suppressed');});
test('audit metadata redacts secret-shaped values',()=>{const report=runDisposableRestoreCutover(options({auditMetadata:'api-token=do-not-record'}));assert.equal(report.restoreAudit.record.metadata.note,'[REDACTED]');assert.doesNotMatch(JSON.stringify(report),/do-not-record/);});
test('rehearsal root refuses paths outside the temporary disposable namespace',()=>{assert.throws(()=>runDisposableRestoreCutover(options({root:'/opt/blackspire-command'})),/rehearsal root/);});

test('the shipped CLI entrypoint reaches GO, exits 0, and removes its fixture',()=>{
  const cliRoot=path.join(os.tmpdir(),`blackspire-rehearsal-cli-${process.pid}-${seq++}`);
  const run=spawnSync(process.execPath,[path.join(repository,'scripts/disposable-restore-cutover-rehearsal.js'),'--root',cliRoot,'--environment','disposable-staging','--operator-ack','REHEARSE-DISPOSABLE-CUTOVER','--commit','a'.repeat(40),'--rollback','b'.repeat(40)],{encoding:'utf8',cwd:repository});
  const report=JSON.parse(run.stdout);
  assert.equal(report.productionAuthorized,false);
  assert.equal(report.automaticActionTaken,false);
  assert.equal(fs.existsSync(cliRoot),false);
  // The CLI refuses on a dirty checkout by design, so the GO assertions only apply to a clean one.
  const status=spawnSync('/usr/bin/git',['-C',repository,'status','--porcelain=v1','--untracked-files=all'],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}});
  if(status.status!==0||status.stdout!==''){assert.equal(report.goNoGo,'NO_GO_RESTORE_INVALID');assert.deepEqual(report.unresolvedRisks,['working_tree_not_clean']);return;}
  assert.equal(run.status,0,run.stderr);
  assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');
  // The CLI passes no `fault` and no clock override: the age below is measured from the real file.
  assert.ok(report.backupManifest.ageMs>=0&&report.backupManifest.ageMs<60_000);
});

test('a cleanup failure is aggregated without discarding the report',()=>{
  const input=options({root:path.join(os.tmpdir(),`blackspire-rehearsal-cleanup-${process.pid}-${seq++}`)});
  const real=fs.rmSync;
  fs.rmSync=(target,opts)=>{if(target===input.root){const error=new Error('EACCES: simulated busy fixture');error.code='EACCES';throw error;}return real(target,opts);};
  let report; try{report=runDisposableRestoreCutover(input);}finally{fs.rmSync=real;real(input.root,{recursive:true,force:true});}
  assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');
  assert.notEqual(report.backupManifest,null);
  assert.equal(report.fixtureCleanup.disposition,'failed');
  assert.equal(report.fixtureCleanup.root,input.root);
  assert.ok(report.unresolvedRisks.includes('fixture_cleanup_failed'));
});

test('a cleanup failure never masks the original error',()=>{
  const input=options({root:path.join(os.tmpdir(),`blackspire-rehearsal-both-${process.pid}-${seq++}`)});
  const realRm=fs.rmSync; const realRead=fs.readFileSync;
  fs.rmSync=(target,opts)=>{if(target===input.root){const error=new Error('EACCES: simulated busy fixture');error.code='EACCES';throw error;}return realRm(target,opts);};
  fs.readFileSync=(target,...rest)=>{if(String(target).endsWith('.sha256'))throw new Error('simulated sidecar read failure');return realRead(target,...rest);};
  try{
    assert.throws(()=>runDisposableRestoreCutover(input),(error)=>{
      // The original failure survives, and the cleanup failure is attached rather than replacing it.
      assert.match(error.message,/simulated sidecar read failure/);
      assert.match(error.cleanupFailure,/simulated busy fixture/);
      return true;
    });
  }finally{fs.rmSync=realRm;fs.readFileSync=realRead;realRm(input.root,{recursive:true,force:true});}
});

test('the shipped CLI exposes no fault-injection flag',()=>{assert.doesNotMatch(fs.readFileSync(path.join(repository,'scripts/disposable-restore-cutover-rehearsal.js'),'utf8'),/--fault/);});

// Regression: commit identifiers become path segments, so a non-SHA `--rollback` used to create the
// release fixture at the traversed location BEFORE the format was checked. The verdict was correctly
// NO_GO, but cleanup only removes the rehearsal root, so those files survived outside the disposable
// namespace entirely.
test('an invalid rollback identifier refuses before writing anything outside the disposable root', () => {
  const escape = path.join(os.tmpdir(), `blackspire-traversal-probe-${process.pid}`);
  fs.rmSync(escape, { recursive: true, force: true });
  const traversal = path.join('..', '..', '..', '..', escape.replace(/^\//, ''));
  const report = runDisposableRestoreCutover(options({ rollbackCommit: traversal }));
  assert.equal(report.goNoGo, 'NO_GO_ROLLBACK_TARGET_INVALID');
  assert.ok(report.unresolvedRisks.includes("commit_identifier_invalid"), JSON.stringify(report.unresolvedRisks));
  assert.equal(fs.existsSync(escape), false, 'the rehearsal wrote outside its disposable root');
});

test('an invalid expected commit refuses on the same guard', () => {
  const report = runDisposableRestoreCutover(options({ expectedCommit: 'not-a-sha' }));
  assert.equal(report.goNoGo, 'NO_GO_ROLLBACK_TARGET_INVALID');
  assert.ok(report.unresolvedRisks.includes("commit_identifier_invalid"), JSON.stringify(report.unresolvedRisks));
});
