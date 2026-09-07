import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isIP } from 'node:net';

// Offline definition builder only. It never loads the old secret-bearing export,
// resolves credentials, calls n8n, activates a workflow or fetches county data.
const identifier=(value)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value);
function bundle(name,exports) {
  const source=readFileSync(new URL(`./${name}.js`,import.meta.url),'utf8')
    .replace(/^import .+;\r?\n/gm,'').replace(/^export /gm,'');
  return `const {${exports.join(',')}}=(()=>{\n${source}\nreturn {${exports.join(',')}};\n})();\n`;
}

export function buildBuyerWorkflow({gatewayOrigin,ingressCredentialId,writerCredentialId,webhookId}) {
  let origin;
  try {origin=new URL(gatewayOrigin);}catch{throw new Error('Buyer workflow configuration rejected');}
  if(origin.protocol!=='https:'||origin.origin!==gatewayOrigin||origin.username||origin.password
    ||origin.port||isIP(origin.hostname)||!origin.hostname.includes('.')||origin.hostname.endsWith('.local')
    ||!identifier(ingressCredentialId)||!identifier(writerCredentialId)||ingressCredentialId===writerCredentialId
    ||!identifier(webhookId))throw new Error('Buyer workflow configuration rejected');
  const nodes=[];
  const connections={};
  const node=(name,type,parameters,extra={})=>{
    nodes.push({id:randomUUID(),name,type:`n8n-nodes-base.${type}`,typeVersion:2,position:[nodes.length*220,0],parameters,...extra});
  };
  const code=(name,jsCode)=>node(name,'code',{mode:'runOnceForAllItems',jsCode});
  const link=(from,to,output=0)=>{
    connections[from]??={main:[]};
    while(connections[from].main.length<=output)connections[from].main.push([]);
    connections[from].main[output].push({node:to,type:'main',index:0});
  };
  const intake=`$('Validate intake').item.json`;
  const common=`version:1,dispatchId:${intake}.dispatchId,generation:${intake}.generation`;
  const request=(name,path,body)=>node(name,'httpRequest',{
    method:'POST',url:`={{ ${JSON.stringify(gatewayOrigin+'/api/internal/buyer-writer/v1/jobs/')} + ${intake}.jobId + '/${path}' }}`,
    authentication:'genericCredentialType',genericAuthType:'httpHeaderAuth',
    sendHeaders:true,headerParameters:{parameters:[{name:'x-buyer-job-permit',value:`={{ ${intake}.permit }}`}]},
    sendBody:true,contentType:'json',specifyBody:'json',jsonBody:body,
    options:{redirect:{redirect:{followRedirects:false}},response:{response:{responseFormat:'json',neverError:false,fullResponse:false}},timeout:15000},
  },{typeVersion:4.2,retryOnFail:false,continueOnFail:false,credentials:{httpHeaderAuth:{id:writerCredentialId,name:'ZOLA Buyer writer'}}});
  node('Buyer webhook','webhook',{httpMethod:'POST',path:'buyer-engine',authentication:'headerAuth',responseMode:'responseNode',options:{}},
    {webhookId,credentials:{httpHeaderAuth:{id:ingressCredentialId,name:'ZOLA Buyer intake'}}});
  code('Validate intake',`const reject=()=>{throw new Error('Buyer intake rejected');};
const d=$input.first().json.body;
const keys=['version','jobId','dispatchId','generation','permit','rawBase64'];
if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)))reject();
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
if(d.version!==1||!uuid(d.jobId)||!uuid(d.dispatchId)||!Number.isSafeInteger(d.generation)||d.generation<1
 ||typeof d.permit!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(d.permit)
 ||typeof d.rawBase64!=='string'||d.rawBase64.length>8388608||d.rawBase64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(d.rawBase64))reject();
const bytes=Buffer.from(d.rawBase64,'base64');
if(bytes.length>6291456||bytes.toString('base64')!==d.rawBase64)reject();
return [{json:d}];`);
  request('Start dispatch','operations',`={{ {${common},operation:'start',chunkIndex:0,chunkCount:1,payload:{}} }}`);
  code('Verify start',`const r=$input.first().json;
if(r?.ok!==true||r.operation!=='start'||r.chunkIndex!==0||Object.keys(r).sort().join(',')!=='chunkIndex,ok,operation')throw new Error('Buyer start rejected');
return [{json:r}];`);
  request('Read bound context','context',`={{ {${common}} }}`);
  const bundled=`const {createHash,timingSafeEqual}=require('crypto');
const structuredClone=value=>JSON.parse(JSON.stringify(value));
class TextDecoder {decode(bytes){const s=Buffer.from(bytes).toString('utf8');if(!Buffer.from(s,'utf8').equals(bytes))throw new Error('Invalid UTF-8');return s;}}
`+bundle('protocol',['WriterProtocolError','parseWriterOperation'])
    +bundle('dates',['canonicalBuyerSaleDate'])
    +bundle('source-context',['validateBuyerSourceContext','verifyBuyerRawPayload'])
    +bundle('normalize',['normalizeBuyerSales'])
    +bundle('plan',['planBuyerWrites']);
  code('Verify and plan',bundled+`
const d=${intake};
try {
 const c=$input.first().json;
 const context=validateBuyerSourceContext(c.sourceContext);
 const rows=verifyBuyerRawPayload(context,Buffer.from(d.rawBase64,'base64'));
 const types=new Set(context.sources.map(s=>s.sourceType));
 if(rows.some(r=>typeof r._source_type!=='string'||!types.has(r._source_type)))throw new Error('Unbound source marker');
 const normalized=normalizeBuyerSales({...c.criteria,source_type:context.sources[0].sourceType,no_cash_data:context.sources.some(s=>s.cashDisabled),raw_sales:rows});
 return planBuyerWrites({...d,criteria:c.criteria,...normalized}).map(operation=>({json:operation,pairedItem:{item:0}}));
}catch{
 // This is a known pre-write validation failure after start, not a transport
 // timeout with an unknown database outcome. Persist only the scoped failure.
 return [{json:{version:1,dispatchId:d.dispatchId,generation:d.generation,operation:'fail',chunkIndex:0,chunkCount:1,payload:{code:'INVALID_SOURCE_DATA'}},pairedItem:{item:0}}];
}`);
  node('Next write','splitInBatches',{batchSize:1,options:{}},{typeVersion:3});
  request('Write operation','operations','={{ $json }}');
  code('Verify receipt',`const r=$input.first().json;const q=$('Next write').item.json;
if(r?.ok!==true||r.operation!==q.operation||r.chunkIndex!==q.chunkIndex||Object.keys(r).sort().join(',')!=='chunkIndex,ok,operation')throw new Error('Buyer write rejected');
return [{json:{operation:r.operation,chunkIndex:r.chunkIndex,ok:true}}];`);
  code('Verify completion',`const receipts=$input.all().map(i=>i.json);const plan=$('Verify and plan').all().map(i=>i.json);
if(plan.length===1&&plan[0].operation==='fail')throw new Error('Buyer source verification rejected');
if(receipts.length!==plan.length||receipts.length<2||receipts.some((r,i)=>r.ok!==true||r.operation!==plan[i].operation||r.chunkIndex!==plan[i].chunkIndex)||receipts.at(-1).operation!=='complete'
 ||receipts.filter(r=>r.operation==='complete').length!==1)throw new Error('Buyer completion rejected');
return [{json:{ok:true,status:'completed'}}];`);
  node('Respond completed','respondToWebhook',{respondWith:'json',responseBody:'={{ $json }}',options:{responseCode:200}},{typeVersion:1.4});
  for(const [from,to] of [['Buyer webhook','Validate intake'],['Validate intake','Start dispatch'],['Start dispatch','Verify start'],['Verify start','Read bound context'],['Read bound context','Verify and plan'],['Verify and plan','Next write'],['Write operation','Verify receipt'],['Verify receipt','Next write'],['Verify completion','Respond completed']])link(from,to);
  link('Next write','Write operation',1);link('Next write','Verify completion',0);
  return {name:'blackspire-buyer-engine',nodes,connections,settings:{executionOrder:'v1',executionTimeout:90,saveDataErrorExecution:'none',saveDataSuccessExecution:'none',saveManualExecutions:false,saveExecutionProgress:false},pinData:{}};
}
