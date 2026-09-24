import "server-only";
import {NextRequest,NextResponse} from 'next/server';
import {verifyBuyerDealContextRequest,signBuyerDealContextResponse} from '../../../../../../../packages/buyer-store/deal-context-contract.js';
import {readBoundedRequestBody} from '@/lib/bounded-request-body';
export const dynamic='force-dynamic';
export async function POST(request:NextRequest){
 try{
  if(request.headers.get('content-type')!=='application/json'||new URL(request.url).search)throw new Error();
  const key=process.env.BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY??'',sha=process.env.VERCEL_GIT_COMMIT_SHA??'';
  const input=verifyBuyerDealContextRequest(JSON.parse(await readBoundedRequestBody(request)),key,sha);
  const origin=process.env.SUPABASE_URL,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(origin!=='https://kchtrvfcixnimvxxctkj.supabase.co'||!serviceKey)throw new Error();
  const url=new URL('/rest/v1/deal_leads',origin);url.searchParams.set('select','property_address,county,city,property_type');url.searchParams.set('id',`eq.${input.dealId}`);url.searchParams.set('limit','1');
  const started=Date.now();const response=await fetch(url,{method:'GET',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000),headers:{apikey:serviceKey,authorization:`Bearer ${serviceKey}`,accept:'application/json'}});
  if(!response.ok||!response.body)throw new Error();
  const chunks:Uint8Array[]=[];let bytes=0;const reader=response.body.getReader();
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>32768){await reader.cancel();throw new Error();}chunks.push(part.value);}}finally{reader.releaseLock();}
  const rows=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!Array.isArray(rows)||rows.length>1)throw new Error();
  return NextResponse.json(signBuyerDealContextResponse(input,rows[0]??null,{requests:1,responseBytes:bytes,latencyMs:Date.now()-started},key));
 }catch{return NextResponse.json({error:'not found'},{status:404});}
}
