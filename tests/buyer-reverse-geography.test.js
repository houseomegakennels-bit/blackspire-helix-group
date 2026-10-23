import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const buyer=fs.readFileSync('frontend/src/lib/buyer-engine-server.ts','utf8');
const seller=fs.readFileSync('frontend/src/lib/seller-engine-server.ts','utf8');
const geo=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/buyer-geography.ts','utf8')).replaceAll('export ','')+'\n({normalizeBuyerState,normalizeCountyName,buyerGeographyMatches})');
const start=buyer.indexOf('function normalizeBuyerReverseSearchCriteria(');
const reverseCode=stripTypeScriptTypes(buyer.slice(start)).replaceAll('export ','');
const sellerStart=seller.indexOf('export async function listSellerLeadsForReverseSearch(');
const sellerCode=stripTypeScriptTypes(seller.slice(sellerStart,seller.indexOf('\nexport async function getSellerLeadDetail',sellerStart))).replace('export ','');
const rawSeller=(id,county,state)=>({id,status:'New',properties:{property_address:id+' Example St',county,state,city:'Greenville',zip_code:'27834',assessed_value:100000,estimated_equity:70000}});
const rawDeal=(id,county,state)=>({id,status:'Needs Analysis',property_address:id+' Example St',county,state,city:'Greenville',zip_code:'27834',deal_analysis:[{estimated_arv:150000,maximum_allowable_offer:70000}],buyer_matches:[]});
function fixture({sellerRows=[rawSeller('snc','Union','NC'),rawSeller('ssc','Union','SC'),rawSeller('sother','Unionville','NC'),rawSeller('sunknown','Union',null)],dealRows=[rawDeal('dnc','Union County','NC'),rawDeal('dsc','Union','SC'),rawDeal('dother','Pitt','NC'),rawDeal('dunknown','Unknown','NC')],fail=null,configured=true,cap=null,countOverride=null}={}){
 const reads=[];
 const db={from(table){const rows=table==='seller_leads'?sellerRows:dealRows;let head=false,selection,range;const q={
 select(fields,options){selection=fields;head=Boolean(options?.head);return q},order(){return q},range(first,last){range=[first,last];return q},
 then(resolve,reject){reads.push({table,head,range,selection});const failed=fail===table||fail===table+':'+(head?'count':'rows');const selected=range?rows.slice(range[0],Math.min(range[1]+1,range[0]+(cap??1000))):rows;return Promise.resolve({data:head?null:selected,count:head?(countOverride??rows.length):null,error:failed?{}:null}).then(resolve,reject)}
 };return q}};
 // This models the existing mapper's historical NC default; the actual strict helper must override it.
 const mapSellerLead=row=>({id:row.id,state:row.properties?.state??'NC',county:row.properties?.county??'Unknown',propertyAddress:row.properties?.property_address??'',city:row.properties?.city??'',zipCode:row.properties?.zip_code??'',propertyType:'Single Family',assessedValue:100000,estimatedEquity:70000,score:80,status:row.status,contactConfidenceScore:null,relatedDealId:null});
 const listSeller=vm.runInNewContext(sellerCode+'\nlistSellerLeadsForReverseSearch',{mapSellerLead,SELLER_LEAD_BASE_SELECT:'fixture persisted seller fields'});
 const run=vm.runInNewContext(reverseCode+'\nrunBuyerReverseSearch',{...geo,getEnvState:()=>({enabled:configured}),getSupabaseAdmin:()=>db,listSellerLeadsForReverseSearch:listSeller,asNumber:value=>Number(value)||0,asSingle:value=>Array.isArray(value)?value[0]??null:value});
 return {run,reads,listSeller,db};
}
test('reverse results hard-filter both seller and deal records by state and exact county',async()=>{
 const f=fixture(),result=await f.run({targetState:'NC',targetCounty:'Union County'});
 assert.equal(result.evaluation,'evaluated');assert.equal(result.unevaluatedCount,2);
 assert.match(result.reason,/2 records not evaluated/);
 assert.deepEqual(Array.from(result.matches,m=>m.sourceId).sort(),['dnc','snc']);
 assert.ok(result.matches.every(m=>m.state==='NC'&&geo.normalizeCountyName(m.county)==='union'));
 const sc=await f.run({targetState:'SC',targetCounty:'Union'});
 assert.deepEqual(Array.from(sc.matches,m=>m.sourceId).sort(),['dsc','ssc']);
});
test('reverse Greenville SC never includes the NC city or NC county lane',async()=>{
 const f=fixture({sellerRows:[rawSeller('nc','Pitt','NC'),rawSeller('sc','Greenville','SC')],dealRows:[rawDeal('ncdeal','Pitt','NC'),rawDeal('scdeal','Greenville','SC')]});
 const result=await f.run({targetState:'SC',targetCounty:'Greenville',targetCity:'Greenville'});
 assert.equal(result.evaluation,'evaluated');assert.deepEqual(Array.from(result.matches,m=>m.sourceId).sort(),['sc','scdeal']);
});
test('reverse unknown target geography performs no reads and has no evaluated count',async()=>{
 const f=fixture();for(const input of [{targetCounty:'Union'},{targetState:'NC'},{targetState:'SC',targetCity:'Greenville'},{targetState:'NC',targetCounty:'Not captured'}]){
 const result=await f.run(input);assert.equal(result.evaluation,'not_evaluated');assert.equal(result.unevaluatedCount,null);assert.equal(result.matches.length,0);assert.match(result.reason,/Not evaluated/)}
 assert.equal(f.reads.length,0);
});
test('persisted missing seller state remains unknown instead of becoming NC',async()=>{
 const f=fixture({sellerRows:[rawSeller('unknown','Union',null)],dealRows:[]});
 const rows=await f.listSeller(f.db);assert.equal(rows[0].state,'');
 const result=await f.run({targetState:'NC',targetCounty:'Union'});assert.equal(result.evaluation,'not_evaluated');assert.equal(result.matches.length,0);assert.equal(result.unevaluatedCount,1);assert.match(result.reason,/Not evaluated/);
});
for(const fail of ['seller_leads:count','seller_leads:rows','deal_leads:count','deal_leads:rows'])test('reverse source failure stays not evaluated: '+fail,async()=>{
 const result=await fixture({fail}).run({targetState:'NC',targetCounty:'Union'});
 assert.equal(result.evaluation,'not_evaluated');assert.equal(result.unevaluatedCount,null);assert.equal(result.matches.length,0);assert.match(result.reason,/could not be read completely/);
});
test('missing source configuration is not an empty market',async()=>{
 const f=fixture({configured:false});const r=await f.run({targetState:'NC',targetCounty:'Union'});assert.equal(r.evaluation,'not_evaluated');assert.equal(f.reads.length,0);
});
test('reverse reaches records beyond historical top-200 cutoff and server page caps',async()=>{
 const sellerRows=Array.from({length:260},(_,i)=>rawSeller('s'+i,'Pitt','NC'));
 const dealRows=Array.from({length:260},(_,i)=>rawDeal('d'+i,'Pitt','NC'));
 sellerRows[259]=rawSeller('targetSeller','Union','NC');dealRows[259]=rawDeal('targetDeal','Union','NC');
 const f=fixture({sellerRows,dealRows,cap:100});const r=await f.run({targetState:'NC',targetCounty:'Union'});
 assert.equal(r.evaluation,'evaluated');assert.deepEqual(Array.from(r.matches,m=>m.sourceId).sort(),['targetDeal','targetSeller']);
 assert.equal(f.reads.filter(x=>!x.head).length,6);
});
test('oversized or incomplete sources refuse partial success',async()=>{
 for(const options of [{countOverride:5001},{countOverride:25,cap:1}]){
 const r=await fixture(options).run({targetState:'NC',targetCounty:'Union'});assert.equal(r.evaluation,'not_evaluated');assert.equal(r.matches.length,0)}
});
test('a verified empty reverse search differs from missing geography or failed sources',async()=>{
 const r=await fixture({sellerRows:[],dealRows:[]}).run({targetState:'NC',targetCounty:'Union'});
 assert.equal(r.evaluation,'evaluated');assert.equal(r.unevaluatedCount,0);assert.equal(r.reason,null);assert.equal(r.matches.length,0);
});

