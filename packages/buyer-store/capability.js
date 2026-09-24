import {createHash} from 'node:crypto';
import {refuse,validateBuyerStoreInput} from './service.js';
const hash=v=>createHash('sha256').update(v).digest('hex');
// Host must call inside the consumed-authority async release lease and recheck
// that same authority after this promise resolves. This helper grants no lease.
export async function readConsumedBuyerData({authority,request,bindingDigest},{repository,lookupDeal,now=Date.now}){
 try{
  if(!['buyer.profiles.search','buyer.matches.search'].includes(authority?.capabilityId)||!request||request.workspaceId!==authority.workspaceId||hash(JSON.stringify(request))!==authority.bodySha256||!/^[a-f0-9]{64}$/.test(bindingDigest))refuse();
  const started=now();let deal=null;let dealObservation={requests:0,responseBytes:0,latencyMs:0};
  if(authority.capabilityId==='buyer.matches.search'){
   if(request.matchesOnly!==true||!/^DE-\d{4}$/.test(request.opportunityId??'')||typeof lookupDeal!=='function')refuse();
   const context=await lookupDeal(request.opportunityId,{authority,bindingDigest});
   deal=context.deal;dealObservation=context.observation;
   if(!dealObservation||dealObservation.requests!==1||!Number.isSafeInteger(dealObservation.responseBytes)||dealObservation.responseBytes<0||dealObservation.responseBytes>32768)refuse();
   if(deal!==null&&(!deal||Object.keys(deal).sort().join(',')!=='city,county,property_address,property_type'||Object.values(deal).some(v=>v!==null&&(typeof v!=='string'||v.length>1024))))refuse();
  }else if(request.matchesOnly===true)refuse();
  const county=authority.capabilityId==='buyer.matches.search'?deal?.county?.replace(/\s+county$/i,'').trim()||null:typeof request.county==='string'?request.county:null;
  const input=validateBuyerStoreInput('profiles-list',{county,state:typeof request.state==='string'?request.state:null,buyerName:typeof request.buyerName==='string'?request.buyerName:null,propertyType:typeof request.propertyType==='string'?request.propertyType.toLowerCase():null,cashBuyer:typeof request.cashBuyer==='boolean'?request.cashBuyer:null,llcBuyer:typeof request.llcBuyer==='boolean'?request.llcBuyer:null,limit:authority.capabilityId==='buyer.matches.search'?200:request.limit??5});
  const value=authority.capabilityId==='buyer.matches.search'&&(!deal||!county)?{rows:[],count:0,observation:{requests:0,responseBytes:0,latencyMs:0}}:await repository.readCapabilityProfiles(input);
  const native=value.observation;if(!native||!Number.isSafeInteger(native.requests)||native.requests<0||native.requests>2||!Number.isSafeInteger(native.responseBytes)||native.responseBytes<0)refuse();
  const observation={version:2,releaseSha:authority.releaseSha,transport:'bounded owned PostgreSQL SELECT and Supabase GET/HEAD',requests:native.requests+dealObservation.requests,responseBytes:native.responseBytes+dealObservation.responseBytes,forbiddenAttempts:0,latencyMs:now()-started,scope:'authority-bound Buyer read only'};
  if(observation.requests<1||observation.responseBytes>2*1024*1024)refuse();
  const result={version:1,capabilityId:authority.capabilityId,bindingDigest,profiles:value.rows,count:value.count,deal,observation};
  if(!Array.isArray(value.rows)||value.rows.length>200||!Number.isSafeInteger(value.count)||value.count<value.rows.length||Buffer.byteLength(JSON.stringify(result))>256*1024||now()-started>11000)refuse();
  return result;
 }catch{refuse();}
}
