import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runDisposableRestoreCutover, GO_NO_GO } from '../packages/recovery/disposable-rehearsal.js';

const repository=path.resolve(import.meta.dirname,'..'); let seq=0;
const root=()=>path.join(os.tmpdir(),`blackspire-rehearsal-test-${process.pid}-${seq++}`);
const options=(overrides={})=>({repository,root:root(),environment:'disposable-staging',operatorAck:'REHEARSE-DISPOSABLE-CUTOVER',expectedCommit:'a'.repeat(40),rollbackCommit:'b'.repeat(40),now:new Date('2026-08-05T03:00:00.000Z'),backupCreatedAt:new Date('2026-08-05T02:59:00.000Z'),treeClean:true,cleanup:true,...overrides});

test('successful backup, restore, cutover, rollback, audit, and cleanup rehearsal',()=>{const input=options();const report=runDisposableRestoreCutover(input);assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');assert.equal(report.backupManifest.version,1);assert.equal(report.restoreVerificationReport.verified,true);assert.equal(report.restoreVerificationReport.integrity,'ok');assert.equal(report.restoreVerificationReport.foreignKeyViolations,0);assert.equal(report.restoreVerificationReport.rowCountsMatch,true);assert.equal(report.restoreVerificationReport.applicationReadVerified,true);assert.equal(report.cutoverRehearsalReport.productionAuthorized,false);assert.equal(report.cutoverRehearsalReport.automaticActionTaken,false);assert.equal(report.rollbackReadinessReport.verified,true);assert.equal(fs.existsSync(input.root),false);});

const cases=[
  ['corrupted_backup','NO_GO_BACKUP_INVALID'],['truncated_backup','NO_GO_BACKUP_INVALID'],['checksum_mismatch','NO_GO_BACKUP_INVALID'],['stale_backup','NO_GO_BACKUP_INVALID'],
  ['source_equals_target','NO_GO_RESTORE_INVALID'],['schema_too_old','NO_GO_SCHEMA_MISMATCH'],['schema_too_new','NO_GO_SCHEMA_MISMATCH'],['migration_failure','NO_GO_SCHEMA_MISMATCH'],
  ['partial_restore','NO_GO_RESTORE_INVALID'],['foreign_key_failure','NO_GO_RESTORE_INVALID'],['missing_required_table','NO_GO_SCHEMA_MISMATCH'],['incorrect_row_count','NO_GO_RESTORE_INVALID'],
  ['unauthorized','OPERATOR_AUTHORIZATION_REQUIRED'],['queue_not_drained','NO_GO_QUEUE_NOT_DRAINED'],['maintenance_off','NO_GO_QUEUE_NOT_DRAINED'],
  ['rollback_missing','NO_GO_ROLLBACK_TARGET_INVALID'],['rollback_mismatch','NO_GO_ROLLBACK_TARGET_INVALID'],['interrupted_cutover','NO_GO_RESTORE_INVALID'],['dirty_tree','NO_GO_RESTORE_INVALID'],
];
for(const [fault,expected] of cases)test(`${fault} fails closed as ${expected}`,()=>{const report=runDisposableRestoreCutover(options({fault}));assert.equal(report.goNoGo,expected);assert.ok(GO_NO_GO.includes(report.goNoGo));assert.equal(report.automaticActionTaken,false);});

test('wrong environment refuses before fixture creation',()=>{const report=runDisposableRestoreCutover(options({environment:'production'}));assert.equal(report.goNoGo,'NO_GO_ENVIRONMENT_MISMATCH');assert.equal(report.productionAuthorized,false);});
test('operator authorization is required when acknowledgement is absent',()=>{const report=runDisposableRestoreCutover(options({operatorAck:null}));assert.equal(report.goNoGo,'OPERATOR_AUTHORIZATION_REQUIRED');});
test('duplicate audit events and idempotent retry are suppressed',()=>{const report=runDisposableRestoreCutover(options({fault:'duplicate_audit_event'}));assert.equal(report.goNoGo,'GO_FOR_DISPOSABLE_REHEARSAL');assert.equal(report.restoreAudit.disposition,'duplicate_suppressed');assert.equal(report.cutoverAudit.disposition,'duplicate_suppressed');});
test('audit metadata redacts secret-shaped values',()=>{const report=runDisposableRestoreCutover(options({auditMetadata:'api-token=do-not-record'}));assert.equal(report.restoreAudit.record.metadata.note,'[REDACTED]');assert.doesNotMatch(JSON.stringify(report),/do-not-record/);});
test('rehearsal root refuses paths outside the temporary disposable namespace',()=>{assert.throws(()=>runDisposableRestoreCutover(options({root:'/opt/blackspire-command'})),/rehearsal root/);});
