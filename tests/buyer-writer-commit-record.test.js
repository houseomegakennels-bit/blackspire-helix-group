import test from 'node:test';
import assert from 'node:assert/strict';
import {createBuyerWriterCommitRecord,matchesBuyerWriterCommitRecord} from '../packages/buyer-writer/commit-record.js';
const fixture=()=>({value:{version:1,workspace:'isolated',releaseSha:'a'.repeat(40),apiGeneration:'b'.repeat(32),workerGeneration:'c'.repeat(32),workerAttestation:{synthetic:true}},identity:{dev:1,ino:2}});
test('commit records bind the exact approval content, inode and both service invocations',()=>{
  const binding=fixture(),record=createBuyerWriterCommitRecord(binding);
  assert.equal(matchesBuyerWriterCommitRecord(record,binding),true);assert.equal(Object.isFrozen(record),true);
  for(const mutate of [b=>{b.identity.ino=3;},b=>{b.identity.dev=2;},b=>{b.value.workerGeneration='d'.repeat(32);},b=>{b.value.workerAttestation.synthetic=false;}]){
    const other=structuredClone(binding);mutate(other);assert.equal(matchesBuyerWriterCommitRecord(record,other),false);
  }
});
test('missing, malformed, future and extra commit metadata cannot authorize a binding',()=>{
  const binding=fixture(),record=createBuyerWriterCommitRecord(binding);
  for(const value of [null,{}, {...record,version:2},{...record,extra:true},{...record,committedAt:'bad'},{...record,committedAt:'2999-01-01T00:00:00.000Z'},{...record,bindingDigest:'f'.repeat(64)}])assert.equal(matchesBuyerWriterCommitRecord(value,binding),false);
});
