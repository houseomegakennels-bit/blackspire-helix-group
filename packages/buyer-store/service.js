// No ambient credentials, database or network on import. HTTP admission belongs
// to the API host; identity is independently verified for each user request.
export const BUYER_STORE_PREFIX='/api/internal/buyer-store/v1/';
export const BUYER_AUTH_ORIGIN='https://kchtrvfcixnimvxxctkj.supabase.co';
export const refuse=()=>{throw new Error('BUYER_STORE_REFUSED');};
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const integer=(v,min,max)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
const string=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v);
const shape=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const date=v=>v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
export function validateBuyerStoreInput(operation,input){
 let valid=false;
 switch(operation){
 case 'jobs-list':valid=shape(input,['limit','ids'])&&integer(input.limit,1,200)&&Array.isArray(input.ids)&&input.ids.length<=200&&input.ids.every(uuid);break;
 case 'job-get':valid=shape(input,['id'])&&uuid(input.id);break;
 case 'job-create':valid=shape(input,['id','state','county','property_type','date_range_start','date_range_end','min_purchases','cash_buyers_only','llc_buyers_only'])&&uuid(input.id)&&/^[A-Z]{2}$/.test(input.state)&&string(input.county,128)&&string(input.property_type,64)&&date(input.date_range_start)&&date(input.date_range_end)&&(!input.date_range_start||!input.date_range_end||input.date_range_start<=input.date_range_end)&&integer(input.min_purchases,1,5)&&typeof input.cash_buyers_only==='boolean'&&typeof input.llc_buyers_only==='boolean';break;
 case 'reports-list':valid=shape(input,['searchJobId','limit','offset'])&&(input.searchJobId===null||uuid(input.searchJobId))&&integer(input.limit,1,200)&&integer(input.offset,0,100000);break;
 case 'exports-list':valid=shape(input,['searchJobId','limit'])&&(input.searchJobId===null||uuid(input.searchJobId))&&integer(input.limit,1,200);break;
 case 'export-create':valid=shape(input,['id','searchJobId','fileName','rowCount'])&&uuid(input.id)&&(input.searchJobId===null||uuid(input.searchJobId))&&string(input.fileName,256)&&!/[\\/]/.test(input.fileName)&&!['.','..'].includes(input.fileName)&&integer(input.rowCount,0,1000000);break;
 case 'counts':valid=shape(input,[]);break;
 case 'profiles-list':valid=shape(input,['county','state','buyerName','propertyType','cashBuyer','llcBuyer','limit'])&&['county','state','buyerName','propertyType'].every(k=>input[k]===null||string(input[k],128))&&[input.cashBuyer,input.llcBuyer].every(v=>v===null||typeof v==='boolean')&&integer(input.limit,1,200);break;
 default:refuse();
 }
 if(!valid)refuse();return structuredClone(input);
}
export function createBuyerStoreHandler({repository,verifyUser}){
 if(typeof repository?.execute!=='function'||typeof verifyUser!=='function')refuse();
 return async ({operation,accessToken,input})=>{
  try{
   const validated=validateBuyerStoreInput(operation,input),user=await verifyUser(accessToken);
   if(!uuid(user?.ownerId)||!['admin','beta_tester'].includes(user.role))refuse();
   const data=await repository.execute(operation,validated,user.ownerId,user.role);
   if(Buffer.byteLength(JSON.stringify(data))>512*1024)refuse();
   return {ok:true,data};
  }catch{refuse();}
 };
}
export function createSupabaseBuyerUserVerifier({publicKey,operatorOwnerId,fetchImpl=fetch}){
 if(!string(publicKey,4096)||operatorOwnerId!==null&&!uuid(operatorOwnerId))refuse();
 // Refuse legacy service-role keys; publishable keys or anon JWTs only.
 if(!publicKey.startsWith('sb_publishable_')){
  try{if(JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url')).role!=='anon')refuse();}catch{refuse();}
 }
 return async accessToken=>{
  try{
   if(!string(accessToken,8192)||accessToken.split('.').length!==3)refuse();
   const response=await fetchImpl(`${BUYER_AUTH_ORIGIN}/auth/v1/user`,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{apikey:publicKey,authorization:`Bearer ${accessToken}`}});
   if(!response.ok||!response.body)refuse();
   const chunks=[];let length=0;const reader=response.body.getReader();
   try{while(true){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>65536){await reader.cancel();refuse();}chunks.push(r.value);}}finally{reader.releaseLock();}
   const user=JSON.parse(Buffer.concat(chunks));
   if(!uuid(user.id)||user.is_anonymous===true||!user.email_confirmed_at||user.deleted_at||user.banned_until&&Date.parse(user.banned_until)>Date.now())refuse();
   const explicit=user.app_metadata?.blackspire_role;
   const recognized=['admin','beta_tester','demo_viewer','client_only'].includes(explicit);
   const role=recognized?explicit:user.id===operatorOwnerId?'admin':null;
   if(!['admin','beta_tester'].includes(role))refuse();
   return Object.freeze({ownerId:user.id,role});
  }catch{refuse();}
 };
}
