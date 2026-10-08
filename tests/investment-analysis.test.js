import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from 'node:module';
const {analyzeInvestment,parseInvestmentAmount}=vm.runInNewContext(stripTypeScriptTypes(fs.readFileSync('frontend/src/lib/investment-analysis.ts','utf8').replace(/^export /gm,''))+'\n({analyzeInvestment,parseInvestmentAmount})');
const flip={strategy:'flip',purchasePrice:100000,resaleValue:200000,repairs:20000,closingCosts:10000,holdingCosts:5000,profitTarget:30000,assignmentFee:null};
test('blank means unknown while zero remains a deliberate known amount',()=>{
 for(const value of ['', '  ', null, undefined]) assert.equal(parseInvestmentAmount(value),null);
 for(const value of [0,'0','0.00']) assert.equal(parseInvestmentAmount(value),0);
 for(const value of [-1,'bad',Infinity,NaN,true,{},100000001]) assert.throws(()=>parseInvestmentAmount(value));
 const zero=analyzeInvestment({...flip,repairs:0});assert.equal(zero.complete,true);
 const unknown=analyzeInvestment({...flip,repairs:null});assert.equal(unknown.complete,false);assert.equal(unknown.profit,null);assert.equal(unknown.acquisitionCost,null);assert.equal(unknown.fitsTarget,false);
});
test('actual price is compared with the target ceiling and losses remain negative',()=>{
 const good=analyzeInvestment(flip);assert.equal(good.ceiling,135000);assert.equal(good.askingGap,35000);assert.equal(good.profit,65000);assert.equal(good.fitsTarget,true);
 const loss=analyzeInvestment({...flip,purchasePrice:190000});assert.equal(loss.profit,-25000);assert.equal(loss.askingGap,-55000);assert.equal(loss.fitsTarget,false);
 const impossible=analyzeInvestment({...flip,resaleValue:1000});assert.ok(impossible.ceiling<0);
 const smallLoss=analyzeInvestment({...flip,purchasePrice:164999.99,resaleValue:199999.98});assert.equal(smallLoss.profit,-0.01);assert.equal(smallLoss.fitsTarget,false);
});
test('assignment fee is separated from buyer profit and ignored for a flip',()=>{
 const assigned=analyzeInvestment({...flip,strategy:'assignment',assignmentFee:12000});assert.equal(assigned.ceiling,123000);assert.equal(assigned.profit,53000);
 assert.equal(analyzeInvestment({...flip,assignmentFee:12000}).profit,65000);
 assert.equal(analyzeInvestment({...flip,strategy:'assignment'}).complete,false);
});
test('rental cash flow and annual return use acquisition cost, with missing and zero cost handled',()=>{
 const rental={...flip,strategy:'rental',resaleValue:null,holdingCosts:null,profitTarget:null,monthlyRent:1600,monthlyExpenses:500,monthlyDebtService:800};
 const a=analyzeInvestment(rental);assert.equal(a.complete,true);assert.equal(a.monthlyCashFlow,300);assert.equal(a.acquisitionCost,130000);assert.equal(a.annualReturnOnCost,3600/130000*100);assert.equal(a.ceiling,null);assert.equal(a.profit,null);
 assert.equal(analyzeInvestment({...rental,monthlyDebtService:null}).monthlyCashFlow,null);
 assert.equal(analyzeInvestment({...rental,monthlyRent:0}).monthlyCashFlow,-1300);
 const cents=analyzeInvestment({...rental,monthlyRent:1300.01});assert.equal(cents.monthlyCashFlow,0.01);assert.equal(cents.fitsTarget,true);
 assert.equal(analyzeInvestment({...rental,purchasePrice:0,repairs:0,closingCosts:0}).annualReturnOnCost,null);
});
test('unknown purchase price still permits a ceiling but never implies a fit',()=>{
 const a=analyzeInvestment({...flip,purchasePrice:null});assert.equal(a.ceiling,135000);assert.equal(a.askingGap,null);assert.equal(a.fitsTarget,false);
 assert.throws(()=>analyzeInvestment({...flip,strategy:'invalid'}));
});
