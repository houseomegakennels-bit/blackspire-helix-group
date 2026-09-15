import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBuyerSales} from '../packages/buyer-writer/normalize.js';
import {planBuyerWrites} from '../packages/buyer-writer/plan.js';
const identity={jobId:'00000000-0000-4000-8000-000000000001',dispatchId:'00000000-0000-4000-8000-000000000002',generation:1,criteria:{property_type:'land',date_range_start:'2026-08-01',date_range_end:'2026-08-31'}};
const sale={buyer_name:'TEST LLC',seller_name:'',property_address:'TEST',mailing_address:null,sale_price:12,
  sale_date:'2026-08-01',property_type:'land',parcel_id:'1',deed_type:'TEST',lender_name:'UNKNOWN'};
const context={county:'TEST',state:'NC',property_type:'land',date_range_start:'2026-08-01',date_range_end:'2026-08-31'};

test('normalization preserves county conversion and filters while omitting authority fields',()=>{
  const normalized=normalizeBuyerSales({...context,raw_sales:[sale,{...sale,sale_date:'2026-07-31'},
    {...sale,property_type:'residential'},{...sale,buyer_name:''}]});
  assert.equal(normalized.raw.length,3);assert.equal(normalized.clean.length,1);
  assert.deepEqual(normalized.clean[0],sale);
  const stokes=normalizeBuyerSales({...context,county:'Stokes',raw_sales:[{DEED_DATE:Date.parse('2026-08-01'),
    PROPERTY_OWNER_1:'Test',PROPERTY_OWNER_2:'LLC',LAND_CLASS:'VACANT LAND',PIN:'123'}]});
  assert.equal(stokes.clean[0].buyer_name,'TEST LLC');assert.equal(stokes.clean[0].sale_price,0);
  assert.equal(stokes.clean[0].lender_name,'UNKNOWN');
  assert.equal(Object.hasOwn(stokes.clean[0],'search_job_id'),false);
  assert.equal(Object.hasOwn(stokes.clean[0],'county'),false);
});
test('write sequence is ordered, contiguous, detached and bounded by rows',()=>{
  const raw=Array.from({length:201},(_,i)=>({...sale,parcel_id:String(i)}));
  const plan=planBuyerWrites({...identity,raw,clean:raw});
  assert.deepEqual(plan.map(item=>item.operation),['raw.append','raw.append','raw.append',
    'clean.append','clean.append','clean.append','buyers.commit','complete']);
  assert.deepEqual(plan.slice(0,3).map(item=>[item.chunkIndex,item.chunkCount,item.payload.rows.length]),[[0,3,100],[1,3,100],[2,3,1]]);
  raw[0].buyer_name='CHANGED';assert.equal(plan[0].payload.rows[0].buyer_name,'TEST LLC');
});
test('multibyte large rows split by serialized byte budget before the row ceiling',()=>{
  const raw=Array.from({length:100},(_,i)=>({...sale,buyer_name:'漢'.repeat(512),seller_name:'漢'.repeat(512),
    property_address:'漢'.repeat(512),mailing_address:'漢'.repeat(512),deed_type:'漢'.repeat(512),
    lender_name:'漢'.repeat(512),parcel_id:String(i)}));
  const plan=planBuyerWrites({...identity,raw,clean:raw});
  assert.ok(plan.filter(item=>item.operation==='raw.append').length>1);
  for(const item of plan)assert.ok(Buffer.byteLength(JSON.stringify(item))+1024+(item.payload.rows?.length??0)*512<=262144);
});
test('forged provenance, duplicate sales, owner fields and invalid rows reject the whole plan',()=>{
  for(const input of [
    {raw:[sale],clean:[{...sale,sale_price:99}]},
    {raw:[sale,sale],clean:[]},
    {raw:[sale],clean:[sale,sale]},
    {raw:[{...sale,user_id:'forged'}],clean:[]},
    {raw:[{...sale,sale_date:'2026-02-30'}],clean:[]},
    {raw:[{...sale,buyer_name:'   '}],clean:[]},
    ...[NaN,Infinity,-Infinity].map(sale_price=>({raw:[{...sale,sale_price}],clean:[]})),
    {raw:[sale],clean:[]},
  ])assert.throws(()=>planBuyerWrites({...identity,...input}));
  assert.deepEqual(planBuyerWrites({...identity,raw:[],clean:[]}).map(item=>item.operation),['buyers.commit','complete']);
});

test('source ISO timestamps retain PostgreSQL calendar dates and filtering is timezone independent',()=>{
  for(const sale_date of ['2026-08-01T00:30:00+14:00','2026-08-31T23:30:00-05:00']) {
    const normalized=normalizeBuyerSales({...context,raw_sales:[{...sale,sale_date}]});
    assert.equal(normalized.clean.length,1);assert.equal(normalized.clean[0].sale_date,sale_date.slice(0,10));
    assert.doesNotThrow(()=>planBuyerWrites({...identity,...normalized}));
  }
  assert.throws(()=>normalizeBuyerSales({...context,raw_sales:[{...sale,sale_date:'2026-02-30T12:00:00Z'}]}));
  assert.throws(()=>normalizeBuyerSales({...context,raw_sales:[{...sale,sale_date:'2026-08-01T25:00:00Z'}]}));
});

test('case variants of all-property criteria preserve normalization and planning parity',()=>{
  const criteria={...context,property_type:'ALL'};
  const normalized=normalizeBuyerSales({...criteria,raw_sales:[sale,{...sale,parcel_id:'2',property_type:'residential'}]});
  assert.equal(normalized.clean.length,2);
  assert.doesNotThrow(()=>planBuyerWrites({...identity,criteria,...normalized}));
});

test('malformed source prices cannot be silently converted to zero before planning',()=>{
  for(const sale_price of [NaN,Infinity,-Infinity,'Infinity','not-a-number']) {
    assert.throws(()=>normalizeBuyerSales({...context,raw_sales:[{...sale,sale_price}]}));
  }
});
