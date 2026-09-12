import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuyerSourceAdapters } from '../frontend/src/lib/buyer-source-adapters.ts';

const job=(county,property_type='land')=>({county,state:'NC',property_type,date_range_start:'2026-01-01',date_range_end:'2026-08-31'});
const counties=['Wake','Lincoln','Forsyth','Mecklenburg','Brunswick','Orange','Beaufort','Ashe','Avery','Burke','Wilkes','Haywood','Sampson','Davie','Catawba','Edgecombe','Nash','Granville','Duplin'];
test('all 19 adapters retain empty-result termination, source selection and GET/form transport',async()=>{
  for(const county of counties) {
    const calls=[];let resolutions=0;
    const transport={
      resolveSource:async(c,s)=>{resolutions++;assert.equal(c,county);assert.equal(s,'NC');return{source_url:'https://source.example.invalid/MapServer/0'};},
      getJson:async(url,timeout)=>{calls.push({method:'GET',url,params:new URL(url).searchParams,timeout});return{features:[]};},
      postFormJson:async(url,params,timeout)=>{calls.push({method:'POST',url,params,timeout});return{features:[]};},
      postForsythJson:async()=>assert.fail('empty result must not fetch parcels'),
    };
    assert.deepEqual(await createBuyerSourceAdapters(transport).prefetch(job(county)),[]);
    assert.equal(resolutions,1);assert.equal(calls.length,1);
    assert.equal(calls[0].method,['Wake','Lincoln','Nash','Mecklenburg'].includes(county)?'POST':'GET');
    assert.equal(calls[0].params.get('f'),'json');assert.equal(calls[0].params.get('returnGeometry'),'false');
    assert.ok(calls[0].timeout<=30000);
  }
});
test('unsupported county and non-land Wake/Lincoln return null without resolving or fetching',async()=>{
  const denied=async()=>assert.fail('no adapter should access a source');
  const adapters=createBuyerSourceAdapters({resolveSource:denied,getJson:denied,postFormJson:denied,postForsythJson:denied});
  for(const input of [job('Guilford'),job('Wake','residential'),job('Lincoln','residential')])assert.equal(await adapters.prefetch(input),null);
});
test('Ashe mapping retains raw attributes but overrides provider source markers',async()=>{
  const row={OWNER_NAME:'SYNTHETIC',_source_type:'forged',_no_cash_data:false};
  const adapters=createBuyerSourceAdapters({resolveSource:async()=>({source_url:'https://source.example.invalid/query'}),
    getJson:async()=>({features:[{attributes:row}]}),postFormJson:async()=>assert.fail(),postForsythJson:async()=>assert.fail()});
  assert.deepEqual(await adapters.prefetch(job('Ashe')),[{...row,_source_type:'arcgis_ashe',_no_cash_data:true}]);
});
test('Forsyth lookup retains PIN formatting and owner mapping, and injected failures propagate',async()=>{
  let pin;
  const transport={resolveSource:async()=>({source_url:'https://source.example.invalid/query'}),
    getJson:async()=>({features:[{attributes:{XFER_PIN:'1234567890.0',XFER_XFERDATE:1785542400000,XFER_SALEPRICE:100}}]}),
    postFormJson:async()=>assert.fail(),postForsythJson:async(value)=>{pin=value;return{primaryOwnerName:'SYNTHETIC OWNER',mailingAddress1:'TEST ONLY'};}};
  const rows=await createBuyerSourceAdapters(transport).prefetch(job('Forsyth'));
  assert.equal(pin,'1234-56-7890');assert.equal(rows.length,1);assert.equal(rows[0].CURRENTOWNERNAME1,'SYNTHETIC OWNER');
  assert.equal(rows[0]._source_type,'arcgis_forsyth');
  await assert.rejects(createBuyerSourceAdapters({...transport,postForsythJson:async()=>{throw new Error('bounded source failed');}}).prefetch(job('Forsyth')),/bounded source failed/);
});
test('Mecklenburg fallback is explicit and source resolution errors cannot become missing configuration',async()=>{
  let target;
  const transport={resolveSource:async()=>null,getJson:async()=>assert.fail(),postForsythJson:async()=>assert.fail(),
    postFormJson:async(url)=>{target=url;return{features:[]};}};
  assert.deepEqual(await createBuyerSourceAdapters(transport).prefetch(job('Mecklenburg')),[]);
  assert.equal(target,'https://gis.charlottenc.gov/arcgis/rest/services/CLT_Ex/CLTEx_MoreInfo/MapServer/4/query');
  await assert.rejects(createBuyerSourceAdapters({...transport,resolveSource:async()=>{throw new Error('registry unavailable');}}).prefetch(job('Mecklenburg')),/registry unavailable/);
});
