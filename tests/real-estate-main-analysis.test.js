import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
const source = fs.readFileSync('frontend/src/lib/deal-engine-server.ts', 'utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'');
const shared = vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/investment-analysis.ts','utf8').replace(/^export /gm,'')) + '\n({analyzeInvestment,parseInvestmentAmount})');
function load(names, context={}) {
 const overrides=Object.keys(context).map(name=>`${name}=fixtures[${JSON.stringify(name)}];`).join('\n');
 return vm.runInNewContext(stripTypeScriptTypes(source)+'\n'+overrides+'\n({'+names.join(',')+'})',{...shared,...context,fixtures:context});
}
const snapshotNames=['buildUnderwritingSnapshot','buildInvestmentComplianceSnapshot','buildWholesalingComplianceSnapshot'];
const {buildUnderwritingSnapshot} = load(snapshotNames);
const lead={exitStrategy:'Assignment',assignmentFee:'$12000'};
const complete={estimated_arv:200000,seller_asking_price:110000,repair_estimate:0,closing_costs:5000,holding_costs:5000,buyer_profit_target:30000,assignment_fee_target:10000};
test('unknown amounts remain unknown; a confirmed zero repair is complete',()=>{
 const missing=buildUnderwritingSnapshot(lead,null);
 assert.equal(missing.repairEstimate,null); assert.equal(missing.maximumAllowableOffer,null); assert.equal(missing.analysisComplete,false);
 const known=buildUnderwritingSnapshot(lead,complete);
 assert.equal(known.repairEstimate,0); assert.equal(known.analysisComplete,true); assert.equal(known.maximumAllowableOffer,150000); assert.equal(known.fitsTarget,true);
 assert.equal(known.readyForContract,false);
});
test('seller asking price drives rating and losses are not hidden',()=>{
 const expensive=buildUnderwritingSnapshot(lead,{...complete,seller_asking_price:250000});
 assert.equal(expensive.dealRating,'Yellow Deal'); assert.equal(expensive.askingGap,-100000); assert.equal(expensive.wholesaleSpread,-70000);
 const loss=buildUnderwritingSnapshot(lead,{...complete,estimated_arv:10000}); assert.equal(loss.maximumAllowableOffer,-40000);
});
test('rental calculation uses known monthly expenses and debt, independent of resale inputs',()=>{
 const rental=buildUnderwritingSnapshot(lead,{seller_asking_price:100000,repair_estimate:0,closing_costs:5000,rental_estimate:1500,formula_settings:{strategy:'rental',monthlyExpenses:500,monthlyDebtService:600}});
 assert.equal(rental.analysisComplete,true); assert.equal(rental.monthlyCashFlow,400); assert.equal(rental.estimatedArv,null); assert.equal(rental.maximumAllowableOffer,null);
});
function dbMock() {
 const writes=[];
 const db={from(table){ const q={select(){return q},eq(){return q},in(key,values){q.allowed=values; return q},maybeSingle:async()=>({data:{formula_settings:{otherSetting:'preserved',strategy:'assignment'}}}),upsert(payload){writes.push({table,payload});return q},update(payload){writes.push({table,payload,q});return q},insert(payload){writes.push({table,payload});return q},then(resolve){return Promise.resolve({error:null}).then(resolve)}};return q }};
 return {db,writes};
}
test('saving analysis preserves zero, unknowns, strategy metadata and restricts stage changes',async()=>{
 const {db,writes}=dbMock(); const {saveDealAnalysis}=load(['saveDealAnalysis','formatCurrency',...snapshotNames.slice(1)],{getSupabaseAdmin:()=>db});
 const result=await saveDealAnalysis({dealId:'x',estimatedArv:200000,sellerAskingPrice:110000,repairEstimate:0,closingCosts:5000,holdingCosts:5000,buyerProfitTarget:30000,assignmentFeeTarget:10000,rentalEstimate:null,flipEstimate:null,strategy:'flip'});
 assert.equal(result.ok,true); const row=writes.find(x=>x.table==='deal_analysis').payload;
 assert.equal(row.repair_estimate,0); assert.equal(row.rental_estimate,null); assert.equal(row.formula_settings.otherSetting,'preserved'); assert.equal(row.formula_settings.strategy,'flip');
 const stage=writes.find(x=>x.table==='deal_leads'); assert.equal(stage.payload.status,'Analysis Complete'); assert.ok(!stage.q.allowed.includes('Closed')); assert.ok(!stage.q.allowed.includes('Negotiating')); assert.ok(!stage.q.allowed.includes('Under Contract'));
});
test('preliminary assessed-value preview performs no database writes',async()=>{
 let writes=0; const db={from(table){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='deal_leads'?{id:'x',assessed_value:100000,county:'Forsyth'}:null}),insert(){writes++;throw Error('unexpected insert')},update(){writes++;throw Error('unexpected update')},upsert(){writes++;throw Error('unexpected upsert')}}; return q}};
 const {estimateDealArv}=load(['estimateDealArv','clampMoney','formatCurrency'],{getSupabaseAdmin:()=>db,listSellerLeads:async()=>[],findMarketMedianAssessedValue:async()=>null,estimateArvFromSignals:()=>({estimatedArv:120000,rangeLow:110000,rangeHigh:130000,confidence:'Low',basis:'Assessed estimate'}),toLead:()=>lead,buildUnderwritingSnapshot});
 const result=await estimateDealArv({dealId:'x'}); assert.equal(result.ok,true); assert.equal(result.saved,false); assert.equal(result.preliminary,true); assert.equal(writes,0); assert.equal(result.underwriting.estimatedArv,null);
});
test('analysis API authorizes before parsing and rejects invalid amounts without saving',async()=>{
 const route=stripTypeScriptTypes(fs.readFileSync('frontend/src/app/api/deal-engine/save-analysis/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'')); let saved=0;
 const ctx={...shared,NextResponse:{json:(body,options)=>({body,status:options?.status??200})},guardAdminApi:async()=>({status:403}),saveDealAnalysis:async()=>{saved++;return {ok:true}}};
 let {POST}=vm.runInNewContext(route+'\n({POST})',{...ctx}); assert.equal((await POST({json:()=>{throw Error('parsed unauthorized')}})).status,403);
 ctx.guardAdminApi=async()=>null; ({POST}=vm.runInNewContext(route+'\n({POST})',{...ctx}));
 assert.equal((await POST({json:async()=>({dealId:'x',repairEstimate:-1})})).status,400); assert.equal(saved,0);
});

test('lead summaries distinguish unknown values, zero and a negative ceiling',()=>{
 const {toLead}=load(['toLead','asSingle','asNumber','nullableMoney','formatCurrency']);
 const missing=toLead({id:'x'}); assert.equal(missing.mao,'Not entered'); assert.equal(missing.assignmentFee,'Not entered');
 const zero=toLead({id:'x',deal_analysis:{maximum_allowable_offer:0,assignment_fee_target:'0'}}); assert.equal(zero.mao,'$0.00'); assert.equal(zero.assignmentFee,'$0.00');
 const loss=toLead({id:'x',deal_analysis:{maximum_allowable_offer:-1500}}); assert.equal(loss.mao,'-$1,500.00');
});
const trackerDetail={underwriting:{purchasePriceTarget:100000,maximumAllowableOffer:80000,assignmentFeeTarget:10000},lead:{assignmentFee:'$10000'},coordination:{},closeout:null};
test('assignment tracker never invents actual prices; zero and signed losses remain visible',()=>{
 const {toAssignmentTrackerRecord}=load(['toAssignmentTrackerRecord','nullableMoney']);
 const empty=toAssignmentTrackerRecord(null,trackerDetail); assert.equal(empty.sellerContractPrice,null); assert.equal(empty.buyerAssignmentPrice,null); assert.equal(empty.assignmentFee,null); assert.equal(empty.expectedNetFee,null);
 const loss=toAssignmentTrackerRecord({seller_contract_price:100000,buyer_assignment_price:90000,title_company_fee:1000,other_closing_costs:0},trackerDetail);
 assert.equal(loss.assignmentFee,-10000); assert.equal(loss.expectedNetFee,-11000);
 const zero=toAssignmentTrackerRecord({seller_contract_price:0,buyer_assignment_price:0,title_company_fee:0,other_closing_costs:0},trackerDetail);
 assert.equal(zero.sellerContractPrice,0); assert.equal(zero.buyerAssignmentPrice,0); assert.equal(zero.expectedNetFee,0);
 const savedLoss=toAssignmentTrackerRecord({assignment_fee:-500,expected_net_fee:-700},trackerDetail); assert.equal(savedLoss.assignmentFee,-500); assert.equal(savedLoss.expectedNetFee,-700);
});
function trackerDb(existing=null) {
 const writes=[]; const db={from(){const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:existing,error:null}),upsert(row){writes.push(row);return Promise.resolve({error:null})}}; return q}};
 return {db,writes};
}
test('assignment tracker saves signed losses, preserves omitted fields and rejects invalid costs',async()=>{
 const {db,writes}=trackerDb({seller_contract_price:100000,buyer_assignment_price:90000,title_company_fee:1000,other_closing_costs:0,payout_notes:'Preserve existing evidence',payout_status:'pending_closing'});
 const {updateDealAssignmentTracker}=load(['updateDealAssignmentTracker','nullableMoney'],{getSupabaseAdmin:()=>db});
 const result=await updateDealAssignmentTracker('x',{buyerAssignmentPrice:80000}); assert.equal(result.ok,true);
 assert.equal(writes[0].seller_contract_price,100000); assert.equal(writes[0].assignment_fee,-20000); assert.equal(writes[0].expected_net_fee,-21000); assert.equal(writes[0].payout_notes,'Preserve existing evidence');
 const cleared=await updateDealAssignmentTracker('x',{sellerContractPrice:null}); assert.equal(cleared.assignmentFee,null); assert.equal(cleared.expectedNetFee,null); assert.equal(writes[1].seller_contract_price,null);
 assert.equal((await updateDealAssignmentTracker('x',{titleCompanyFee:-1})).ok,false); assert.equal(writes.length,2);
});
test('assignment tracker can save confirmed zeros without a seeded target',async()=>{
 const {db,writes}=trackerDb(); const {updateDealAssignmentTracker}=load(['updateDealAssignmentTracker','nullableMoney'],{getSupabaseAdmin:()=>db});
 const result=await updateDealAssignmentTracker('x',{sellerContractPrice:0,buyerAssignmentPrice:0,titleCompanyFee:0,otherClosingCosts:0});
 assert.equal(result.expectedNetFee,0); assert.equal(writes[0].seller_contract_price,0);
});

test('tracker fractional losses stay negative and summaries keep cents',()=>{
 const {toAssignmentTrackerRecord,formatCurrency}=load(['toAssignmentTrackerRecord','nullableMoney','formatCurrency']);
 const loss=toAssignmentTrackerRecord({seller_contract_price:100.25,buyer_assignment_price:100.15,title_company_fee:0.05,other_closing_costs:0},trackerDetail);
 assert.equal(loss.assignmentFee,-0.1); assert.equal(loss.expectedNetFee,-0.15); assert.equal(formatCurrency(loss.expectedNetFee),'-$0.15');
});

test('recorded zero purchase deposit overrides a nonzero contract draft',()=>{
 const {toEmdTrackerRecord}=load(['toEmdTrackerRecord','computeEmdStatusTone','nullableMoney','asNumber']);
 const result=toEmdTrackerRecord({emd_amount:0,emd_status:'not_required'}, {...trackerDetail,contractDraft:{earnestMoney:'$5,000'}});
 assert.equal(result.emdAmount,0);
});
test('partial purchase deposit updates preserve actual amount and do not invent zero',async()=>{
 const {db,writes}=trackerDb({emd_amount:2500,emd_notes:'Receipt reviewed',emd_status:'received'});
 const {updateDealEmdTracker}=load(['updateDealEmdTracker'],{getSupabaseAdmin:()=>db});
 assert.equal((await updateDealEmdTracker('x',{emdHolder:'Confirmed holder'})).ok,true);
 assert.equal(writes[0].emd_amount,2500); assert.equal(writes[0].emd_notes,'Receipt reviewed'); assert.equal(writes[0].emd_status,'received');
 assert.equal((await updateDealEmdTracker('x',{emdAmount:0})).ok,true); assert.equal(writes[1].emd_amount,0);
 assert.equal((await updateDealEmdTracker('x',{emdAmount:-5})).ok,false); assert.equal(writes.length,2);
 const empty=trackerDb(); const updateEmpty=load(['updateDealEmdTracker'],{getSupabaseAdmin:()=>empty.db}).updateDealEmdTracker;
 await updateEmpty('new',{emdHolder:'Holder'}); assert.equal(empty.writes[0].emd_amount,null);
});

test('Commander insight preserves unknown and negative ceilings without invented offer ranges',()=>{
 const {buildRuleBasedCommanderInsight}=load(['buildRuleBasedCommanderInsight'],{inferContactConfidence:()=>80,deriveSellerPainPoint:()=> 'Seller priorities not confirmed'});
 const base={lead:{},buyerSignals:[],underwriting:{strategy:'assignment',missingInputs:[],analysisComplete:true,fitsTarget:false,maximumAllowableOffer:-0.25}};
 const negative=buildRuleBasedCommanderInsight(base,null); assert.equal(negative.estimatedMao,-0.25); assert.equal(negative.offerRangeLow,null); assert.equal(negative.offerRangeHigh,null);
 const unknown=buildRuleBasedCommanderInsight({...base,underwriting:{...base.underwriting,maximumAllowableOffer:null,missingInputs:['Resale estimate'],analysisComplete:false}},null); assert.equal(unknown.estimatedMao,null);
 const rental=buildRuleBasedCommanderInsight({...base,underwriting:{...base.underwriting,strategy:'rental',fitsTarget:true,maximumAllowableOffer:null}},null);
 assert.equal(rental.estimatedMao,null); assert.ok(!rental.riskWarnings.some(x=>/ARV|spread|buyer/i.test(x))); assert.match(rental.dispositionStrategy,/rent, operating expenses, debt service/);
});
test('AI wording cannot replace calculated ceilings or invent proposed offer ranges',async()=>{
 const {maybeEnhanceCommanderInsightWithAi}=load(['maybeEnhanceCommanderInsightWithAi'],{process:{env:{OPENAI_API_KEY:'test-only'}},fetch:async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({estimatedMao:12345,offerRangeLow:10000,offerRangeHigh:12000})}}]})}),AbortSignal:{timeout:()=>null}});
 const fallback={estimatedMao:-0.25,offerRangeLow:null,offerRangeHigh:null,confidenceScore:30,riskWarnings:[]};
 const detail={lead:{},sellerContact:{},buyerSignals:[],underwriting:{strategy:'rental',missingInputs:[]}};
 const result=await maybeEnhanceCommanderInsightWithAi(detail,fallback,null); assert.equal(result.estimatedMao,-0.25); assert.equal(result.offerRangeLow,null); assert.equal(result.offerRangeHigh,null);
});
test('contract fields use recorded transaction prices and never underwriting or candidate identities',()=>{
 const names=['dealFieldPayload','deriveContractTerms','inferClosingDate','inferInspectionPeriod','inferBuyerOrAssigneeName','nullableMoney'];
 const {dealFieldPayload}=load(names);
 const detail={...trackerDetail,lead:{id:'x',ownerName:'Seller',propertyAddress:'Property'},sellerContact:{ownerName:'Seller'},coordination:{},contractDraft:{earnestMoney:'Not entered'},activityFeed:[],packet:{contactInstructions:'Instructions'},buyerSignals:[{buyerName:'Uncommitted candidate'}],investorResponses:[{investorName:'Uncommitted respondent'}]};
 const unknown=dealFieldPayload(detail,null,null,[]); assert.equal(unknown.purchase_price,null); assert.equal(unknown.assignment_price,null); assert.equal(unknown.assignment_fee,null); assert.equal(unknown.earnest_money_deposit,null); assert.equal(unknown.assignee_name,''); assert.equal(unknown.inspection_period,''); assert.equal(unknown.closing_date,'');
 const recorded=dealFieldPayload(detail,{id:'confirmed-deposit',emdAmount:0},{sellerContractPrice:0,buyerAssignmentPrice:0,assignmentFee:0},[]); assert.equal(recorded.purchase_price,0); assert.equal(recorded.original_purchase_price,0); assert.equal(recorded.assignment_price,0); assert.equal(recorded.earnest_money_deposit,0);
});

test('complete rental saves cash-flow next actions and strategy-specific requirements',async()=>{
 const {db,writes}=dbMock(); const {saveDealAnalysis}=load(['saveDealAnalysis','formatCurrency',...snapshotNames.slice(1)],{getSupabaseAdmin:()=>db});
 await saveDealAnalysis({dealId:'x',strategy:'rental',sellerAskingPrice:100000,repairEstimate:0,closingCosts:5000,rentalEstimate:1500,monthlyExpenses:500,monthlyDebtService:600});
 const update=writes.find(x=>x.table==='deal_leads').payload; assert.match(update.recommended_next_action,/monthly cash flow \$400/); assert.ok(!/MAO/.test(update.recommended_next_action));
 const log=writes.find(x=>x.table==='disposition_logs'&&x.payload.action_type==='analysis_update').payload.payload;
 assert.ok(!log.complianceChecklist.some(x=>/assignment|equitable-interest/i.test(x)));
});
test('signature preparation validates the selected saved draft against current required facts',async()=>{
 let writes=0; const filters=[];
 const draft={id:'selected',template_id:'template1',template_type:'assignment_agreement',metadata:{templateKey:'approved'},legal_disclaimer_acknowledged:true,body:'Purchase price $0.00',editable_payload:{purchase_price:'$0.00'}};
 const db={from(){const q={select(){return q},eq(key,value){filters.push([key,value]);return q},maybeSingle:async()=>({data:draft,error:null}),upsert(){writes++;return Promise.resolve({error:null})}};return q}};
 let validation={template:{id:'template1',approvalStatus:'attorney_reviewed',requiredFields:['purchase_price']},purposeValid:true,canGenerate:true,missingFields:['purchase_price'],availableFields:{purchase_price:''},disclaimerRequired:true};
 const {prepareDealSignaturePacket}=load(['prepareDealSignaturePacket','sanitizeDraftType'],{getSupabaseAdmin:()=>db,validateDealFieldsForTemplate:async()=>validation});
 const input={dealId:'x',draftId:'selected'};
 assert.equal((await prepareDealSignaturePacket({dealId:'x'})).ok,false); assert.equal(filters.length,0);
 assert.equal((await prepareDealSignaturePacket(input)).ok,false); assert.equal(writes,0);
 validation={...validation,missingFields:[],availableFields:{purchase_price:'TBD'}}; assert.equal((await prepareDealSignaturePacket(input)).ok,false);
 validation={...validation,availableFields:{purchase_price:'$0.00'},template:{...validation.template,approvalStatus:'reference_only'}}; assert.equal((await prepareDealSignaturePacket(input)).ok,false);
 validation={...validation,template:{...validation.template,approvalStatus:'attorney_reviewed'}}; draft.legal_disclaimer_acknowledged=false; assert.equal((await prepareDealSignaturePacket(input)).ok,false);
 draft.legal_disclaimer_acknowledged=true; draft.editable_payload.purchase_price=''; assert.equal((await prepareDealSignaturePacket(input)).ok,false);
 draft.editable_payload.purchase_price='$1.00'; assert.equal((await prepareDealSignaturePacket(input)).ok,false);
 draft.editable_payload.purchase_price='$0.00'; draft.body='Purchase price {{purchase_price}}'; assert.equal((await prepareDealSignaturePacket(input)).ok,false); assert.equal(writes,0);
 draft.body='Purchase price $0.00'; const result=await prepareDealSignaturePacket(input); assert.equal(result.ok,true); assert.equal(writes,1); assert.match(result.packetUrl,/x\/selected$/);
 assert.ok(filters.some(([key,value])=>key==='id'&&value==='selected')); assert.ok(filters.some(([key,value])=>key==='deal_id'&&value==='x'));
});
test('proposed contract terms persist separately from calculated underwriting and reload from the saved log',async()=>{
 const {db,writes}=dbMock(); const {saveDealContractTerms,savedContractOfferWindow}=load(['saveDealContractTerms','savedContractOfferWindow','formatCurrency','buildWholesalingComplianceSnapshot','isDuplicateInsertError'],{getSupabaseAdmin:()=>db});
 assert.equal((await saveDealContractTerms({dealId:'x',contractType:'Assignment',offerLow:90000,offerHigh:95000,earnestMoney:0})).ok,true);
 assert.ok(!writes.some(x=>x.table==='deal_analysis'));
 const saved=writes.find(x=>x.table==='disposition_logs').payload.payload;
 assert.equal(savedContractOfferWindow(saved),'$90,000.00 to $95,000.00'); assert.equal(savedContractOfferWindow({offerLow:0,offerHigh:0}),'$0.00 to $0.00'); assert.equal(savedContractOfferWindow({}),'Not entered');
});
test('signature API requires and forwards the selected saved draft after authorization',async()=>{
 const route=stripTypeScriptTypes(fs.readFileSync('frontend/src/app/api/deal-engine/signature/prepare/route.ts','utf8').replace(/^import[^;]+;\s*/gm,'').replace(/^export /gm,'')); const received=[];
 const ctx={NextResponse:{json:(body,options)=>({body,status:options?.status??200})},guardAdminApi:async()=>null,prepareDealSignaturePacket:async input=>{received.push(input);return {ok:true,packetUrl:'test'}}};
 const {POST}=vm.runInNewContext(route+'\n({POST})',ctx);
 assert.equal((await POST({json:async()=>({dealId:'x'})})).status,400); assert.equal(received.length,0);
 assert.equal((await POST({json:async()=>({dealId:'x',draftId:' selected '})})).status,200); assert.equal(received[0].draftId,'selected');
});

test('completed rental workflow reports cash flow rather than an absent offer ceiling',()=>{
 const {buildDealAutomationWorkflow}=load(['buildDealAutomationWorkflow','formatCurrency'],{isResendConfigured:()=>false});
 const underwriting=buildUnderwritingSnapshot(lead,{seller_asking_price:100000,repair_estimate:0,closing_costs:5000,rental_estimate:1500,formula_settings:{strategy:'rental',monthlyExpenses:500,monthlyDebtService:600}});
 const detail={underwriting,sellerContact:{ownerPhone:'Not captured'},buyerSignals:[],coordination:{},packet:{investorSummary:'',buyerEmailBlast:''},lead:{id:'rental'},uploadedDocuments:[]};
 const item=buildDealAutomationWorkflow(detail).find(row=>row.id==='rental-workflow-underwrite');
 assert.equal(item.status,'ready');assert.match(item.detail,/Monthly cash flow is \$400/);assert.doesNotMatch(item.detail,/MAO|Not entered/);
});

test('saving a generated draft returns its database identity for subsequent selection',async()=>{
 let selected='';const db={from(){const q={upsert(){return q},select(fields){selected=fields;return q},single:async()=>({data:{id:'stored-uuid'},error:null})};return q}};
 const {saveGeneratedContractDraft}=load(['saveGeneratedContractDraft','sanitizeDraftType'],{getSupabaseAdmin:()=>db,writeContractAuditLog:async()=>{}});
 const result=await saveGeneratedContractDraft({dealId:'x',templateType:'assignment_agreement',title:'Reviewed draft',body:'Purchase price $0.00'});
 assert.equal(result.draftId,'stored-uuid');assert.equal(selected,'id');
});
