import {randomBytes,createHash} from 'node:crypto';
import {observeReceiverDeployment} from './receiver-origin-transition.js';
export const OWNED_BUYER_CONFIGURATION=Object.freeze({
 root:'/var/lib/blackspire-operator/preparation/owned-buyer-configuration',
 apiEnvironment:'/etc/blackspire/command-api.env',deal:'/etc/blackspire/command-buyer-deal-context.json',
 receiver:'/var/lib/blackspire-operator/preparation/receiver-origin.json',
 team:'team_CaRyRaulJaFnCLSfTdyRYNIW',project:'prj_a9x4Tuzgzq6XrvtdtYNxONwL8Fou',branch:'release/zola-production-live',
 mode:'owned-postgres-v1',url:'https://command.blackspirehelix.com',
});
const C=OWNED_BUYER_CONFIGURATION;
const fail=()=>{throw new Error('Owned Buyer configuration blocked; retain protected evidence');};
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const exact=(v,k)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...k].sort().join(',');
const keyValid=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v)&&Buffer.from(v,'base64url').toString('base64url')===v;
const names=['BLACKSPIRE_BUYER_STORE_MODE','BLACKSPIRE_BUYER_STORE_URL','BLACKSPIRE_BUYER_DEAL_CONTEXT_KEY'];
const steps=['preview','production'].flatMap(scope=>names.map(key=>({scope,key,name:scope+'-'+key.toLowerCase()})));
export function addOwnedBuyerMode(bytes){
 if(typeof bytes!=='string'||!bytes.endsWith('\n')||bytes.includes('\r')||Buffer.byteLength(bytes)>32768)fail();
 const seen=new Set();for(const line of bytes.split('\n')){if(!line||line.startsWith('#'))continue;const match=/^([A-Z][A-Z0-9_]*)=([^\n]*)$/.exec(line);if(!match||seen.has(match[1])||match[1]==='BUYER_STORE_MODE')fail();seen.add(match[1]);}
 if(!seen.has('BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN'))fail();return bytes+'BUYER_STORE_MODE='+C.mode+'\n';
}
function verifyConsumerEnvironment(bytes,consumer){
 const rows=bytes.split('\n').filter(line=>line.startsWith('BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN='));if(rows.length!==1||rows[0]!=='BLACKSPIRE_AUTHORITY_CONSUMER_TOKEN='+consumer)fail();
}
function validatePlan(plan,releaseSha){
 if(!exact(plan,['version','releaseSha','dealKey','consumerDigest','apiBefore','apiAfter'])||plan.version!==1||plan.releaseSha!==releaseSha||!keyValid(plan.dealKey)||!(/^[a-f0-9]{64}$/).test(plan.consumerDigest)||addOwnedBuyerMode(plan.apiBefore)!==plan.apiAfter)fail();return plan;
}
function descriptor(step,plan){return{key:step.key,target:[step.scope],type:step.key===names[2]?'sensitive':'plain',gitBranch:step.scope==='preview'?C.branch:null,comment:'zola-owned-buyer:'+hash(plan)+':'+step.name};}
function value(step,plan){return step.key===names[0]?C.mode:step.key===names[1]?C.url:plan.dealKey;}
function validateRows(rows,plan){
 if(!Array.isArray(rows))fail();for(const row of rows){const step=steps.find(s=>row.key===s.key&&same(row.target,[s.scope]));if(!step)fail();const d=descriptor(step,plan);if(row.type!==d.type||(row.gitBranch??null)!==d.gitBranch||row.comment!==d.comment||typeof row.id!=='string'||!row.id||!Number.isSafeInteger(row.updatedAt)||row.customEnvironmentIds?.length)fail();}
 for(const step of steps)if(rows.filter(r=>r.key===step.key&&same(r.target,[step.scope])).length>1)fail();
}
function identity(row){return{id:row.id,key:row.key,target:row.target,type:row.type,gitBranch:row.gitBranch??null,comment:row.comment,updatedAt:row.updatedAt};}
function verifyRetainedRows(host,rows,plan,requireAll=false){
 validateRows(rows,plan);for(const step of steps){const result=host.read(step.name+'.result.json'),row=rows.find(r=>r.key===step.key&&same(r.target,[step.scope]));
  if(result){if(!exact(result,['version','planDigest','row'])||result.version!==1||result.planDigest!==hash(plan)||!row||!same(identity(row),result.row))fail();}
  else if(requireAll)fail();
 }
}
export async function prepareOwnedBuyerFrontend({releaseSha},{host,transport,generate=()=>randomBytes(32).toString('base64url')}={}){
 await host.assertStopped();if(!/^[a-f0-9]{40}$/.test(releaseSha??''))fail();
 let plan=host.read('frontend-plan.json');const consumer=host.consumer();verifyConsumerEnvironment(host.apiEnvironment(),consumer);
 if(!plan){const rows=await transport.observe();if(rows.length)fail();const before=host.apiEnvironment(),dealKey=generate();if(!keyValid(dealKey)||dealKey===consumer||dealKey===host.token()||before.split('\n').some(line=>line.slice(line.indexOf('=')+1)===dealKey))fail();
  plan={version:1,releaseSha,dealKey,consumerDigest:hash(consumer),apiBefore:before,apiAfter:addOwnedBuyerMode(before)};host.publish('frontend-plan.json',plan);
 }
 validatePlan(plan,releaseSha);if(hash(consumer)!==plan.consumerDigest||plan.dealKey===consumer)fail();host.publish('frontend-plan.json',plan);
 for(const step of steps){
  await host.assertStopped();if(host.consumer()!==consumer)fail();verifyConsumerEnvironment(host.apiEnvironment(),consumer);
  let rows=await transport.observe();verifyRetainedRows(host,rows,plan);let row=rows.find(r=>r.key===step.key&&same(r.target,[step.scope]));
  const intentName=step.name+'.intent.json',resultName=step.name+'.result.json',intent={version:1,planDigest:hash(plan),step:step.name};
  const previousIntent=host.read(intentName),result=host.read(resultName);
  if(previousIntent&&!same(previousIntent,intent)||result&&!previousIntent)fail();
  if(result){if(!exact(result,['version','planDigest','row'])||result.version!==1||result.planDigest!==hash(plan)||!row||!same(identity(row),result.row))fail();continue;}
  if(row&&!previousIntent||previousIntent&&!row)fail();host.publish(intentName,intent);
  // A retained ambiguous create can identify only this exact comment/scope row.
  // Reassert the retained value by ID; do not create a duplicate or regenerate.
  await transport.write(descriptor(step,plan),value(step,plan),row?.id??null);
  rows=await transport.observe();validateRows(rows,plan);row=rows.find(r=>r.key===step.key&&same(r.target,[step.scope]));if(!row)fail();
  host.publish(resultName,{version:1,planDigest:hash(plan),row:identity(row)});
 }
 verifyRetainedRows(host,await transport.observe(),plan,true);
 return{status:'OWNED_BUYER_FRONTEND_CONFIGURATION_SYNCHRONIZED',releaseSha,settings:6,deploymentAcceptance:false};
}
export async function publishOwnedBuyerApi({releaseSha},{host,transport,verifyReceiver=observeReceiverDeployment}={}){
 await host.assertStopped();const plan=validatePlan(host.read('frontend-plan.json'),releaseSha);
 if(hash(host.consumer())!==plan.consumerDigest)fail();verifyConsumerEnvironment(host.apiEnvironment(),host.consumer());const rows=await transport.observe();validateRows(rows,plan);
 for(const step of steps){const result=host.read(step.name+'.result.json'),row=rows.find(r=>r.key===step.key&&same(r.target,[step.scope]));if(!result||!row||result.planDigest!==hash(plan)||!same(result.row,identity(row)))fail();}
 const receiver=host.receiver();if(!exact(receiver,['schema','releaseSha','frontendOrigin','deploymentId'])||receiver.schema!==1||receiver.releaseSha!==releaseSha)fail();
 const target={releaseSha,mode:'preview',origin:receiver.frontendOrigin,deploymentId:receiver.deploymentId};await verifyReceiver(target);
 const candidate={version:1,releaseSha,origin:receiver.frontendOrigin,key:plan.dealKey};
 const currentDeal=host.deal();if(currentDeal!==null&&!same(currentDeal,candidate)||![plan.apiBefore,plan.apiAfter].includes(host.apiEnvironment()))fail();
 const apiPlan={version:1,releaseSha,frontendPlanDigest:hash(plan),receiver,environmentBefore:plan.apiBefore,environmentAfter:plan.apiAfter,deal:candidate};
 host.publish('api-plan.json',apiPlan);await host.assertStopped();if(!same(host.receiver(),receiver))fail();await verifyReceiver(target);
 host.publish('api.intent.json',{version:1,planDigest:hash(apiPlan)});
 host.replaceApi(plan.apiBefore,plan.apiAfter);host.publishDeal(candidate);
 await host.assertStopped();if(host.apiEnvironment()!==plan.apiAfter||!same(host.deal(),candidate))fail();await host.verifyIsolation();
 host.publish('api.result.json',{version:1,planDigest:hash(apiPlan)});
 return{status:'OWNED_BUYER_API_CONFIGURATION_PREPARED',releaseSha,previewDeploymentId:receiver.deploymentId};
}

export function createOwnedBuyerVercelTransport({token,fetchImpl=fetch}={}){
 const request=async(route,method='GET',body)=>{
  const response=await fetchImpl('https://api.vercel.com'+route+(route.includes('?')?'&':'?')+'teamId='+C.team,{method,redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization:'Bearer '+token(),accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok||response.redirected||!response.body)fail();let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.byteLength;if(size>1048576)fail();chunks.push(Buffer.from(chunk));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 };
 return{
  async observe(){const p=await request('/v9/projects/'+C.project);if(p.id!==C.project||p.accountId!==C.team)fail();const result=await request('/v9/projects/'+C.project+'/env');if(!Array.isArray(result.envs))fail();
   return result.envs.filter(v=>names.includes(v.key)).map(v=>({id:v.id,key:v.key,target:v.target,type:v.type,gitBranch:v.gitBranch??null,comment:v.comment,updatedAt:v.updatedAt,customEnvironmentIds:v.customEnvironmentIds??[]}));},
  async write(descriptor,secret,id){
   if(!names.includes(descriptor.key)||typeof secret!=='string')fail();let result;
   if(id){if(!/^[A-Za-z0-9_-]+$/.test(id))fail();result=await request('/v9/projects/'+C.project+'/env/'+id,'PATCH',{value:secret});if(result.id!==id||result.key!==descriptor.key||result.type!==descriptor.type)fail();}
   else{const body={...descriptor,value:secret};if(body.gitBranch===null)delete body.gitBranch;result=await request('/v10/projects/'+C.project+'/env','POST',body);if(result.failed?.length||Array.isArray(result.created)&&result.created.length!==1)fail();const created=Array.isArray(result.created)?result.created[0]:result.created;if(!created||created.key!==descriptor.key||created.type!==descriptor.type)fail();}
  },
 };
}
