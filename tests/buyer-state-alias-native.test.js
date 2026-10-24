import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
import {createBuyerStoreRepository} from '../packages/buyer-store/repository.js';
const geo=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/buyer-geography.ts','utf8')).replaceAll('export ','')+'\n({STATE_NAMES,buyerStateAliases})');
const criteria={county:'Union County',state:'NC',buyerName:null,propertyType:null,cashBuyer:null,llcBuyer:null,limit:200};
function fixture({fail=false}={}){
 const reads=[];
 const repository=createBuyerStoreRepository({connect:async()=>{throw Error('unexpected user connection')},connectCapability:async()=>({
  async query(sql,args){
   if(sql==='SELECT current_user,session_user')return {rows:[{current_user:'buyer_capability_login',session_user:'buyer_capability_login'}]};
   if(sql.includes('FROM public."BuyerProfile" p WHERE')){
    reads.push({sql,args});assert.match(sql,/lower\(btrim\(p.state\)\)=ANY\(\$2::text\[\]\)/);
    if(fail)throw Error('synthetic query unavailable');
    const rows=[{id:'nc',county:'Union',state:'NC'},{id:'full',county:'Union County',state:'North Carolina'},{id:'sc',county:'Union',state:'South Carolina'},{id:'substring',county:'Unionville',state:'NC'}].filter(row=>(args[0]===null||row.county.toLowerCase().replace(/\s+county$/,'')===args[0])&&(args[1]===null||args[1].includes(row.state.toLowerCase())));
    return {rows:sql.includes('count(*)')?[{n:rows.length}]:rows};
   }
   return {rows:[]};
  },async end(){}
 })});
 return {repository,reads};
}
test('native rows and count bind the same exact county and state alias set',async()=>{
 const f=fixture();const result=await f.repository.readCapabilityProfiles(criteria);
 assert.equal(result.count,2);assert.deepEqual(result.rows.map(row=>row.id),['nc','full']);assert.equal(f.reads.length,2);
 for(const query of f.reads){assert.equal(query.args[0],'union');assert.deepEqual(query.args[1],['nc','north carolina'])}
});
test('native accepts every supported full state name and matches frontend aliases',async()=>{
 for(const [name,code] of Object.entries(geo.STATE_NAMES)){
  const f=fixture();await f.repository.readCapabilityProfiles({...criteria,county:null,state:name});
  const expected=Array.from(geo.buyerStateAliases(code),value=>value.toLowerCase());
  assert.deepEqual(f.reads[0].args[1],expected);assert.deepEqual(f.reads[1].args[1],expected);
 }
});
test('native unknown state and placeholder county criteria fail rather than claim zero',async()=>{
 for(const state of ['Atlantis','Unknown','%']){
  const f=fixture();await assert.rejects(f.repository.readCapabilityProfiles({...criteria,state}),/BUYER_STORE_REFUSED/);assert.equal(f.reads.length,0);
 }
 for(const county of ['Unknown','Not captured','Not entered','TBD','%']){
  const f=fixture();await assert.rejects(f.repository.readCapabilityProfiles({...criteria,county}),/BUYER_STORE_REFUSED/);assert.equal(f.reads.length,0);
 }
});
test('generic profile reads with null geography retain the existing operation',async()=>{
 const f=fixture();const result=await f.repository.readCapabilityProfiles({...criteria,county:null,state:null});
 assert.equal(result.count,4);assert.equal(f.reads[0].args[0],null);assert.equal(f.reads[0].args[1],null);
});
test('native query failures return unavailable instead of a false empty set',async()=>{
 await assert.rejects(fixture({fail:true}).repository.readCapabilityProfiles(criteria),/BUYER_STORE_REFUSED/);
});
