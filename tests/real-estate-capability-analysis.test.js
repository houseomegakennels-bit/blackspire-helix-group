import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { dealAnalysisCapability, summarizeDealAnalysis } from '../packages/capabilities/deal-analysis.js';
import { validateCapabilityOutput } from '../packages/capabilities/contract.js';

const functions = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
const readSource = fs.readFileSync('frontend/src/lib/capability-read-client.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
const readContext = {URL,URLSearchParams,performance,AbortController,AbortSignal,TextDecoder,Response,Uint8Array};
const createScope = vm.runInNewContext(stripTypeScriptTypes(readSource)+'\ncreateCapabilityReadScope',readContext);
const model = fs.readFileSync('frontend/src/lib/investment-analysis.ts','utf8').replace(/^export /gm,'');
const route = fs.readFileSync('frontend/src/app/api/internal/capabilities/deal-analysis/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');

async function readAnalysis(analysis) {
  const reads = [];
  const scope = createScope({origin:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional-test-key',fetchImpl:async(url,options)=>{
    assert.equal(options.method,'GET');
    const parsed=new URL(url);const table=parsed.pathname.split('/').at(-1);const columns=parsed.searchParams.get('select');
    assert.equal(parsed.searchParams.get('limit'),'1');
    reads.push({table,columns});
    const row=table==='deal_leads'?{id:'DE-9999',owner_name:'Fictional seller',property_address:'Fictional practice property',county:'Forsyth',status:'Needs Analysis',motivation_score:1}:analysis;
    const data=Object.fromEntries(columns.split(',').filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));
    return Response.json([data]);
  }});
  const ctx = {
    Intl, Date,
    productionCapabilityReadScope:()=>scope,
    readBoundedRequestBody:async()=>JSON.stringify({workspaceId:'test-workspace',dealId:'DE-9999'}),
    authorizeInternalCapability:async()=>({bindingDigest:'test-only'}),
    NextResponse:{json:(body,options)=>({body,status:options?.status??200})},
  };
  const { POST } = vm.runInNewContext(stripTypeScriptTypes(model+'\n'+functions+'\n'+route)+'\n({POST})',ctx);
  const response = await POST({});
  assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.found,true,JSON.stringify(body));
  const observation=JSON.parse(response.headers.get('x-zola-read-observation'));assert.equal(observation.requests,2);assert.equal(observation.forbiddenAttempts,0);
  return {result:validateCapabilityOutput(dealAnalysisCapability,body),reads};
}

test('persisted rental strategy survives scoped read, API response, validation and summary',async()=>{
  const {result,reads}=await readAnalysis({seller_asking_price:100000,repair_estimate:0,closing_costs:5000,rental_estimate:1500,formula_settings:{strategy:'rental',monthlyExpenses:500,monthlyDebtService:600}});
  assert.ok(reads.find(r=>r.table==='deal_analysis').columns.includes('formula_settings'));
  assert.equal(result.strategy,'rental');assert.equal(result.repairEstimate,0);assert.equal(result.monthlyCashFlow,400);
  assert.equal(result.maximumAllowableOffer,null);assert.equal(result.estimatedArv,null);assert.equal(result.readyForContract,false);
  assert.equal(result.analysisComplete,true);assert.match(summarizeDealAnalysis(result),/Monthly cash flow: \$400/);
  assert.doesNotMatch(summarizeDealAnalysis(result),/ARV:|MAO:|contract-ready/);
});

test('unknowns remain unknown throughout the scoped analysis response',async()=>{
  const {result}=await readAnalysis({formula_settings:{strategy:'flip'}});
  assert.equal(result.repairEstimate,null);assert.equal(result.maximumAllowableOffer,null);assert.equal(result.analysisComplete,false);
  assert.match(summarizeDealAnalysis(result),/ARV: Unknown \| MAO: Unknown/);assert.ok(result.missingInputs.length);
});

test('scoped response and summary preserve known zero and fractional negative ceilings',async()=>{
  const {result}=await readAnalysis({seller_asking_price:100.25,estimated_arv:100.15,repair_estimate:0,closing_costs:100.25,holding_costs:0,buyer_profit_target:0,assignment_fee_target:0,formula_settings:{strategy:'assignment'}});
  assert.equal(result.repairEstimate,0);assert.equal(result.maximumAllowableOffer,-0.1);assert.equal(result.wholesaleSpread,-100.35);
  assert.match(summarizeDealAnalysis(result),/MAO: -\$0\.1/);assert.equal(result.readyForContract,false);
});

test('capability rejects malformed amounts and strategies instead of substituting zero',async()=>{
  const {result}=await readAnalysis({formula_settings:{strategy:'flip'}});
  for(const value of [true,{},'not a number',Infinity,NaN,-1]) {
    assert.throws(()=>validateCapabilityOutput(dealAnalysisCapability,{...result,repairEstimate:value}),/invalid deal analysis repairEstimate/);
  }
  assert.throws(()=>validateCapabilityOutput(dealAnalysisCapability,{...result,strategy:'unknown'}),/invalid deal analysis strategy/);
});

test('analysis flags accept only booleans or optional null and fail closed on skewed adapters',async()=>{
 const {result}=await readAnalysis({formula_settings:{strategy:'flip'}});
 for(const name of ['analysisComplete','fitsTarget']) {
  for(const value of ['false','true',0,1,{},[]]) assert.throws(()=>validateCapabilityOutput(dealAnalysisCapability,{...result,[name]:value}),new RegExp('invalid deal analysis '+name));
  for(const value of [false,true,null,undefined]) assert.equal(validateCapabilityOutput(dealAnalysisCapability,{...result,[name]:value})[name],value??null);
 }
});

test('bounded read client still rejects arbitrary projections and write methods before transport',()=>{
 let requests=0;
 for(const attempt of [scope=>scope.client.from('deal_analysis').select('*'),scope=>scope.client.from('deal_analysis').select('formula_settings,private_column'),scope=>scope.client.from('deal_analysis').update({formula_settings:{}})]) {
  const scope=createScope({origin:'https://abcdefghijklmnopqrst.supabase.co',key:'fictional-test-key',fetchImpl:async()=>{requests++;return Response.json([]);}});
  assert.throws(()=>attempt(scope),/CAPABILITY_READ_REJECTED/);
 }
 assert.equal(requests,0);
});
