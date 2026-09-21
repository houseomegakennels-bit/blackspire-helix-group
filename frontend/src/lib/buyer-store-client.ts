import "server-only";
import { getAuthTokensFromCookies } from "@/lib/buyer-engine-auth";
export function ownedBuyerStoreEnabled(): boolean {
 const mode=process.env.BLACKSPIRE_BUYER_STORE_MODE;
 if(mode===undefined||mode==='supabase')return false;
 if(mode!=='owned-postgres-v1')throw new Error('Buyer storage unavailable');
 return true;
}
export async function buyerStoreRequest<T>(operation:string,input:unknown):Promise<T>{
 const {accessToken}=await getAuthTokensFromCookies();
 return buyerStoreRequestWithToken<T>(operation,input,accessToken);
}
export async function buyerStoreRequestWithToken<T>(operation:string,input:unknown,accessToken:string|null):Promise<T>{
 try{
  if(!ownedBuyerStoreEnabled()||!['jobs-list','job-get','job-create','reports-list','exports-list','export-create','counts','profiles-list'].includes(operation))throw new Error();
  if(!accessToken)throw new Error();
  const origin=process.env.BLACKSPIRE_BUYER_STORE_URL;
  if(origin!=='https://command.blackspirehelix.com')throw new Error();
  const response=await fetch(`${origin}/api/internal/buyer-store/v1/${operation}`,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',authorization:`Bearer ${accessToken}`},body:JSON.stringify(input)});
  if(!response.ok||!response.body)throw new Error();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const value=await reader.read();if(value.done)break;size+=value.value.length;if(size>512*1024){await reader.cancel();throw new Error();}chunks.push(value.value);}}finally{reader.releaseLock();}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(!result||Object.keys(result).sort().join(',')!=='data,ok'||result.ok!==true)throw new Error();
  return result.data as T;
 }catch{throw new Error('Buyer storage unavailable');}
}
