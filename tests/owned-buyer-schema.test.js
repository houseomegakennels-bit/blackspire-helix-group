import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareOwnedBuyerSchema} from '../packages/buyer-writer/owned-schema.js';
const source=()=>JSON.parse(fs.readFileSync(new URL('../packages/buyer-writer/owned-source-schema.json',import.meta.url)));
test('reviewed catalog generates only six relations and minimal noncredential auth dependency',()=>{
 const result=prepareOwnedBuyerSchema(source());assert.equal(result.businessActivation,false);
 assert.equal(result.body.match(/CREATE TABLE /g).length,6);assert.equal(result.body.match(/CREATE FUNCTION /g).length,1);
 assert.equal(result.body.includes('auth.users'),false);assert.equal(result.body.includes('CREATE EXTENSION'),false);
 assert.equal(result.body.includes('LOGIN;'),true);assert.equal(result.body.includes('PASSWORD'),false);
 assert.match(result.body,/REFERENCES public."SearchJob"\(id\) ON DELETE CASCADE/);
});
test('catalog SQL injection, trigger/default/ACL/function/policy/index/closure drift all refuse',()=>{
 for(const mutate of [v=>v.relations.pop(),v=>v.relations[0].columns[0].default='evil()',v=>v.relations[0].triggers.push({definition:'evil'}),
 v=>v.relations[0].acl='changed',v=>v.authUid.definition='select dangerous()',v=>v.relations[0].policies[0].check='true; DROP TABLE x',
 v=>v.relations[0].indexes[0].definition='changed',v=>v.relations[0].columns[0].name='id";evil']){
  const value=source();mutate(value);assert.throws(()=>prepareOwnedBuyerSchema(value),/catalog drift/);
 }
});
