import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {hash} from '../packages/zola-release/commander-journal.js';
import {inspectFinalReleaseRecord,writeAcceptedHeldReleaseRecord,writeOpenReleaseRecord} from '../packages/zola-release/final-release-record.js';

const a='a'.repeat(40),b='b'.repeat(40),d=value=>hash(value);
const owner=process.getuid();
const accepted=()=>({schema:1,kind:'zola_release_accepted_held',releaseSha:a,previousMainSha:'c'.repeat(40),newMainSha:b,
 operationId:'11111111-1111-4111-8111-111111111111',attemptId:'66666666-6666-4666-8666-666666666666',stageInputDigest:d('stage-input'),checkOutputDigest:d('check'),sequenceInputDigest:d('input'),registryDigest:d('registry'),acceptedStagesDigest:d('stages'),
 epochRunId:'22222222-2222-4222-8222-222222222222',permitId:'33333333-3333-4333-8333-333333333333',permitDigest:d('permit'),
 apiGeneration:'44444444-4444-4444-8444-444444444444',workerGeneration:'55555555-5555-4555-8555-555555555555',
 rollbackAcceptanceDigest:d('rollback'),acceptedAt:'2026-09-11T16:00:00.000Z'});
function root(){const value=fs.mkdtempSync(path.join(os.tmpdir(),'zola-record-'));fs.chmodSync(value,0o700);return value;}

test('accepted HELD and OPEN are separate immutable records',()=>{const directory=root(),held=accepted();
 const first=writeAcceptedHeldReleaseRecord({record:held,root:directory,owner});assert.equal(first.replayed,false);assert.equal(inspectFinalReleaseRecord({releaseSha:a,root:directory,owner}).phase,'ACCEPTED_HELD');
 assert.equal(writeAcceptedHeldReleaseRecord({record:held,root:directory,owner}).replayed,true);
 const opened={schema:1,kind:'zola_release_open',releaseSha:a,newMainSha:b,operationId:held.operationId,attemptId:'77777777-7777-4777-8777-777777777777',stageInputDigest:d('open-input'),checkOutputDigest:d('open-check'),acceptedRecordDigest:hash(held),openAdmissionDigest:d('open'),openedAt:'2026-09-11T16:01:00.000Z'};
 assert.equal(writeOpenReleaseRecord({record:opened,root:directory,owner}).replayed,false);assert.equal(inspectFinalReleaseRecord({releaseSha:a,root:directory,owner}).phase,'OPEN');
 assert.equal(fs.statSync(first.file).mode&0o777,0o600);
});
test('record collision and OPEN without matching acceptance fail closed',()=>{const directory=root(),held=accepted();writeAcceptedHeldReleaseRecord({record:held,root:directory,owner});
 assert.throws(()=>writeAcceptedHeldReleaseRecord({record:{...held,acceptedAt:'2026-09-11T16:00:01.000Z'},root:directory,owner}));
 assert.throws(()=>writeOpenReleaseRecord({record:{schema:1,kind:'zola_release_open',releaseSha:a,newMainSha:b,operationId:held.operationId,attemptId:'77777777-7777-4777-8777-777777777777',stageInputDigest:d('open-input'),checkOutputDigest:d('open-check'),acceptedRecordDigest:d('wrong'),openAdmissionDigest:d('open'),openedAt:'2026-09-11T16:01:00.000Z'},root:directory,owner}));
});
test('an orphaned partial temporary file cannot block or become a final record',()=>{const directory=root(),held=accepted(),final=path.join(directory,`${a}.accepted-held.json`),pending=`${final}.crashed.pending`;
 fs.writeFileSync(pending,'{',{mode:0o600});assert.equal(writeAcceptedHeldReleaseRecord({record:held,root:directory,owner}).replayed,false);assert.equal(inspectFinalReleaseRecord({releaseSha:a,root:directory,owner}).phase,'ACCEPTED_HELD');assert.equal(fs.readFileSync(pending,'utf8'),'{');
});
test('resume repairs a crash between atomic link publication and temporary unlink',()=>{const directory=root(),held=accepted(),final=path.join(directory,`${a}.accepted-held.json`),pending=`${final}.crashed.pending`;
 fs.writeFileSync(pending,JSON.stringify(held)+'\n',{mode:0o600});fs.linkSync(pending,final);assert.equal(fs.statSync(final).nlink,2);
 assert.equal(writeAcceptedHeldReleaseRecord({record:held,root:directory,owner}).replayed,true);assert.equal(fs.statSync(final).nlink,1);assert.equal(fs.existsSync(pending),false);
});
test('tamper and permissive directory are rejected',()=>{const directory=root(),held=accepted(),result=writeAcceptedHeldReleaseRecord({record:held,root:directory,owner});
 fs.appendFileSync(result.file,' ');assert.throws(()=>inspectFinalReleaseRecord({releaseSha:a,root:directory,owner}));
 const unsafe=root();fs.chmodSync(unsafe,0o755);assert.throws(()=>writeAcceptedHeldReleaseRecord({record:held,root:unsafe,owner}));
});
