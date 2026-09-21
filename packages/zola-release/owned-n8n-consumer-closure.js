import {N8N_REASSERTION,n8nReassertionDigest} from './owned-n8n-credential-reassertion.js';
const BUYER='VvMHSIbycYCx4CZN';
const fail=()=>{throw Error('Owned n8n consumer closure refused');};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
async function observe({request,tokenSubject:subject},continuation){
 if(typeof subject!=='string'||!subject)fail();
 const pages=async route=>{let cursor;const seen=new Set(),rows=[];for(let page=0;page<100;page++){const r=await request('GET',route+(cursor?'&cursor='+encodeURIComponent(cursor):''));if(r?.status!==200||!Array.isArray(r.body?.data)||r.body.data.length>100)fail();rows.push(...r.body.data);const next=r.body.nextCursor;if(next===null||next===undefined||next===''||next===false)return rows;if(typeof next!=='string'||next.length>2048||seen.has(next))fail();seen.add(next);cursor=next;}fail();};
 const scan=async()=>{
  const users=await pages('/api/v1/users?limit=100&includeRole=true'),projects=await pages('/api/v1/projects?limit=100'),workflows=await pages('/api/v1/workflows?limit=100');
  if(users.length!==1||users[0].id!==subject||users[0].role!=='global:owner'||users[0].isPending!==false||projects.length!==1||projects[0].type!=='personal'||projects[0].creatorId!==subject||workflows.length!==8||new Set(workflows.map(w=>w.id)).size!==8)fail();
  const buyer=workflows.find(w=>w.id===BUYER);if(!buyer||!continuation&&(buyer.active!==false||buyer.activeVersionId!==null||buyer.activeVersion!=null))fail();
  for(const w of workflows){if(typeof w.id!=='string'||!Array.isArray(w.nodes)||typeof w.versionId!=='string'||typeof w.active!=='boolean')fail();for(const node of w.nodes){for(const c of Object.values(node.credentials??{})){if(!c||typeof c.id!=='string'||!(/^[A-Za-z0-9_-]{1,128}$/).test(c.id)||c.id===N8N_REASSERTION.credentialId&&(!continuation||w.id!==BUYER))fail();}}}
  const executions=await pages('/api/v1/executions?limit=100&workflowId='+BUYER+'&includeData=false');
  if(new Set(executions.map(e=>e.id)).size!==executions.length||executions.some(e=>typeof e.id!=='string'||e.workflowId!==BUYER||e.finished!==true||!['success','error','canceled','crashed'].includes(e.status)||!Number.isFinite(Date.parse(e.stoppedAt))))fail();
  return canonical({credentialReferences:workflows.reduce((n,w)=>n+w.nodes.reduce((m,node)=>m+Object.values(node.credentials??{}).filter(c=>c.id===N8N_REASSERTION.credentialId).length,0),0),buyerInactive:buyer.active===false,owners:users.map(u=>({id:u.id,role:u.role,isPending:u.isPending})),projects:projects.map(p=>({id:p.id,type:p.type,creatorId:p.creatorId})),workflows:workflows.map(w=>({id:w.id,versionId:w.versionId,active:w.active,definitionDigest:n8nReassertionDigest(canonical({name:w.name,nodes:w.nodes,connections:w.connections,settings:w.settings}))})).sort((a,b)=>a.id.localeCompare(b.id)),executions:executions.map(e=>({id:e.id,status:e.status,finished:e.finished,stoppedAt:e.stoppedAt})).sort((a,b)=>a.id.localeCompare(b.id))});
 };
 const a=await scan(),b=await scan();if(n8nReassertionDigest(a)!==n8nReassertionDigest(b))fail();
 return {version:1,ownerCount:1,projectCount:1,workflowCount:8,credentialReferences:a.credentialReferences,buyerInactive:a.buyerInactive,executionsDrained:true,digest:n8nReassertionDigest(a),ownerDigest:n8nReassertionDigest(a.owners),projectDigest:n8nReassertionDigest(a.projects),workflows:a.workflows};
}

export const observeOwnedN8nConsumerClosure=input=>observe(input,false);
export async function observeOwnedN8nContinuationClosure({request,tokenSubject,plan,events,initialClosure}){
 const current=await observe({request,tokenSubject},true),old=initialClosure;
 if(!old||old.ownerDigest!==current.ownerDigest||old.projectDigest!==current.projectDigest||!Array.isArray(old.workflows)||old.workflows.length!==8||!Array.isArray(events))fail();
 const prior=new Map(old.workflows.map(w=>[w.id,w]));
 for(const w of current.workflows){if(w.id!==BUYER&&JSON.stringify(w)!==JSON.stringify(prior.get(w.id)))fail();}
 const buyer=current.workflows.find(w=>w.id===BUYER),before=prior.get(BUYER);
 if(before?.definitionDigest!==plan.baselineDigest||before.active!==false)fail();
 const update=events.some(e=>e.type==='intent'&&e.operation==='update'),updated=events.some(e=>e.type==='confirmed'&&e.operation==='update'&&e.state?.versionId===buyer.versionId),activate=events.some(e=>e.type==='intent'&&e.operation==='publish');
 if(buyer.definitionDigest===plan.baselineDigest){if(buyer.active!==false||buyer.versionId!==before.versionId)fail();}
 else if(buyer.definitionDigest===plan.candidateDigest){if(!update||buyer.active&&(!updated||!activate))fail();}
 else fail();
 return {status:'OWNED_N8N_CONTINUATION_CLOSURE_VERIFIED',digest:current.digest};
}
