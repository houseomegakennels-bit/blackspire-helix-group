// Real fault/mutation coverage for the disposable restore-cutover rehearsal.
//
// Each mutant textually perturbs the SHIPPED module source, writes the perturbed source to a
// throwaway module OUTSIDE the repository (under the system temporary directory), imports it, and
// runs the scenario the guard is supposed to catch. A mutant is KILLED only when the observed
// classification actually CHANGES from the NO_GO baseline to GO. Nothing here is asserted from a
// literal table; every entry below is an observed behavioural difference.
//
// The shipped file is never modified: it is read, and its digest is re-verified after every
// mutant to prove byte-identity.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
process.env.BLACKSPIRE_REHEARSAL_FAULT_INJECTION='1';

const repository=path.resolve(import.meta.dirname,'..');
const modulePath=path.join(repository,'packages/recovery/disposable-rehearsal.js');
const original=fs.readFileSync(modulePath,'utf8');
const originalDigest=crypto.createHash('sha256').update(original).digest('hex');
let seq=0;
const root=()=>path.join(os.tmpdir(),`blackspire-rehearsal-mut-${process.pid}-${seq++}`);
// Mutant modules are written OUTSIDE the repository. Writing them next to the shipped module left
// untracked files inside the TRACKED packages/recovery/ directory for the duration of the run, and
// a dirty working tree makes the clean-tree escape hatch in disposable-restore-cutover.test.js
// return early, silently skipping that test's `exit 0`, GO and ageMs assertions whenever both files
// run in one `--test` invocation. It also perturbs any other dirty-tree/release/secret-scan check
// running concurrently on the same checkout.
const mutantDir=path.join(os.tmpdir(),`blackspire-rehearsal-mutants-${process.pid}`);
after(()=>{fs.rmSync(mutantDir,{recursive:true,force:true});});
// Relocating the module out of the package directory breaks its RELATIVE imports, so each relative
// specifier is rewritten to an absolute file: URL resolved against the SHIPPED module's directory.
// The rewrite is applied AFTER the perturbation, so the mutation itself still targets the verbatim
// shipped text, and it is asserted to have matched at least one specifier so a future import can
// never be silently left unresolved.
const RELATIVE_IMPORT=/(\bfrom\s*)(['"])(\.{1,2}\/[^'"]*)\2/g;
function relocate(source){
  let rewritten=0;
  const out=source.replace(RELATIVE_IMPORT,(_match,prefix,quote,specifier)=>{
    rewritten+=1;
    return `${prefix}${quote}${pathToFileURL(path.resolve(path.dirname(modulePath),specifier)).href}${quote}`;
  });
  assert.ok(rewritten>0,'expected at least one relative import specifier to be rewritten');
  return out;
}
const options=(overrides={})=>({repository,root:root(),environment:'disposable-staging',operatorAck:'REHEARSE-DISPOSABLE-CUTOVER',expectedCommit:'a'.repeat(40),rollbackCommit:'b'.repeat(40),now:new Date('2026-08-05T03:00:00.000Z'),treeClean:true,cleanup:true,...overrides});

// Two honest outcomes count as a kill, and they are reported separately rather than merged:
//   'go'        - removing the expression reaches GO, so it is SOLELY load-bearing for that fault.
//   'redundant' - removing it changes the classification, but an independent guard outside this
//                 module (scripts/restore.js) still fails closed. Recorded with the observed value
//                 so the inventory never overstates what this module alone detects.
// A mutant whose classification does NOT change at all is a survivor and fails the suite.
//
// [name, source fragment, replacement, scenario, baseline classification, expected kill mode]
const MUTANTS=[
  // restore.js:60 re-verifies the sidecar, so this module's check is defence in depth, not the sole guard.
  ['checksum','backupOk &&= expectedSidecar===backupManifest.backupSha256;','backupOk &&= true;',{fault:'checksum_mismatch'},'NO_GO_BACKUP_INVALID','redundant'],
  ['backup_age','let backupOk = ageMs >= 0 && ageMs <= MAX_BACKUP_AGE_MS;','let backupOk = true;',{fault:'stale_backup'},'NO_GO_BACKUP_INVALID','go'],
  ['environment',"const environmentOk = ['test','disposable-staging'].includes(environment) && fault !== 'wrong_environment';",'const environmentOk = true;',{environment:'production'},'NO_GO_ENVIRONMENT_MISMATCH','go'],
  ['authorization','const authorized = operatorAck === ACK && fault !== \'unauthorized\';','const authorized = true;',{operatorAck:null},'OPERATOR_AUTHORIZATION_REQUIRED','go'],
  // DELIBERATELY NOT IN THE INVENTORY: `sourceTargetDistinct`. It now genuinely participates in
  // classification() and the `source_equals_target` fault genuinely aliases the target to the
  // SOURCE database, but removing the check yields the SAME classification, because
  // scripts/restore.js:44 independently refuses `target === BLACKSPIRE_DB_PATH` with the same
  // NO_GO_RESTORE_INVALID outcome. The mutant is measurably indistinguishable, so no coverage is
  // claimed for it here. See the `source_equals_target` case in disposable-restore-cutover.test.js
  // for the behavioural assertion that the alias is refused.
  ['schema_fingerprint','const schemaOk=backupManifest.schemaFingerprint===sourceReport.schemaFingerprint && (!targetReport || targetReport.schemaFingerprint===sourceReport.schemaFingerprint);','const schemaOk=true;',{fault:'schema_drift'},'NO_GO_SCHEMA_MISMATCH','go'],
  // `corrupted_target_index` stales an index b-tree on the RESTORED target after the checksum stage,
  // leaving fingerprint, required objects, row counts and the application read all intact, so
  // `PRAGMA integrity_check` is the sole guard that can see it.
  ['target_integrity',"targetReport.integrity==='ok' && ",'',{fault:'corrupted_target_index'},'NO_GO_RESTORE_INVALID','go'],
  ['row_counts',' && JSON.stringify(targetReport.rowCounts)===JSON.stringify(sourceReport.rowCounts);',';',{fault:'extra_row_in_target'},'NO_GO_RESTORE_INVALID','go'],
  ['application_read','restoreOk &&= applicationRead;','',{fault:'corrupted_row_payload'},'NO_GO_RESTORE_INVALID','go'],
  ['queue_drain',"queueDrained=Number(targetDb.prepare(\"SELECT COUNT(*) AS n FROM tasks WHERE status IN ('queued','planning','running','validating')\").get().n)===0;",'queueDrained=true;',{fault:'queue_not_drained'},'NO_GO_QUEUE_NOT_DRAINED','go'],
  ['maintenance_mode','maintenanceMode=targetDb.prepare("SELECT value FROM system_flags WHERE key=\'maintenance_mode\'").get()?.value===\'active\';','maintenanceMode=true;',{fault:'maintenance_off'},'NO_GO_QUEUE_NOT_DRAINED','go'],
  ['rollback_target',"const rollbackOk=SHA.test(rollbackCommit)&&rollbackCommit!==expectedCommit&&fs.existsSync(path.join(release,'.release-complete'))&&fs.readFileSync(path.join(release,'COMMIT_SHA'),'utf8').trim()===rollbackCommit;",'const rollbackOk=true;',{fault:'rollback_missing'},'NO_GO_ROLLBACK_TARGET_INVALID','go'],
  ['dirty_tree',"if (!treeClean || fault === 'dirty_tree') { risks.push('working_tree_not_clean'); return refusal('NO_GO_RESTORE_INVALID', risks); }",'',{treeClean:false},'NO_GO_RESTORE_INVALID','go'],
];

async function withMutant(fragment,replacement,run){
  assert.ok(original.includes(fragment),`mutation target not found verbatim: ${fragment.slice(0,60)}`);
  assert.equal(original.split(fragment).length,2,`mutation target is not unique: ${fragment.slice(0,60)}`);
  fs.mkdirSync(mutantDir,{recursive:true,mode:0o700});
  const file=path.join(mutantDir,`mutant-${process.pid}-${seq++}.mjs`);
  fs.writeFileSync(file,relocate(original.replace(fragment,replacement)),{mode:0o600});
  try{ return await run(await import(pathToFileURL(file).href)); }
  finally{
    fs.rmSync(file,{force:true});
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modulePath,'utf8')).digest('hex'),originalDigest,'shipped module was modified');
  }
}

test('every declared guard is killed by a real mutant',async(t)=>{
  const killedToGo=[]; const killedRedundant=[]; const surviving=[];
  const { runDisposableRestoreCutover }=await import(pathToFileURL(modulePath).href);
  for(const [name,fragment,replacement,scenario,baseline,mode] of MUTANTS){
    await t.test(name,async()=>{
      // 1. Unmutated module must produce the NO_GO baseline for this scenario.
      assert.equal(runDisposableRestoreCutover(options(scenario)).goNoGo,baseline,`${name}: baseline`);
      // 2. Mutated module must behave differently, proving the expression is load-bearing.
      const mutated=await withMutant(fragment,replacement,(mod)=>mod.runDisposableRestoreCutover(options(scenario)).goNoGo);
      if(mutated==='GO_FOR_DISPOSABLE_REHEARSAL')killedToGo.push(name);
      else if(mutated!==baseline)killedRedundant.push({guard:name,observed:mutated});
      else surviving.push({guard:name,observed:mutated});
      assert.notEqual(mutated,baseline,`${name}: mutant survived unchanged as ${mutated}`);
      if(mode==='go')assert.equal(mutated,'GO_FOR_DISPOSABLE_REHEARSAL',`${name}: expected a sole-guard kill`);
      else assert.notEqual(mutated,'GO_FOR_DISPOSABLE_REHEARSAL',`${name}: expected a redundant kill`);
    });
  }
  const report={killedToGo,killedRedundant,surviving};
  assert.equal(report.surviving.length,0);
  assert.equal(report.killedToGo.length,MUTANTS.filter((m)=>m[5]==='go').length);
  assert.equal(report.killedRedundant.length,MUTANTS.filter((m)=>m[5]==='redundant').length);
  assert.equal(report.killedToGo.length+report.killedRedundant.length,MUTANTS.length);
  console.log(JSON.stringify({kind:'restore-cutover-mutation-report',soleGuardKills:killedToGo.length,redundantKills:killedRedundant.length,surviving:surviving.length,...report}));
});

test('audit redaction is load-bearing: removing it leaks the secret-shaped value',async()=>{
  const scenario={auditMetadata:'api-token=do-not-record'};
  const { runDisposableRestoreCutover }=await import(pathToFileURL(modulePath).href);
  assert.doesNotMatch(JSON.stringify(runDisposableRestoreCutover(options(scenario))),/do-not-record/);
  const leaked=await withMutant(
    "const safeReason = (value) => SECRET.test(String(value)) ? '[REDACTED]' : String(value).slice(0, 240);",
    'const safeReason = (value) => String(value).slice(0, 240);',
    (mod)=>JSON.stringify(mod.runDisposableRestoreCutover(options(scenario))),
  );
  assert.match(leaked,/do-not-record/,'redaction mutant survived');
});

test('the shipped module is byte-identical after all mutants',()=>{
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(modulePath,'utf8')).digest('hex'),originalDigest);
  // No mutant artifact was ever placed in the tracked package directory, and none is left behind in
  // the temporary mutant directory either.
  assert.deepEqual(fs.readdirSync(path.dirname(modulePath)).filter((n)=>n.includes('mutant')),[]);
  assert.deepEqual(fs.existsSync(mutantDir)?fs.readdirSync(mutantDir):[],[]);
});
