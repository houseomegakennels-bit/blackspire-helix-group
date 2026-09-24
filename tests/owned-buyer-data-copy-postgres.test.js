import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {holdOwnedBuyerSourceSnapshot,transferOwnedBuyerRelation} from '../packages/buyer-writer/owned-data-copy-postgres.js';
const columns=[{name:'id',type:'uuid',required:true,generated:'',identity:''},{name:'total_spend',type:'numeric',required:false,generated:'',identity:''}];
const raw='{"id":"00000000-0000-4000-8000-000000000001","total_spend":123456789012345678901234567890.1234567890123456789}';
const expected={rowCount:1,dataDigest:createHash('sha256').update(raw+'\n').digest('hex')};
function sessions(){let fetched=false;const inserts=[],events=[];return {inserts,events,source:{processID:1,async query(sql){events.push(sql);if(sql.includes('pg_attribute'))return{rows:structuredClone(columns)};if(sql.includes('pg_export_snapshot'))return{rows:[{snapshot:'0001-0002-1'}]};if(sql.startsWith('FETCH')){if(fetched)return{rows:[]};fetched=true;return{rows:[{row:raw}]};}return{rows:[]};}},target:{processID:2,async query(sql,args){if(sql.includes('pg_attribute'))return{rows:structuredClone(columns)};inserts.push({sql,args});return{rowCount:1};}}};}
test('source snapshot owns closure SHARE locks before exporting, without source DML',async()=>{
 const f=sessions();assert.equal((await holdOwnedBuyerSourceSnapshot(f.source)).snapshotId,'0001-0002-1');
 assert.ok(f.events[0].startsWith('BEGIN ISOLATION LEVEL REPEATABLE READ'));assert.match(f.events[2],/LOCK TABLE .*exports.* IN SHARE MODE/);assert.match(f.events[3],/pg_export_snapshot/);
 assert.equal(f.events.some(sql=>/^(INSERT|UPDATE|DELETE)/.test(sql)),false);
});
test('full precision JSON text is passed untouched to PostgreSQL, with explicit IDs and no default substitution',async()=>{
 const f=sessions();assert.deepEqual(await transferOwnedBuyerRelation({...f,name:'BuyerProfile',expected,columns}),{name:'BuyerProfile',...expected});
 assert.equal(f.inserts[0].args[0],raw);assert.match(f.inserts[0].sql,/\("id","total_spend"\)/);assert.match(f.inserts[0].sql,/json_populate_record/);assert.equal(f.events.at(-1),'CLOSE owned_buyer_copy');
});
test('source digest drift, target definition drift and unsupported relations refuse',async()=>{
 let f=sessions();await assert.rejects(transferOwnedBuyerRelation({...f,name:'BuyerProfile',expected:{...expected,dataDigest:'f'.repeat(64)},columns}));
 f=sessions();f.target.query=async()=>({rows:columns.map(c=>({...c,identity:'a'}))});await assert.rejects(transferOwnedBuyerRelation({...f,name:'BuyerProfile',expected,columns}));assert.equal(f.inserts.length,0);
 f=sessions();await assert.rejects(transferOwnedBuyerRelation({...f,name:'auth.users',expected,columns}));assert.equal(f.inserts.length,0);
});
test('snapshot lock failure rolls back and exposes no driver payload',async()=>{
 const f=sessions();f.source.query=async sql=>{f.events.push(sql);if(sql.startsWith('LOCK'))throw new Error('private connection detail');return{rows:[]};};
 await assert.rejects(holdOwnedBuyerSourceSnapshot(f.source),error=>!error.message.includes('private'));assert.equal(f.events.at(-1),'ROLLBACK');
});
