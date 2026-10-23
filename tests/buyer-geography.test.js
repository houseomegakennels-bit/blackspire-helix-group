import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const source=fs.readFileSync('frontend/src/lib/buyer-engine-server.ts','utf8');
const geoSource=fs.readFileSync('frontend/src/lib/buyer-geography.ts','utf8');
const names='normalizeBuyerState,buyerStateAliases,normalizeCountyName,resolveBuyerCounty,buyerGeographyMatches,buyerCountyFilter,inferNcCountyFromCity,stateFromAddress';
const geo=vm.runInNewContext(stripTypeScriptTypes(geoSource).replaceAll('export ', '')+'\n({'+names+'})');
const start=source.indexOf('export async function matchBuyersForProperty(');
const body=stripTypeScriptTypes(source.slice(start,source.indexOf('\nconst getCachedCountyCapabilities',start))).replace('export ','');
const row=(id,county,state)=>({id,buyer_name:id,county,state,purchase_count:5,last_purchase_date:null,score:50});
function fixture({rows=[row('nc','Union','NC'),row('suffix','Union County','NC'),row('ncfull','Union','North Carolina'),row('scfull','Union','South Carolina'),row('sc','Union','SC'),row('substring','Unionville','NC')],fail=null,owned=false,registryFail=false,foreignResult=false}={}){
 const queries=[],ownedCalls=[];let writes=0;
 const registry=[{id:'inc',canonicalName:'NC Group',states:['NC'],counties:['Union'],active:true},{id:'isc',canonicalName:'SC Group',states:['SC'],counties:['Union'],active:true},{id:'unknown',canonicalName:'Unscoped Group',states:[],counties:['Union'],active:true}];
 const client={from(table){assert.equal(table,'BuyerProfile');let county,state,head=false;const q={
 select(_,options){head=Boolean(options?.head);return q},
 ilike(key,value){assert.ok(['county','state'].includes(key));assert.doesNotMatch(value, /[%_]/, 'geography filters never use wildcard substrings');if(key==='county')county=value;else state=value;return q},
 order(){return q},limit(){return q},
 insert(){writes++;throw Error('write')},upsert(){writes++;throw Error('write')},
 then(resolve,reject){queries.push({county,state,head});let found=rows.filter(r=>(county===undefined||r.county?.toLowerCase()===county?.toLowerCase())&&(state===undefined||r.state?.toLowerCase()===state?.toLowerCase()));if(foreignResult&&!head&&county==='union')found=[row('foreign','Union','SC')];return Promise.resolve({data:head?null:found,count:head?found.length:null,error:fail===(head?'count':'rows')?{}:null}).then(resolve,reject)}
 };return q}};
 const match=vm.runInNewContext(body+'\nmatchBuyersForProperty',{
 ...geo,getSupabaseAdmin:()=>client,ownedBuyerStoreEnabled:()=>owned,
 buyerStoreRequest:async(operation,input)=>{ownedCalls.push({operation,input});if(fail)throw Error('offline');const found=rows.filter(r=>geo.buyerGeographyMatches(r.county,r.state,input.county,input.state));return {rows:found,count:found.length}},
 resolvePropertyTypeBucket:()=> 'residential',scoreBuyerProfile:()=>({score:70,reasons:['Synthetic history']}),classifyBuyerType:()=> 'investor',
 listBuyerGroupRegistry:async(_,options)=>{assert.equal(options.readOnly,true);if(registryFail)throw Error('registry down');return registry}
 });
 return {match,queries,ownedCalls,writes:()=>writes,client};
}
test('state gates city inference; Greenville SC and missing state never become Pitt NC',()=>{
 assert.equal(geo.inferNcCountyFromCity('Greenville','NC'),'Pitt');
 assert.equal(geo.inferNcCountyFromCity('Greenville','North Carolina'),'Pitt');
 assert.equal(geo.inferNcCountyFromCity('Greenville','SC'),null);
 assert.equal(geo.inferNcCountyFromCity('Greenville'),null);
 assert.equal(geo.resolveBuyerCounty(null,'Mystery City','NC').core,'');
 for(const city of ['High Point','Durham','Raleigh','Cary','Chapel Hill','Burlington','Huntersville','Apex','New Bern','Sanford','Garner','Thomasville'])assert.equal(geo.inferNcCountyFromCity(city,'NC'),null,'unreviewed or multi-county city needs evidence: '+city);
});
test('exact county normalization rejects placeholders and wildcard filters',()=>{
 assert.equal(geo.normalizeCountyName('Union County'),'union');
 assert.equal(geo.normalizeCountyName('Unionville'),'unionville');
 for(const county of ['%','_','n/a','unknown','County',''])assert.equal(geo.normalizeCountyName(county),'');
 assert.throws(()=>geo.buyerCountyFilter('%'),/not evaluated/);
 assert.equal(geo.normalizeBuyerState('California'),'CA');
 assert.equal(geo.normalizeBuyerState('unknown'),null);
 assert.equal(geo.stateFromAddress('10 Example St, Greenville, NC, 27834'),'NC');
});
for(const owned of [false,true])test('same-name counties require state in rows, counts and institutional groups; owned='+owned,async()=>{
 const f=fixture({owned});const result=await f.match({county:'Union County',state:'NC'});
 assert.equal(result.evaluation,'evaluated');assert.equal(result.buyerCount,3);
 assert.deepEqual(Array.from(result.matches,m=>m.buyerId),['nc','ncfull','suffix','inc']);
 assert.equal(f.writes(),0);
 if(owned){assert.equal(f.ownedCalls.length,1);assert.equal(f.ownedCalls[0].input.state,'NC');assert.equal(f.ownedCalls[0].input.county,'union')}
 else {assert.equal(f.queries.length,8);assert.ok(f.queries.every(q=>['NC','north carolina'].includes(q.state)&&['union','union County'].includes(q.county)));assert.equal(f.queries.filter(q=>q.head).length,4)}
});
test('Greenville SC explicit county does not select NC Pitt buyers',async()=>{
 const f=fixture({rows:[row('pitt','Pitt','NC'),row('sc','Greenville','SC')]});const r=await f.match({city:'Greenville',county:'Greenville',state:'SC'});
 assert.equal(r.evaluation,'evaluated');assert.equal(r.buyerCount,1);assert.deepEqual(Array.from(r.matches,m=>m.buyerId),['sc']);
});
test('unknown geography performs no profile reads and exposes nulls, never zero demand',async()=>{
 const f=fixture();for(const input of [{county:'Union'},{city:'Greenville',state:'SC'},{city:'Mystery',state:'NC'},{county:'Unknown',state:'NC'}]){
 const result=await f.match(input);assert.equal(result.evaluation,'not_evaluated');assert.equal(result.buyerCount,null);assert.equal(result.demandScore,null);assert.equal(result.assignmentPotential,null)}
 assert.equal(f.queries.length,0);
});
for(const failure of [{fail:'rows'},{fail:'count'},{registryFail:true},{owned:true,fail:'offline'},{foreignResult:true}])test('failed source is not evaluated '+JSON.stringify(failure),async()=>{
 const f=fixture(failure),r=await f.match({county:'Union',state:'NC'});assert.equal(r.evaluation,'not_evaluated');assert.equal(r.buyerCount,null);assert.equal(r.demandScore,null);
});
test('successfully evaluated empty market is distinct from unavailable',async()=>{
 const r=await fixture({rows:[]}).match({county:'Pitt',state:'NC'});assert.equal(r.evaluation,'evaluated');assert.equal(r.buyerCount,0);assert.equal(r.demandScore,0);
});
test('authority-owned profiles with foreign rows cannot lend an unscoped count',async()=>{
 const f=fixture();const r=await f.match({county:'Union',state:'NC'},{ownedProfiles:{rows:[row('foreign','Union','SC')],count:100}});
 assert.equal(r.evaluation,'not_evaluated');assert.equal(r.buyerCount,null);
});
test('read-only capability fails unavailable instead of disclosing zero for missing state',async()=>{
 const f=fixture();await assert.rejects(f.match({county:'Union'},{readOnly:true,readClient:f.client}),/not evaluated/i);
});


const capabilityStart=source.indexOf('export async function listBuyerProfilesForCapability(');
const capabilityBody=stripTypeScriptTypes(source.slice(capabilityStart,source.indexOf('\nfunction classifyBuyerType',capabilityStart))).replace('export ','');
const profileLookup=vm.runInNewContext(capabilityBody+'\nlistBuyerProfilesForCapability',{...geo,getEnvState:()=>({enabled:true})});
test('capability profile lookup includes state names and codes with exact county aliases',async()=>{
 const f=fixture();const rows=await profileLookup({state:'North Carolina',county:'Union County',limit:20},f.client);
 assert.deepEqual(Array.from(rows,row=>row.id),['nc','ncfull','suffix']);
 assert.equal(f.queries.length,4);
 assert.ok(f.queries.every(q=>['NC','north carolina'].includes(q.state)&&['union','union County'].includes(q.county)));
});
test('a name-only persisted state is not reported as an empty profile universe',async()=>{
 const f=fixture({rows:[row('full-name-only','Union','North Carolina')]});
 const result=await f.match({state:'NC',county:'Union'});
 assert.equal(result.evaluation,'evaluated');assert.equal(result.buyerCount,1);assert.equal(result.matches[0].buyerId,'full-name-only');
});
test('capability unknown geography and failed alias reads are unavailable, never a false empty result',async()=>{
 const f=fixture();await assert.rejects(profileLookup({county:'Union',limit:20},f.client),/not evaluated/);assert.equal(f.queries.length,0);
 const failed=fixture({fail:'rows'});await assert.rejects(profileLookup({county:'Union',state:'NC',limit:20},failed.client),/unavailable/);
});

test('alias merging retains database nulls-last order instead of treating unknown purchase count as zero',async()=>{
 const f=fixture({rows:[{...row('z-known-zero','Union','NC'),purchase_count:0},{...row('a-unknown','Union','North Carolina'),purchase_count:null}]});
 const profiles=await profileLookup({county:'Union',state:'NC',limit:1},f.client);
 assert.equal(profiles.length,1);assert.equal(profiles[0].id,'z-known-zero');assert.equal(profiles[0].purchase_count,0);
 const match=await f.match({county:'Union',state:'NC',limit:1});
 assert.equal(match.matches[0].buyerId,'z-known-zero');assert.equal(match.matches[0].purchaseCount,0);
});
