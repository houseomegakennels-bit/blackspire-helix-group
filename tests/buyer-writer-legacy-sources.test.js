import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchRemainingBuyerSources } from '../packages/buyer-writer/legacy-sources.js';
const job={county:'Guilford',state:'NC',property_type:'residential',date_range_start:'2026-01-01',date_range_end:'2026-08-31'};
const source={registryUrl:'https://source.example.invalid/query?where=existing&outFields=OWNER&f=pjson',registeredSourceType:'arcgis_guilford',sourceType:'arcgis_guilford',cashDisabled:false};
test('remaining branch precedence, source query filters and bounded empty termination',async()=>{
  for(const [county,type,field]of [['Guilford','arcgis_guilford','PKG_SALE_DATE'],['Wake','arcgis_wake','SALE_DATE'],
    ['Stanly','arcgis','DateSold'],['Stokes','arcgis','DEED_DATE'],['Chowan','arcgis','saledate'],['Lincoln','arcgis','AMDTSL']]) {
    const calls=[];const result=await fetchRemainingBuyerSources({job:{...job,county},sources:[{...source,registeredSourceType:type,sourceType:type}],
      request:async(s,url,limit)=>{calls.push({s,url:new URL(url),limit});return{features:[]};},maxRows:50000});
    assert.deepEqual(result,[]);assert.equal(calls.length,1);assert.equal(calls[0].limit,1000);
    assert.ok(calls[0].url.searchParams.get('where').includes(field));assert.equal(calls[0].url.searchParams.get('resultOffset'),'0');
    assert.equal(calls[0].url.hostname==='services6.arcgis.com',county==='Stanly');
  }
});
test('paged results preserve attributes/properties/feature mapping, source order and authoritative markers',async()=>{
  const sources=[source,{...source,cashDisabled:true}];let calls=0;
  const result=await fetchRemainingBuyerSources({job,sources,maxRows:10,request:async()=>{calls++;return{features:[
    {attributes:{name:'A',_source_type:'forged'}},{properties:{name:'B'}},{name:'C'}]};}});
  assert.equal(calls,2);assert.deepEqual(result.map(r=>r.name),['A','B','C','A','B','C']);
  assert.ok(result.every(r=>r._source_type==='arcgis_guilford'));assert.deepEqual(result.map(r=>r._no_cash_data),[false,false,false,true,true,true]);
});
test('generic fetch preserves configured query meaning while overriding only legacy response caps',async()=>{
  for(const body of [[{name:'A'}],{features:[{attributes:{name:'A'}}]},{data:[{name:'A'}]},{results:[{name:'A'}]}]) {
    let query;
    const result=await fetchRemainingBuyerSources({job:{...job,county:'Robeson'},sources:[{...source,sourceType:'arcgis',registeredSourceType:'arcgis'}],maxRows:10,
      request:async(s,url,limit)=>{query=new URL(url).searchParams;assert.equal(limit,500);return body;}});
    assert.equal(query.get('where'),'existing');assert.equal(query.get('outFields'),'OWNER');assert.equal(query.get('f'),'json');
    assert.equal(query.get('resultRecordCount'),'500');assert.equal(query.get('returnGeometry'),'false');assert.equal(result[0].name,'A');
  }
});
test('missing, malformed, oversized and failed sources never return partial success',async()=>{
  for(const body of [{},{features:null},{features:[null]},{features:[{attributes:'bad'}]},{error:{}},[1]]) {
    await assert.rejects(fetchRemainingBuyerSources({job,sources:[source],maxRows:10,request:async()=>body}));
  }
  await assert.rejects(fetchRemainingBuyerSources({job,sources:[source],maxRows:1,request:async()=>({features:[{name:'A'},{name:'B'}]})}),{code:'SOURCE_BUDGET_EXCEEDED'});
  let calls=0;await assert.rejects(fetchRemainingBuyerSources({job,sources:[source,source],maxRows:10,request:async()=>{
    if(++calls===2)throw new Error('synthetic failure');return{features:[{name:'A'}]};
  }}));assert.equal(calls,2);
});
