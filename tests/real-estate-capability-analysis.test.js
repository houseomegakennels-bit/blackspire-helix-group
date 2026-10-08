import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { dealAnalysisCapability, summarizeDealAnalysis } from '../packages/capabilities/deal-analysis.js';
import { validateCapabilityOutput } from '../packages/capabilities/contract.js';

const require = createRequire(import.meta.url);
const ts = require('../frontend/node_modules/typescript');
const source = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8');
const ast = ts.createSourceFile('engine.ts', source, ts.ScriptTarget.Latest, true);
const names = ['getDealEngineAnalysisForCapability','toLead','asSingle','asNumber','nullableMoney','formatCurrency','buildUnderwritingSnapshot','buildInvestmentComplianceSnapshot','buildWholesalingComplianceSnapshot'];
const functions = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast).replace(/^export /,'')).join('\n');
const model = fs.readFileSync('frontend/src/lib/investment-analysis.ts','utf8').replace(/^export /gm,'');
const route = fs.readFileSync('frontend/src/app/api/internal/capabilities/deal-analysis/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');

async function readAnalysis(analysis) {
  const reads = [];
  const client = { from(table) {
    let columns;
    const q = { select(value){ columns=value;return q; }, eq(){return q;}, limit(){return q;}, maybeSingle(){
      reads.push({table,columns});
      const row = table === 'deal_leads' ? {id:'DE-9999',owner_name:'Fictional seller',property_address:'Fictional practice property',county:'Forsyth',status:'Needs Analysis',motivation_score:1} : analysis;
      const data = table === 'deal_analysis' ? Object.fromEntries(columns.split(',').filter(k => Object.hasOwn(row,k)).map(k=>[k,row[k]])) : row;
      return Promise.resolve({data,error:null});
    }, update(){throw Error('read attempted a write');}, insert(){throw Error('read attempted a write');}, upsert(){throw Error('read attempted a write');} }; return q;
  } };
  const ctx = {
    Intl, Date,
    productionCapabilityReadScope:()=>({client,respond:body=>body}),
    readBoundedRequestBody:async()=>JSON.stringify({workspaceId:'test-workspace',dealId:'DE-9999'}),
    authorizeInternalCapability:async()=>({bindingDigest:'test-only'}),
    NextResponse:{json:(body,options)=>({body,status:options?.status??200})},
  };
  const { POST } = vm.runInNewContext(stripTypeScriptTypes(model+'\n'+functions+'\n'+route)+'\n({POST})',ctx);
  const response = await POST({});
  assert.equal(response.found,true,JSON.stringify(response));
  return {result:validateCapabilityOutput(dealAnalysisCapability,JSON.parse(JSON.stringify(response))),reads};
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
