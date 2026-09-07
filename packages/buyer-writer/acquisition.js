import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { BuyerSourceError, createBuyerSourceClient } from './source-http.js';
import { resolveBuyerSources } from './source-policy.js';
import { validateBuyerSourceContext } from './source-context.js';

const reject=(code='SOURCE_POLICY_REJECTED')=>{throw new BuyerSourceError(code);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const hash=s=>createHash('sha256').update(s).digest('hex');
const keys=new Set(['where','outFields','returnGeometry','orderByFields','resultRecordCount','resultOffset','f']);
function checkedQuery(input) {
  if(!(input instanceof URLSearchParams))reject();
  const q=new URLSearchParams(input);const seen=new Set();
  for(const [key,value]of q) {
    if(!keys.has(key)||seen.has(key)||value.length>8192||/[\x00-\x1f\x7f]/.test(value))reject();
    seen.add(key);
  }
  if(q.get('f')!=='json'||q.get('returnGeometry')!=='false'||!q.get('where')||!q.get('outFields')
    ||!/^\d{1,5}$/.test(q.get('resultRecordCount')??'')||!integer(Number(q.get('resultRecordCount')),1,10000)
    ||!/^\d{1,6}$/.test(q.get('resultOffset')??'')||!integer(Number(q.get('resultOffset')),0,50000))reject();
  return q;
}

// Trusted server composition only. adapterFactory is reviewed code; this is not
// an API for accepting caller-provided query builders. Production supplies the
// extracted county factory. Explicit client injection is for isolated tests.
// This path preserves frontend precedence (first ordered source), while binding
// ALL active source policy/cash flags. Generic n8n sources need their own adapter.
export async function acquireBuyerSources({job,rows,approved,budgets,adapterFactory,clientFactory=createBuyerSourceClient}) {
  if(typeof adapterFactory!=='function'||!integer(budgets?.maxRequests,1,500)||!integer(budgets?.maxRows,1,50000)
    ||!integer(budgets?.maxBytes,2,67108864)||!integer(budgets?.maxElapsedMs,1,240000))reject();
  const deadline=performance.now()+budgets.maxElapsedMs;
  const checkTime=()=>{if(performance.now()>=deadline)reject('SOURCE_TIMEOUT');};
  const captured=structuredClone(job);const limits={...budgets};
  const snapshot=resolveBuyerSources({rows,approved,job:captured});
  const selected=snapshot.sources[0];
  const endpoints=[{id:selected.endpointId,url:selected.url,method:selected.method,
    encoding:selected.method==='POST'?'form':'json',digest:selected.endpointConfigDigest,timeoutMs:selected.timeoutMs,
    buildParameters:parameters=>selected.method==='POST'?{query:new URLSearchParams(),body:checkedQuery(parameters)}:{query:checkedQuery(parameters)}}];
  // Secondary URL/method/headers/query policy are included in the parent digest
  // and cannot be independently selected by the incoming workload.
  const forsyth=selected.secondary;
  if(forsyth)endpoints.push({...forsyth,digest:selected.endpointConfigDigest,
    buildParameters:pin=>{
      if(typeof pin!=='string'||!/^\d{4}-\d{2}-\d{4}$/.test(pin))reject();
      return{query:new URLSearchParams(),body:{searchKey:'pin',searchValue:pin}};
    }});
  const client=clientFactory({endpoints,budgets:limits});let featureRows=0;
  try {
    const request=async(method,url,params,timeout)=>{
      checkTime();
      let parsed;try{parsed=new URL(url);}catch{reject();}
      const query=method==='GET'?new URLSearchParams(parsed.searchParams):params;
      if(method==='POST'&&parsed.search)reject();
      parsed.search='';
      if(parsed.href!==selected.url||method!==selected.method||timeout!==selected.timeoutMs)reject();
      const checked=checkedQuery(query);
      const response=await client.request({endpointId:selected.endpointId,endpointConfigDigest:selected.endpointConfigDigest,parameters:checked});
      const data=response.data;
      if(!object(data)||Object.hasOwn(data,'error')||!Array.isArray(data.features)
        ||data.features.some(f=>!object(f)||(!object(f.attributes)&&!object(f.properties))))reject('SOURCE_DATA_REJECTED');
      featureRows+=data.features.length;
      if(featureRows>limits.maxRows||data.features.length>Number(checked.get('resultRecordCount')))reject('SOURCE_BUDGET_EXCEEDED');
      return data;
    };
    const adapters=adapterFactory({
      resolveSource:async(county,state)=>{
        if(county.trim().toLowerCase()!==selected.county||state.trim().toLowerCase()!==selected.state)reject();
        return{source_url:selected.registryUrl};
      },
      getJson:(url,timeout)=>request('GET',url,null,timeout),
      postFormJson:(url,params,timeout)=>request('POST',url,params,timeout),
      postForsythJson:async pin=>{
        checkTime();
        if(!forsyth)reject();
        const result=await client.request({endpointId:'forsyth-parcel-v1',endpointConfigDigest:selected.endpointConfigDigest,parameters:pin});
        if(!object(result.data)||Object.hasOwn(result.data,'error'))reject('SOURCE_DATA_REJECTED');
        return result.data;
      },
    });
    const result=await adapters.prefetch(captured);
    checkTime();
    if(result===null)reject('SOURCE_ADAPTER_UNAVAILABLE');
    if(!Array.isArray(result)||result.some(r=>!object(r)||r._source_type!==selected.sourceType))reject('SOURCE_DATA_REJECTED');
    if(result.length>limits.maxRows)reject('SOURCE_BUDGET_EXCEEDED');
    // Bound serialization incrementally rather than building an unbounded
    // aggregate string. The same exact bytes go to the n8n permit-bound payload.
    const chunks=[Buffer.from('[')];let size=2;
    for(const row of result) {
      checkTime();
      const bytes=Buffer.from(JSON.stringify(row,(_key,value)=>{
        if(typeof value==='number'&&!Number.isFinite(value))reject('SOURCE_DATA_REJECTED');
        return value;
      }));size+=bytes.length+(chunks.length>1?1:0);
      if(size>Math.min(limits.maxBytes,6*1024*1024))reject('SOURCE_BUDGET_EXCEEDED');
      if(chunks.length>1)chunks.push(Buffer.from(','));chunks.push(bytes);
    }
    chunks.push(Buffer.from(']'));const bytes=Buffer.concat(chunks);
    const context=validateBuyerSourceContext({version:1,mode:'frontend_payload',
      sources:snapshot.sources.map(s=>({sourceId:s.sourceId,sourceType:s.sourceType,endpointId:s.endpointId,
        endpointConfigDigest:s.endpointConfigDigest,cashDisabled:s.cashDisabled})),
      budgets:{maxRequests:limits.maxRequests,maxRows:limits.maxRows,maxBytes:limits.maxBytes},
      rawPayload:{digest:hash(bytes),rowCount:result.length,byteCount:bytes.length}});
    checkTime();return{context,bytes,usage:client.usage()};
  }catch(error) {
    throw error instanceof BuyerSourceError?error:new BuyerSourceError('SOURCE_ACQUISITION_FAILED');
  }finally{client.close();}
}
