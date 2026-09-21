import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createAdminSupabaseAuthClient } from '@/lib/buyer-engine-auth';
import { getOperatorContext } from '@/lib/operator-access';
import { applyDemoAction, seedDemoState, type DemoState } from '@/lib/demo-sandbox';
export const dynamic='force-dynamic';
async function access(){
  const c=await getOperatorContext();
  return c.operatorId && c.role==='demo_operator' && !c.expired ? c.operatorId : null;
}
export async function GET(){
  const userId=await access();
  if(!userId)return NextResponse.json({error:'Active interactive demo access is required.'},{status:403});
  const db=createAdminSupabaseAuthClient();
  const {error:initError}=await db.from('demo_workspaces').upsert({user_id:userId,state:seedDemoState()},{onConflict:'user_id',ignoreDuplicates:true});
  if(initError)return NextResponse.json({error:'Workspace could not be opened.'},{status:503});
  const {data,error}=await db.from('demo_workspaces').select('state,revision').eq('user_id',userId).single();
  return error?NextResponse.json({error:'Workspace unavailable.'},{status:503}):NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
}
export async function POST(request:NextRequest){
  const userId=await access();
  if(!userId)return NextResponse.json({error:'Active interactive demo access is required.'},{status:403});
  const origin=request.headers.get('origin');
  if(!origin || origin!==request.nextUrl.origin)return NextResponse.json({error:'Invalid request origin.'},{status:403});
  const raw=await request.text();if(raw.length>12000)return NextResponse.json({error:'Request too large.'},{status:413});
  try{
    const body=JSON.parse(raw);
    const db=createAdminSupabaseAuthClient();
    const {data:current,error}=await db.from('demo_workspaces').select('state,revision').eq('user_id',userId).single();
    if(error||!current)return NextResponse.json({error:'Open your workspace first.'},{status:409});
    if(body.revision!==current.revision)return NextResponse.json({error:'Workspace changed. Refresh before saving.'},{status:409});
    const state=applyDemoAction(current.state as DemoState,body,randomUUID());
    const {data:saved,error:saveError}=await db.from('demo_workspaces').update({state,revision:current.revision+1,updated_at:new Date().toISOString()}).eq('user_id',userId).eq('revision',current.revision).select('state,revision').maybeSingle();
    if(saveError||!saved)return NextResponse.json({error:'Workspace changed or save failed. Refresh and try again.'},{status:409});
    return NextResponse.json(saved);
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Invalid request.'},{status:400});}
}
