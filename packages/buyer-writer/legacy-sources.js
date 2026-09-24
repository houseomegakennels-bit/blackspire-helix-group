import { BuyerSourceError } from './source-http.js';
import { createLegacyBuyerSourceQueryBuilders } from './legacy-source-queries.js';
const reject=(code='SOURCE_DATA_REJECTED')=>{throw new BuyerSourceError(code);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const feature=f=>{
  if(!object(f)||Object.hasOwn(f,'attributes')&&!object(f.attributes)||Object.hasOwn(f,'properties')&&!object(f.properties))reject();
  return f.attributes||f.properties||f;
};

// Used only when the existing frontend adapter returns null. A successful empty
// frontend result never reaches this path. request is the same fixed-policy,
// budgeted source transport; errors abort the entire multi-source acquisition.
export async function fetchRemainingBuyerSources({job,sources,request,maxRows}) {
  if(!Array.isArray(sources)||sources.length<1||sources.length>32||typeof request!=='function'
    ||!Number.isSafeInteger(maxRows)||maxRows<1||maxRows>50000)reject('SOURCE_POLICY_REJECTED');
  const queries=createLegacyBuyerSourceQueryBuilders(job);const county=job.county.toLowerCase();const result=[];
  for(const s of sources) {
    if(s.sourceType!==s.registeredSourceType||typeof s.sourceType!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(s.sourceType)
      ||typeof s.cashDisabled!=='boolean')reject('SOURCE_POLICY_REJECTED');
    let build,maxPages=10,pageSize=1000;
    if(s.registeredSourceType==='arcgis_guilford'){build=queries.buildGuilfordUrl;maxPages=5;}
    else if(s.registeredSourceType==='arcgis_wake')build=queries.buildWakeUrl;
    else if(county==='stanly')build=queries.buildStanlyUrl;
    else if(county==='stokes'){build=queries.buildStokesUrl;maxPages=5;}
    else if(queries.isNcOneMapCounty())build=queries.buildNcOneMapUrl;
    else if(county==='lincoln')build=queries.buildLincolnUrl;
    else{build=source=>queries.capGenericUrl(source.source_url);maxPages=1;pageSize=500;}
    for(let page=0;page<maxPages;page++) {
      const data=await request(s,build({source_url:s.registryUrl},page*pageSize),pageSize);
      let rows;
      if(maxPages===1&&Array.isArray(data))rows=data;
      else {
        if(!object(data)||Object.hasOwn(data,'error'))reject();
        if(Array.isArray(data.features))rows=data.features.map(feature);
        else if(maxPages===1&&Array.isArray(data.data))rows=data.data;
        else if(maxPages===1&&Array.isArray(data.results))rows=data.results;
        else reject();
      }
      if(rows.some(r=>!object(r)))reject();
      if(rows.length>pageSize||result.length+rows.length>maxRows)reject('SOURCE_BUDGET_EXCEEDED');
      for(const row of rows)result.push({...row,_source_type:s.sourceType,_no_cash_data:s.cashDisabled});
      if(rows.length<pageSize)break;
    }
  }
  return result;
}
